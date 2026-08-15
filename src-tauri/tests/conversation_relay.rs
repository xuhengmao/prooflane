use codeg_lib::conversation_relay::fingerprint_rounds;
use codeg_lib::conversation_relay::service::{
    cancel_relay_preview_core, get_conversation_capabilities_core, get_conversation_relay_core,
    get_relay_context_by_draft_core, preview_relay_context_core,
    preview_relay_context_from_rounds_with_summarizer_core, remove_relay_context_core,
    reserve_relay_preview_core, update_conversation_capabilities_core,
    update_relay_context_with_summarizer_core, RelayPatchRequest, RelayPreviewRequest,
    UpdateConversationCapabilitiesInput,
};
use codeg_lib::conversation_relay::summarizer::{
    summarize_with_runner, RelayStructuredSummary, RelaySummarizer, RelaySummaryItem,
    RelaySummaryRunner,
};
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
use codeg_lib::models::conversation_relay::{
    RelayError, RelayErrorCode, RelayRound, RelayScopeSelection, RelayScopeType, RelaySnapshot,
    RelaySnapshotSource, RelayStats,
};
use codeg_lib::restricted_codex::{RestrictedCodexError, RestrictedCodexRequest};
use codeg_lib::web::event_bridge::EventEmitter;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, Set, TransactionTrait,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

struct BlockingSummarizer {
    entered: Arc<Notify>,
    release: Arc<Notify>,
}

#[async_trait::async_trait]
impl RelaySummarizer for BlockingSummarizer {
    async fn summarize(&self, rounds: &[RelayRound]) -> Result<RelayStructuredSummary, RelayError> {
        self.entered.notify_one();
        self.release.notified().await;
        Ok(RelayStructuredSummary {
            goal: vec![RelaySummaryItem {
                text: "stale summary".to_owned(),
                source_round_ids: vec![rounds[0].id.clone()],
            }],
            ..RelayStructuredSummary::default()
        })
    }
}

struct FailingRunner;

#[async_trait::async_trait]
impl RelaySummaryRunner for FailingRunner {
    async fn run(&self, _request: RestrictedCodexRequest) -> Result<String, RestrictedCodexError> {
        Err(RestrictedCodexError::Failed(
            "controlled runner failure".to_owned(),
        ))
    }
}

struct RunnerBackedFailingSummarizer;

#[async_trait::async_trait]
impl RelaySummarizer for RunnerBackedFailingSummarizer {
    async fn summarize(&self, rounds: &[RelayRound]) -> Result<RelayStructuredSummary, RelayError> {
        summarize_with_runner(&FailingRunner, rounds).await
    }
}

fn relay_round(id: &str, user_text: &str) -> RelayRound {
    RelayRound {
        id: id.to_owned(),
        user_text: user_text.to_owned(),
        assistant_text: "assistant result".to_owned(),
        tools: Vec::new(),
        files: Vec::new(),
        source_message_ids: vec![format!("message-{id}")],
    }
}

fn preview_request(
    request_id: &str,
    target_draft_id: &str,
    source_conversation_id: i32,
    scope_type: RelayScopeType,
) -> RelayPreviewRequest {
    RelayPreviewRequest {
        request_id: request_id.to_owned(),
        target_draft_id: target_draft_id.to_owned(),
        source_conversation_id,
        target_folder_id: None,
        target_agent_type: AgentType::Codex,
        target_model: None,
        scope: RelayScopeSelection {
            scope_type,
            selected_round_ids: vec!["round-1".to_owned()],
        },
    }
}

async fn reserved_preview_request(request: RelayPreviewRequest) -> RelayPreviewRequest {
    assert!(
        reserve_relay_preview_core(&request.request_id, &request.target_draft_id).await,
        "preview reservation should succeed"
    );
    request
}

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

