use codeg_lib::db::entities::{conversation_capability_setting, relay_context_pack};
use codeg_lib::db::service::conversation_capability_service::{
    get_capabilities, set_relay_enabled,
};
use codeg_lib::db::service::relay_context_pack_service::{
    bind_to_conversation, claim_consume, create_or_replace_draft, get_active_by_draft,
    invalidate_unconsumed_by_source, mark_consumed, release_claim, ConsumeClaim, NewRelayPack,
};
use codeg_lib::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use codeg_lib::models::agent::AgentType;
use codeg_lib::models::conversation_relay::RelayErrorCode;
use codeg_lib::web::event_bridge::EventEmitter;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait};
use std::sync::Arc;

async fn insert_pack(
    conn: &sea_orm::DatabaseConnection,
    target_draft_id: &str,
    source_conversation_id: i32,
    target_conversation_id: Option<i32>,
    status: &str,
) -> Result<relay_context_pack::Model, sea_orm::DbErr> {
    relay_context_pack::ActiveModel {
        target_draft_id: Set(target_draft_id.to_owned()),
        target_conversation_id: Set(target_conversation_id),
        source_conversation_id: Set(source_conversation_id),
        source_folder_id: Set(1),
        scope_type: Set("summary".to_owned()),
        selected_round_ids_json: Set("[]".to_owned()),
        snapshot_json: Set("{}".to_owned()),
        source_fingerprint: Set("fingerprint".to_owned()),
        estimated_tokens: Set(128),
        context_window_tokens: Set(None),
        allowed_tokens: Set(256),
        status: Set(status.to_owned()),
        invalid_reason: Set(None),
        consume_client_message_id: Set(None),
        consume_attempt_state: Set(None),
        consumed_snapshot_json: Set(None),
        created_at: Set(chrono::Utc::now()),
        updated_at: Set(chrono::Utc::now()),
        consumed_at: Set(None),
        ..Default::default()
    }
    .insert(conn)
    .await
}

#[tokio::test]
async fn migration_seeds_enabled_setting_and_enforces_single_active_pack() {
    let db = fresh_in_memory_db().await;
    let setting = conversation_capability_setting::Entity::find_by_id(1)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert!(setting.relay_enabled);

    let folder_id = seed_folder(&db, "C:/workspace/relay-draft").await;
    let source_one = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let source_two = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;

    insert_pack(&db.conn, "draft-a", source_one, None, "draft")
        .await
        .unwrap();
    let duplicate = insert_pack(&db.conn, "draft-a", source_two, None, "attached").await;
    assert!(duplicate.is_err());
}

#[tokio::test]
async fn migration_enforces_single_target_conversation_pack() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-target").await;
    let source_one = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let source_two = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let target = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;

    insert_pack(&db.conn, "draft-a", source_one, Some(target), "consumed")
        .await
        .unwrap();
    let duplicate = insert_pack(&db.conn, "draft-b", source_two, Some(target), "consumed").await;
    assert!(duplicate.is_err());
}

#[tokio::test]
async fn consumed_pack_remains_after_source_conversation_is_soft_deleted() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-consumed").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let pack = insert_pack(&db.conn, "draft-a", source, None, "consumed")
        .await
        .unwrap();

    codeg_lib::db::entities::conversation::Entity::update_many()
        .col_expr(
            codeg_lib::db::entities::conversation::Column::DeletedAt,
            sea_orm::sea_query::Expr::value(chrono::Utc::now()),
        )
        .filter(codeg_lib::db::entities::conversation::Column::Id.eq(source))
        .exec(&db.conn)
        .await
        .unwrap();

    let retained = relay_context_pack::Entity::find_by_id(pack.id)
        .one(&db.conn)
        .await
        .unwrap();
    assert!(retained.is_some());
}

async fn seeded_relay_db() -> codeg_lib::db::AppDatabase {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-claim").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let target = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    insert_pack(&db.conn, "draft-claim", source, Some(target), "attached")
        .await
        .unwrap();
    db
}

async fn seeded_draft_and_consumed_packs() -> codeg_lib::db::AppDatabase {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-disable").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    insert_pack(&db.conn, "draft-disable", source, None, "draft")
        .await
        .unwrap();
    insert_pack(&db.conn, "consumed-disable", source, None, "consumed")
        .await
        .unwrap();
    db
}

async fn status(conn: &sea_orm::DatabaseConnection, id: i32) -> String {
    relay_context_pack::Entity::find_by_id(id)
        .one(conn)
        .await
        .unwrap()
        .unwrap()
        .status
}