#[tokio::test]
async fn ordinary_conversation_listing_has_zero_relay_side_effects() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-list").await;
    seed_conversation(&db, folder_id, AgentType::Codex).await;

    let listed = codeg_lib::commands::conversations::list_all_conversations_core(
        &db.conn, None, None, None, None, None, false,
    )
    .await
    .unwrap();

    assert_eq!(listed.len(), 1);
    assert_eq!(
        relay_context_pack::Entity::find()
            .count(&db.conn)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn capability_core_round_trips_the_same_camel_case_setting() {
    let db = fresh_in_memory_db().await;
    assert!(
        get_conversation_capabilities_core(&db.conn)
            .await
            .unwrap()
            .relay_enabled
    );

    let updated = update_conversation_capabilities_core(
        &db.conn,
        &EventEmitter::Noop,
        UpdateConversationCapabilitiesInput {
            relay_enabled: false,
        },
    )
    .await
    .unwrap();

    assert!(!updated.relay_enabled);
    assert!(
        !get_conversation_capabilities_core(&db.conn)
            .await
            .unwrap()
            .relay_enabled
    );
}

#[tokio::test]
async fn explicit_preview_failure_does_not_persist_an_empty_pack() {
    let db = fresh_in_memory_db().await;
    let data_dir = tempfile::tempdir().unwrap();
    let state = codeg_lib::app_state::AppState::new_for_test(db, data_dir.path().to_path_buf());

    let error = preview_relay_context_core(
        &state.connection_manager,
        &state.db,
        &state.data_dir,
        reserved_preview_request(RelayPreviewRequest {
            request_id: "missing-source-preview".to_owned(),
            target_draft_id: "cross-project-draft".to_owned(),
            source_conversation_id: 999,
            target_folder_id: Some(77),
            target_agent_type: AgentType::Codex,
            target_model: Some("gpt-5.4".to_owned()),
            scope: RelayScopeSelection {
                scope_type: RelayScopeType::RecentRounds,
                selected_round_ids: vec!["round-1".to_owned()],
            },
        })
        .await,
    )
    .await
    .unwrap_err();

    assert_eq!(
        error.message,
        RelayErrorCode::RelaySourceNotFound.to_string()
    );
    assert_eq!(
        relay_context_pack::Entity::find()
            .count(&state.db.conn)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn cancelled_preview_does_not_replace_the_previous_active_pack() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-cancelled-preview").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let original = insert_pack(&db.conn, "draft-cancelled", source, None, "draft")
        .await
        .unwrap();
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let summarizer = BlockingSummarizer {
        entered: entered.clone(),
        release: release.clone(),
    };
    let rounds = vec![relay_round("round-1", "cancel this summary")];
    let preview = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "cancelled-preview-request",
            "draft-cancelled",
            source,
            RelayScopeType::Summary,
        ))
        .await,
        rounds,
        &summarizer,
    );
    tokio::pin!(preview);
    tokio::select! {
        () = entered.notified() => {}
        result = &mut preview => panic!("preview completed before cancellation: {result:?}"),
    }

    assert!(cancel_relay_preview_core("cancelled-preview-request").await);
    release.notify_one();
    let error = preview.await.unwrap_err();

    assert_eq!(
        error.message,
        RelayErrorCode::RelaySourceUnavailable.to_string()
    );
    let retained = relay_context_pack::Entity::find_by_id(original.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retained.snapshot_json, original.snapshot_json);
    assert_eq!(retained.status, original.status);
    assert_eq!(
        get_active_by_draft(&db.conn, "draft-cancelled")
            .await
            .unwrap()
            .unwrap()
            .id,
        original.id
    );
}

#[tokio::test]
async fn dropped_preview_future_releases_its_request_slot() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-dropped-preview").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let rounds = vec![relay_round("round-1", "drop this summary")];

    for sequence in 0..40 {
        {
            let entered = Arc::new(Notify::new());
            let release = Arc::new(Notify::new());
            let summarizer = BlockingSummarizer {
                entered: entered.clone(),
                release,
            };
            let preview = preview_relay_context_from_rounds_with_summarizer_core(
                &db,
                reserved_preview_request(preview_request(
                    &format!("dropped-preview-request-{sequence}"),
                    &format!("draft-dropped-{sequence}"),
                    source,
                    RelayScopeType::Summary,
                ))
                .await,
                rounds.clone(),
                &summarizer,
            );
            tokio::pin!(preview);
            tokio::select! {
                () = entered.notified() => {}
                result = &mut preview => panic!("preview slot leaked before request {sequence}: {result:?}"),
            }
        }
        tokio::task::yield_now().await;
    }

    let persisted = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "preview-after-dropped-requests",
            "draft-after-dropped-requests",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        rounds,
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap();
    assert_eq!(persisted.target_draft_id, "draft-after-dropped-requests");
    assert_eq!(persisted.status, "draft");
}

#[tokio::test]
async fn stale_preview_finishing_after_a_new_preview_cannot_become_active() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-preview-generation").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let summarizer = BlockingSummarizer {
        entered: entered.clone(),
        release: release.clone(),
    };
    let rounds = vec![relay_round("round-1", "latest preview wins")];
    let old_preview = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "old-preview-request",
            "draft-generation",
            source,
            RelayScopeType::Summary,
        ))
        .await,
        rounds.clone(),
        &summarizer,
    );
    tokio::pin!(old_preview);
    tokio::select! {
        () = entered.notified() => {}
        result = &mut old_preview => panic!("old preview completed before overlap: {result:?}"),
    }

    let latest = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "latest-preview-request",
            "draft-generation",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        rounds,
        &summarizer,
    )
    .await
    .unwrap();
    release.notify_one();
    let old_error = old_preview.await.unwrap_err();

    assert_eq!(
        old_error.message,
        RelayErrorCode::RelaySourceUnavailable.to_string()
    );
    let active = get_relay_context_by_draft_core(&db.conn, "draft-generation")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(active.id, latest.id);
    assert_eq!(active.scope.scope_type, RelayScopeType::RecentRounds);
    assert!(active.snapshot.summary.is_none());
}

#[tokio::test]
async fn late_cancel_for_an_old_request_does_not_cancel_the_latest_preview() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-late-cancel").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let summarizer = RunnerBackedFailingSummarizer;
    let rounds = vec![relay_round("round-1", "late cancel")];
    preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "finished-old-request",
            "draft-late-cancel",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        rounds.clone(),
        &summarizer,
    )
    .await
    .unwrap();
    let latest = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "finished-latest-request",
            "draft-late-cancel",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        rounds,
        &summarizer,
    )
    .await
    .unwrap();

    assert!(!cancel_relay_preview_core("finished-old-request").await);
    let active = get_relay_context_by_draft_core(&db.conn, "draft-late-cancel")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(active.id, latest.id);
    assert_eq!(active.status, "draft");
}

#[tokio::test(flavor = "current_thread")]
async fn cancelled_request_cannot_reenter_after_reservation_cleanup_boundary() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-cancel-tombstone").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let rounds = vec![relay_round(
        "round-1",
        "cancelled request must stay cancelled",
    )];

    let cancelled_request = preview_request(
        "cancelled-before-preview",
        "draft-cancel-tombstone",
        source,
        RelayScopeType::RecentRounds,
    );
    assert!(
        reserve_relay_preview_core(
            &cancelled_request.request_id,
            &cancelled_request.target_draft_id
        )
        .await
    );
    assert!(cancel_relay_preview_core(&cancelled_request.request_id).await);
    let latest = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "latest-valid-preview",
            "draft-cancel-tombstone",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        rounds.clone(),
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap();

    tokio::time::pause();
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_secs(31)).await;
    tokio::task::yield_now().await;

    let late_error = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        cancelled_request,
        rounds,
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap_err();

    assert_eq!(
        late_error.message,
        RelayErrorCode::RelaySourceUnavailable.to_string()
    );
    let active = get_relay_context_by_draft_core(&db.conn, "draft-cancel-tombstone")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(active.id, latest.id);
    assert_eq!(active.status, "draft");
}

#[tokio::test(flavor = "current_thread")]
async fn abandoned_reservation_expires_and_cannot_be_claimed() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-abandoned-reservation").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let request = preview_request(
        "abandoned-preview-request",
        "draft-abandoned-reservation",
        source,
        RelayScopeType::RecentRounds,
    );

    tokio::time::pause();
    assert!(reserve_relay_preview_core(&request.request_id, &request.target_draft_id).await);
    tokio::time::advance(Duration::from_secs(31)).await;
    tokio::task::yield_now().await;

    let error = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        request,
        vec![relay_round("round-1", "expired reservation")],
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap_err();

    assert_eq!(
        error.message,
        RelayErrorCode::RelaySourceUnavailable.to_string()
    );
    assert!(!cancel_relay_preview_core("abandoned-preview-request").await);
}

#[tokio::test(flavor = "current_thread")]
async fn old_cleanup_does_not_remove_a_reused_request_id_reservation() {
    tokio::time::pause();

    for (sequence, (old_draft, new_draft)) in [
        ("draft-aba-same", "draft-aba-same"),
        ("draft-aba-old", "draft-aba-new"),
    ]
    .into_iter()
    .enumerate()
    {
        let request_id = format!("reused-reservation-{sequence}");
        assert!(reserve_relay_preview_core(&request_id, old_draft).await);
        assert!(cancel_relay_preview_core(&request_id).await);

        tokio::time::advance(Duration::from_secs(20)).await;
        assert!(reserve_relay_preview_core(&request_id, new_draft).await);
        tokio::time::advance(Duration::from_secs(11)).await;
        tokio::task::yield_now().await;

        assert!(cancel_relay_preview_core(&request_id).await);
    }
}

#[tokio::test]
async fn overlong_target_draft_id_is_not_reserved() {
    let request_id = "overlong-target-draft-reservation";
    let target_draft_id = "x".repeat(513);

    assert!(!reserve_relay_preview_core(request_id, &target_draft_id).await);
    assert!(!cancel_relay_preview_core(request_id).await);
}