fn new_pack(
    target_draft_id: &str,
    source_conversation_id: i32,
    source_folder_id: i32,
) -> NewRelayPack {
    NewRelayPack {
        target_draft_id: target_draft_id.to_owned(),
        source_conversation_id,
        source_folder_id,
        scope_type: "summary".to_owned(),
        selected_round_ids_json: "[]".to_owned(),
        snapshot_json: "{\"canonicalContext\":\"private context\"}".to_owned(),
        source_fingerprint: "fingerprint".to_owned(),
        estimated_tokens: 128,
        context_window_tokens: Some(512),
        allowed_tokens: 256,
    }
}

#[tokio::test]
async fn consume_is_idempotent_for_same_message_and_rejects_a_different_message() {
    let db = seeded_relay_db().await;

    let first = claim_consume(&db.conn, 1, "message-a").await.unwrap();
    let retry = claim_consume(&db.conn, 1, "message-a").await.unwrap();
    assert!(matches!(first, ConsumeClaim::Claimed { .. }));
    assert!(matches!(retry, ConsumeClaim::AlreadyClaimed { .. }));

    let conflict = claim_consume(&db.conn, 1, "message-b").await;
    assert!(matches!(
        conflict,
        Err(error) if error.code == RelayErrorCode::RelayConsumeConflict
    ));
}

#[tokio::test]
async fn disabling_relay_soft_removes_only_unconsumed_packs() {
    let db = seeded_draft_and_consumed_packs().await;

    set_relay_enabled(&db.conn, &EventEmitter::Noop, false)
        .await
        .unwrap();

    assert_eq!(status(&db.conn, 1).await, "removed");
    assert_eq!(status(&db.conn, 2).await, "consumed");
}

#[tokio::test]
async fn capabilities_default_to_enabled_and_disable_broadcasts_safe_cross_window_events() {
    let db = seeded_draft_and_consumed_packs().await;
    let broadcaster = Arc::new(codeg_lib::web::event_bridge::WebEventBroadcaster::new());
    let mut events = broadcaster.subscribe();
    let emitter = EventEmitter::test_web_only(broadcaster);

    assert!(get_capabilities(&db.conn).await.unwrap().relay_enabled);
    let updated = set_relay_enabled(&db.conn, &emitter, false).await.unwrap();
    assert!(!updated.relay_enabled);

    let capabilities = events.try_recv().expect("capability event");
    assert_eq!(
        capabilities.channel,
        codeg_lib::web::event_bridge::CONVERSATION_CAPABILITIES_CHANGED_EVENT
    );
    assert_eq!(capabilities.payload["relayEnabled"], false);
    assert_eq!(capabilities.payload.as_object().unwrap().len(), 1);

    let relay = events.try_recv().expect("relay event");
    assert_eq!(
        relay.channel,
        codeg_lib::web::event_bridge::CONVERSATION_RELAY_CHANGED_EVENT
    );
    assert_eq!(relay.payload["relayId"], 1);
    assert_eq!(relay.payload["targetDraftId"], "draft-disable");
    assert_eq!(relay.payload["status"], "removed");
    assert!(relay.payload.get("snapshotJson").is_none());
    assert!(relay.payload.get("sourceFingerprint").is_none());
}

#[tokio::test]
async fn replacing_a_draft_removes_the_previous_active_pack_and_restores_one_active_pack() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-replace").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;

    let first = create_or_replace_draft(&db.conn, new_pack("draft-replace", source, folder_id))
        .await
        .unwrap();
    let second = create_or_replace_draft(&db.conn, new_pack("draft-replace", source, folder_id))
        .await
        .unwrap();

    assert_eq!(status(&db.conn, first.id).await, "removed");
    assert_eq!(
        get_active_by_draft(&db.conn, "draft-replace")
            .await
            .unwrap()
            .unwrap()
            .id,
        second.id
    );
}

#[tokio::test]
async fn binding_a_draft_attaches_it_to_its_target_conversation() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-bind").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let target = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let pack = create_or_replace_draft(&db.conn, new_pack("draft-bind", source, folder_id))
        .await
        .unwrap();

    let txn = db.conn.begin().await.unwrap();
    let attached = bind_to_conversation(&txn, pack.id, "draft-bind", target)
        .await
        .unwrap();
    txn.commit().await.unwrap();

    assert_eq!(attached.status, "attached");
    assert_eq!(attached.target_conversation_id, Some(target));
}