#[tokio::test]
async fn unknown_cancel_storm_does_not_block_a_valid_preview() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-cancel-storm").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;

    for sequence in 0..=1_024 {
        assert!(!cancel_relay_preview_core(&format!("unknown-cancel-{sequence}")).await);
    }

    let persisted = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "valid-preview-after-cancel-storm",
            "draft-after-cancel-storm",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        vec![relay_round("round-1", "valid preview")],
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap();

    assert_eq!(persisted.target_draft_id, "draft-after-cancel-storm");
    assert_eq!(persisted.status, "draft");
}

#[tokio::test]
async fn summary_patch_failure_keeps_the_previous_valid_draft_unchanged() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-summary-failure").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let original = insert_pack(&db.conn, "draft-summary", source, None, "draft")
        .await
        .unwrap();
    let scope = RelayScopeSelection {
        scope_type: RelayScopeType::RecentRounds,
        selected_round_ids: vec!["round-1".to_owned()],
    };
    let snapshot = RelaySnapshot {
        version: 1,
        source: RelaySnapshotSource {
            conversation_id: source,
            folder_id,
        },
        scope: scope.clone(),
        available_rounds: vec![relay_round("round-1", "runner failure input")],
        included_rounds: Vec::new(),
        summary: None,
        files: Vec::new(),
        stats: RelayStats::default(),
        canonical_context: "previous valid context".to_owned(),
    };
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::SnapshotJson,
            sea_orm::sea_query::Expr::value(serde_json::to_string(&snapshot).unwrap()),
        )
        .filter(relay_context_pack::Column::Id.eq(original.id))
        .exec(&db.conn)
        .await
        .unwrap();
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::SourceFingerprint,
            sea_orm::sea_query::Expr::value(fingerprint_rounds(&snapshot.available_rounds)),
        )
        .filter(relay_context_pack::Column::Id.eq(original.id))
        .exec(&db.conn)
        .await
        .unwrap();
    let before_failure = relay_context_pack::Entity::find_by_id(original.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();

    let error = update_relay_context_with_summarizer_core(
        &db,
        original.id,
        RelayPatchRequest {
            scope: RelayScopeSelection {
                scope_type: RelayScopeType::Summary,
                selected_round_ids: vec!["round-1".to_owned()],
            },
            target_agent_type: AgentType::Codex,
            target_model: None,
        },
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap_err();

    assert_eq!(
        error.message,
        RelayErrorCode::RelaySummaryUnavailable.to_string()
    );
    let retained = relay_context_pack::Entity::find_by_id(original.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retained.id, before_failure.id);
    assert_eq!(retained.snapshot_json, before_failure.snapshot_json);
    assert_eq!(retained.status, before_failure.status);
    assert_eq!(
        get_active_by_draft(&db.conn, "draft-summary")
            .await
            .unwrap()
            .unwrap()
            .id,
        original.id
    );
}

#[tokio::test]
async fn restore_remove_and_consumed_provenance_use_stable_views() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-controller-views").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let target = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let draft = insert_pack(&db.conn, "draft-view", source, None, "draft")
        .await
        .unwrap();
    let draft_snapshot = RelaySnapshot {
        version: 1,
        source: RelaySnapshotSource {
            conversation_id: source,
            folder_id,
        },
        scope: RelayScopeSelection {
            scope_type: RelayScopeType::Summary,
            selected_round_ids: Vec::new(),
        },
        available_rounds: Vec::new(),
        included_rounds: Vec::new(),
        summary: None,
        files: Vec::new(),
        stats: RelayStats::default(),
        canonical_context: "restorable context".to_owned(),
    };
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::SnapshotJson,
            sea_orm::sea_query::Expr::value(serde_json::to_string(&draft_snapshot).unwrap()),
        )
        .filter(relay_context_pack::Column::Id.eq(draft.id))
        .exec(&db.conn)
        .await
        .unwrap();
    insert_pack(&db.conn, "consumed-view", source, Some(target), "consumed")
        .await
        .unwrap();

    let restored = get_relay_context_by_draft_core(&db.conn, "draft-view")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(restored.id, draft.id);
    let provenance = get_conversation_relay_core(&db.conn, target)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(provenance.source_conversation_id, source);

    let removed = remove_relay_context_core(&db.conn, &EventEmitter::Noop, draft.id)
        .await
        .unwrap();
    assert_eq!(removed.status, "removed");
    assert!(get_relay_context_by_draft_core(&db.conn, "draft-view")
        .await
        .unwrap()
        .is_none());
}