#[tokio::test]
async fn concurrent_claims_allow_exactly_one_message_to_own_the_pack() {
    let db = seeded_relay_db().await;

    let (first, second) = tokio::join!(
        claim_consume(&db.conn, 1, "message-a"),
        claim_consume(&db.conn, 1, "message-b"),
    );

    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    let stored = relay_context_pack::Entity::find_by_id(1)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        stored.consume_client_message_id.as_deref(),
        Some("message-a" | "message-b")
    ));
}

#[tokio::test]
async fn claiming_the_same_message_for_two_packs_returns_a_consume_conflict() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-unique-message").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let target_one = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let target_two = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let first = insert_pack(
        &db.conn,
        "draft-unique-a",
        source,
        Some(target_one),
        "attached",
    )
    .await
    .unwrap();
    let second = insert_pack(
        &db.conn,
        "draft-unique-b",
        source,
        Some(target_two),
        "attached",
    )
    .await
    .unwrap();

    claim_consume(&db.conn, first.id, "message-shared")
        .await
        .unwrap();
    let conflict = claim_consume(&db.conn, second.id, "message-shared").await;
    assert!(matches!(
        conflict,
        Err(error) if error.code == RelayErrorCode::RelayConsumeConflict
    ));
}

#[tokio::test]
async fn binding_two_packs_to_one_conversation_returns_a_consume_conflict() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-unique-target").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let target = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let first = create_or_replace_draft(&db.conn, new_pack("draft-target-a", source, folder_id))
        .await
        .unwrap();
    let second = create_or_replace_draft(&db.conn, new_pack("draft-target-b", source, folder_id))
        .await
        .unwrap();

    let first_txn = db.conn.begin().await.unwrap();
    bind_to_conversation(&first_txn, first.id, "draft-target-a", target)
        .await
        .unwrap();
    first_txn.commit().await.unwrap();

    let second_txn = db.conn.begin().await.unwrap();
    let conflict = bind_to_conversation(&second_txn, second.id, "draft-target-b", target).await;
    assert!(matches!(
        conflict,
        Err(error) if error.code == RelayErrorCode::RelayConsumeConflict
    ));
    second_txn.rollback().await.unwrap();
}

#[tokio::test]
async fn consumed_snapshot_is_immutable_after_the_first_successful_consume() {
    let db = seeded_relay_db().await;
    claim_consume(&db.conn, 1, "message-a").await.unwrap();
    mark_consumed(&db.conn, 1, "message-a", "{\"context\":\"first\"}")
        .await
        .unwrap();

    let immutable = mark_consumed(&db.conn, 1, "message-a", "{\"context\":\"second\"}").await;
    assert!(matches!(
        immutable,
        Err(error) if error.code == RelayErrorCode::RelayImmutableSnapshot
    ));
    let stored = relay_context_pack::Entity::find_by_id(1)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.consumed_snapshot_json.as_deref(),
        Some("{\"context\":\"first\"}")
    );
}

#[tokio::test]
async fn releasing_a_claim_allows_a_new_message_to_claim_the_attached_pack() {
    let db = seeded_relay_db().await;
    claim_consume(&db.conn, 1, "message-a").await.unwrap();
    let released = release_claim(&db.conn, 1, "message-a").await.unwrap();
    assert_eq!(released.status, "attached");
    assert!(released.consume_client_message_id.is_none());

    claim_consume(&db.conn, 1, "message-b").await.unwrap();
    let stored = relay_context_pack::Entity::find_by_id(1)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.consume_client_message_id.as_deref(),
        Some("message-b")
    );
}

#[tokio::test]
async fn invalidating_a_source_does_not_change_consumed_packs_or_their_snapshot() {
    let db = seeded_draft_and_consumed_packs().await;
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::ConsumedSnapshotJson,
            sea_orm::sea_query::Expr::value(Some("{\"context\":\"sealed\"}".to_owned())),
        )
        .filter(relay_context_pack::Column::Id.eq(2))
        .exec(&db.conn)
        .await
        .unwrap();

    assert_eq!(
        invalidate_unconsumed_by_source(&db.conn, 1, "relay_source_not_found")
            .await
            .unwrap(),
        1
    );
    assert_eq!(status(&db.conn, 1).await, "invalid");
    assert_eq!(status(&db.conn, 2).await, "consumed");
    let consumed = relay_context_pack::Entity::find_by_id(2)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        consumed.consumed_snapshot_json.as_deref(),
        Some("{\"context\":\"sealed\"}")
    );
}
