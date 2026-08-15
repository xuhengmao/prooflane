use codeg_lib::acp::connection::{ConnectionCommand, RelayPromptOutcome, RelayPromptRejection};
use codeg_lib::acp::manager::ConnectionManager;
use codeg_lib::acp::types::PromptInputBlock;
use codeg_lib::commands::acp::{send_prompt_with_relay_core, AcpPromptRequest};
use codeg_lib::commands::conversations::{
    create_conversation_with_relay_core, get_folder_conversation_core,
    get_folder_conversation_with_live_core, relay_binding_from_parts, RelayBindingInput,
};
use codeg_lib::conversation_relay::context::{
    build_hidden_relay_block, marker_for_snapshot, strip_hidden_relay_context, RelayContextMarker,
};
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
use codeg_lib::conversation_relay::{
    build_relay_snapshot, fingerprint_rounds, normalize_relay_rounds,
};
use codeg_lib::db::entities::{conversation, conversation_capability_setting, relay_context_pack};
use codeg_lib::db::service::conversation_capability_service::{
    get_capabilities, set_relay_enabled,
};
use codeg_lib::db::service::conversation_service::update_external_id;
use codeg_lib::db::service::relay_context_pack_service::{
    bind_to_conversation, claim_consume, create_or_replace_draft, get_active_by_draft,
    invalidate_unconsumed_by_source, mark_consumed, mark_uncertain, release_claim,
    remove_unclaimed, ConsumeClaim, NewRelayPack,
};
use codeg_lib::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use codeg_lib::models::agent::AgentType;
use codeg_lib::models::conversation_relay::{
    RelayError, RelayErrorCode, RelayFileReference, RelayRound, RelayScopeSelection,
    RelayScopeType, RelaySnapshot, RelaySnapshotSource, RelayStats, RelaySummary,
};
use codeg_lib::models::message::ContentBlock;
use codeg_lib::restricted_codex::{RestrictedCodexError, RestrictedCodexRequest};
use codeg_lib::web::event_bridge::EventEmitter;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DbBackend, EntityTrait, PaginatorTrait,
    QueryFilter, Set, Statement, TransactionTrait,
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

struct SuccessfulSummarizer;

#[async_trait::async_trait]
impl RelaySummarizer for SuccessfulSummarizer {
    async fn summarize(&self, rounds: &[RelayRound]) -> Result<RelayStructuredSummary, RelayError> {
        Ok(RelayStructuredSummary {
            goal: vec![RelaySummaryItem {
                text: "continue the selected work".to_owned(),
                source_round_ids: rounds.iter().map(|round| round.id.clone()).collect(),
            }],
            ..RelayStructuredSummary::default()
        })
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
async fn migration_adds_the_preview_target_model_identity() {
    let db = fresh_in_memory_db().await;
    let columns = db
        .conn
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(relay_context_pack)".to_owned(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect::<Vec<_>>();

    assert!(
        columns.iter().any(|column| column == "target_model"),
        "relay packs must retain the exact preview model identity"
    );
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

#[tokio::test]
async fn first_create_and_relay_bind_are_atomic() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-first-create").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let pack = insert_pack(&db.conn, "draft-a", source, None, "draft")
        .await
        .unwrap();

    let result = create_conversation_with_relay_core(
        &db.conn,
        folder_id,
        AgentType::Codex,
        Some("first".into()),
        Some(RelayBindingInput {
            relay_id: pack.id,
            target_draft_id: "draft-a".into(),
        }),
    )
    .await
    .unwrap();

    let bound = relay_context_pack::Entity::find_by_id(pack.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(bound.target_conversation_id, Some(result));
    assert_eq!(bound.status, "attached");
}

#[test]
fn hidden_context_round_trips_without_changing_user_blocks() {
    let snapshot = "deterministic relay context";
    let marker = marker_for_snapshot(7, snapshot);
    let user = vec![PromptInputBlock::Text {
        text: "fix login".into(),
    }];
    let mut wire = vec![build_hidden_relay_block(&marker, snapshot)];
    wire.extend(user.clone());

    assert_eq!(
        serde_json::to_value(strip_hidden_relay_context(&wire, Some(&marker))).unwrap(),
        serde_json::to_value(&user).unwrap()
    );
    assert_eq!(
        serde_json::to_value(strip_hidden_relay_context(&wire, None)).unwrap(),
        serde_json::to_value(&wire).unwrap()
    );

    let forged = RelayContextMarker {
        relay_id: 8,
        snapshot_sha256: marker.snapshot_sha256.clone(),
    };
    assert_eq!(
        serde_json::to_value(strip_hidden_relay_context(&wire, Some(&forged))).unwrap(),
        serde_json::to_value(&wire).unwrap()
    );
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
        target_model: None,
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
async fn relay_draft_persists_the_exact_preview_model_identity() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-model-identity").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let mut pack = new_pack("draft-model-identity", source, folder_id);
    pack.target_model = Some("gpt-4o".to_owned());

    let stored = create_or_replace_draft(&db.conn, pack).await.unwrap();

    assert_eq!(stored.target_model.as_deref(), Some("gpt-4o"));
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
async fn disabling_relay_does_not_interrupt_a_claimed_pack() {
    let db = seeded_relay_db().await;
    claim_consume(&db.conn, 1, "message-disable-in-flight")
        .await
        .unwrap();

    let settings = set_relay_enabled(&db.conn, &EventEmitter::Noop, false)
        .await
        .unwrap();

    assert!(!settings.relay_enabled);
    assert_eq!(status(&db.conn, 1).await, "attached");
    let consumed = mark_consumed(
        &db.conn,
        1,
        "message-disable-in-flight",
        "{\"immutable\":true}",
    )
    .await
    .unwrap();
    assert_eq!(consumed.status, "consumed");
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
async fn replacing_a_claimed_draft_is_rejected_without_interrupting_finalization() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-replace-claimed").await;
    let source = seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    let target = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let first = create_or_replace_draft(
        &db.conn,
        new_pack("draft-replace-claimed", source, folder_id),
    )
    .await
    .unwrap();
    let txn = db.conn.begin().await.unwrap();
    bind_to_conversation(&txn, first.id, "draft-replace-claimed", target)
        .await
        .unwrap();
    txn.commit().await.unwrap();
    claim_consume(&db.conn, first.id, "message-replace-claimed")
        .await
        .unwrap();

    let replacement = create_or_replace_draft(
        &db.conn,
        new_pack("draft-replace-claimed", source, folder_id),
    )
    .await;

    assert!(replacement.is_err());
    let retained = relay_context_pack::Entity::find_by_id(first.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retained.status, "attached");
    assert_eq!(retained.consume_attempt_state.as_deref(), Some("claimed"));
    assert!(mark_consumed(
        &db.conn,
        first.id,
        "message-replace-claimed",
        "{\"immutable\":true}",
    )
    .await
    .is_ok());
}

#[tokio::test]
async fn preview_cannot_replace_a_claimed_draft() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-preview-claimed").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let target = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let rounds = vec![relay_round("round-1", "keep the claimed preview")];
    let original = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "initial-claimed-preview",
            "draft-preview-claimed",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        rounds.clone(),
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap();
    let txn = db.conn.begin().await.unwrap();
    bind_to_conversation(&txn, original.id, "draft-preview-claimed", target)
        .await
        .unwrap();
    txn.commit().await.unwrap();
    claim_consume(&db.conn, original.id, "message-preview-claimed")
        .await
        .unwrap();

    let replacement = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(preview_request(
            "replacement-claimed-preview",
            "draft-preview-claimed",
            source,
            RelayScopeType::RecentRounds,
        ))
        .await,
        rounds,
        &RunnerBackedFailingSummarizer,
    )
    .await;

    assert!(replacement.is_err());
    let retained = relay_context_pack::Entity::find_by_id(original.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retained.status, "attached");
    assert_eq!(retained.consume_attempt_state.as_deref(), Some("claimed"));
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
async fn invalidating_a_source_does_not_interrupt_a_claimed_relay_finalizer() {
    let db = seeded_relay_db().await;
    claim_consume(&db.conn, 1, "message-in-flight")
        .await
        .unwrap();

    let invalidated = invalidate_unconsumed_by_source(&db.conn, 1, "relay_source_not_found")
        .await
        .unwrap();

    assert_eq!(invalidated, 1);
    let marked = relay_context_pack::Entity::find_by_id(1)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(marked.status, "attached");
    assert_eq!(
        marked.invalid_reason.as_deref(),
        Some("relay_source_not_found")
    );
    let consumed = mark_consumed(&db.conn, 1, "message-in-flight", "{\"immutable\":true}")
        .await
        .unwrap();
    assert_eq!(consumed.status, "consumed");
    assert!(consumed.invalid_reason.is_none());
    assert_eq!(
        consumed.consumed_snapshot_json.as_deref(),
        Some("{\"immutable\":true}")
    );
}

#[tokio::test]
async fn releasing_a_claim_after_source_invalidation_cannot_restore_attached() {
    let db = seeded_relay_db().await;
    claim_consume(&db.conn, 1, "message-source-deleted")
        .await
        .unwrap();
    invalidate_unconsumed_by_source(&db.conn, 1, "relay_source_not_found")
        .await
        .unwrap();

    let released = release_claim(&db.conn, 1, "message-source-deleted")
        .await
        .unwrap();

    assert_eq!(released.status, "invalid");
    assert_eq!(
        released.invalid_reason.as_deref(),
        Some("relay_source_not_found")
    );
    assert!(released.consume_client_message_id.is_none());
    assert!(get_active_by_draft(&db.conn, "draft-claim")
        .await
        .unwrap()
        .is_none());
    assert!(matches!(
        claim_consume(&db.conn, 1, "message-after-delete").await,
        Err(error) if error.code == RelayErrorCode::RelayConsumeConflict
    ));
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
async fn empty_recent_scope_freezes_the_last_ten_complete_rounds() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-default-range").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let mut request = preview_request(
        "default-recent-preview",
        "draft-default-recent",
        source,
        RelayScopeType::RecentRounds,
    );
    request.scope.selected_round_ids.clear();
    let rounds = (1..=12)
        .map(|index| relay_round(&format!("round-{index}"), &format!("question {index}")))
        .collect::<Vec<_>>();

    let preview = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(request).await,
        rounds,
        &RunnerBackedFailingSummarizer,
    )
    .await
    .unwrap();

    assert_eq!(
        preview.scope.selected_round_ids,
        (3..=12)
            .map(|index| format!("round-{index}"))
            .collect::<Vec<_>>()
    );
    assert_eq!(preview.snapshot.included_rounds.len(), 10);
}

#[tokio::test]
async fn empty_summary_scope_freezes_all_complete_rounds() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-summary-range").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let mut request = preview_request(
        "default-summary-preview",
        "draft-default-summary",
        source,
        RelayScopeType::Summary,
    );
    request.scope.selected_round_ids.clear();

    let preview = preview_relay_context_from_rounds_with_summarizer_core(
        &db,
        reserved_preview_request(request).await,
        vec![
            relay_round("round-1", "first question"),
            relay_round("round-2", "second question"),
        ],
        &SuccessfulSummarizer,
    )
    .await
    .unwrap();

    assert_eq!(
        preview.scope.selected_round_ids,
        vec!["round-1".to_owned(), "round-2".to_owned()]
    );
    assert_eq!(preview.snapshot.included_rounds.len(), 2);
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
    let consumed = insert_pack(&db.conn, "consumed-view", source, Some(target), "consumed")
        .await
        .unwrap();
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::ConsumedSnapshotJson,
            sea_orm::sea_query::Expr::value(Some(serde_json::to_string(&draft_snapshot).unwrap())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumedAt,
            sea_orm::sea_query::Expr::value(Some(chrono::Utc::now())),
        )
        .filter(relay_context_pack::Column::Id.eq(consumed.id))
        .exec(&db.conn)
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
    assert_eq!(provenance.source.conversation_id, source);

    let removed = remove_relay_context_core(&db.conn, &EventEmitter::Noop, draft.id)
        .await
        .unwrap();
    assert_eq!(removed.status, "removed");
    assert!(get_relay_context_by_draft_core(&db.conn, "draft-view")
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn consumed_provenance_uses_immutable_snapshot_and_deleted_source_fallback() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-provenance-snapshot").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let target = seed_conversation(&db, folder_id, AgentType::Codex).await;
    conversation::Entity::update_many()
        .col_expr(
            conversation::Column::Title,
            sea_orm::sea_query::Expr::value(Some("Source at consumption".to_owned())),
        )
        .filter(conversation::Column::Id.eq(source))
        .exec(&db.conn)
        .await
        .unwrap();

    let mut snapshot = reloaded_relay_snapshot(source, folder_id);
    let file = RelayFileReference {
        path: "src/auth.ts".to_owned(),
        mime_type: Some("text/typescript".to_owned()),
        source_message_id: "message-reload-round".to_owned(),
    };
    snapshot.summary = Some(RelaySummary {
        goals: vec!["finish authentication".to_owned()],
        decisions: vec!["keep local storage".to_owned()],
        progress: vec!["login form completed".to_owned()],
        todos: vec!["add refresh flow".to_owned()],
        constraints: vec!["offline first".to_owned()],
        files: vec![file.path.clone()],
        open_questions: vec!["token rotation interval".to_owned()],
    });
    snapshot.files = vec![file.clone()];
    snapshot.stats.file_count = 1;
    let consumed_at = chrono::Utc::now();
    let pack = insert_pack(
        &db.conn,
        "draft-provenance-snapshot",
        source,
        Some(target),
        "consumed",
    )
    .await
    .unwrap();
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::ConsumedSnapshotJson,
            sea_orm::sea_query::Expr::value(Some(serde_json::to_string(&snapshot).unwrap())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumedAt,
            sea_orm::sea_query::Expr::value(Some(consumed_at)),
        )
        .col_expr(
            relay_context_pack::Column::SnapshotJson,
            sea_orm::sea_query::Expr::value("{\"mutated\":true}"),
        )
        .col_expr(
            relay_context_pack::Column::ScopeType,
            sea_orm::sea_query::Expr::value("custom_rounds"),
        )
        .col_expr(
            relay_context_pack::Column::SelectedRoundIdsJson,
            sea_orm::sea_query::Expr::value("[\"mutated-round\"]"),
        )
        .filter(relay_context_pack::Column::Id.eq(pack.id))
        .exec(&db.conn)
        .await
        .unwrap();

    let provenance = get_conversation_relay_core(&db.conn, target)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(provenance.relay_id, pack.id);
    assert_eq!(
        provenance.snapshot_sha256,
        marker_for_snapshot(pack.id, &snapshot.canonical_context).snapshot_sha256
    );
    assert_eq!(provenance.source.conversation_id, source);
    assert_eq!(provenance.source.folder_id, folder_id);
    assert_eq!(provenance.source.title, "Source at consumption");
    assert_eq!(provenance.scope, snapshot.scope);
    assert_eq!(provenance.summary, snapshot.summary);
    assert_eq!(provenance.included_rounds, snapshot.included_rounds);
    assert_eq!(provenance.files, vec![file]);
    assert_eq!(provenance.stats, snapshot.stats);
    assert_eq!(provenance.consumed_at, Some(consumed_at));

    conversation::Entity::update_many()
        .col_expr(
            conversation::Column::DeletedAt,
            sea_orm::sea_query::Expr::value(Some(chrono::Utc::now())),
        )
        .filter(conversation::Column::Id.eq(source))
        .exec(&db.conn)
        .await
        .unwrap();

    let deleted_source = get_conversation_relay_core(&db.conn, target)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(deleted_source.source.title, format!("会话 #{source}"));
}

#[test]
fn relay_binding_rejects_single_sided_request_fields() {
    assert!(relay_binding_from_parts(Some(1), None).is_err());
    assert!(relay_binding_from_parts(None, Some("draft-1".to_owned())).is_err());
    assert!(relay_binding_from_parts(None, None).unwrap().is_none());
    assert_eq!(
        relay_binding_from_parts(Some(1), Some("draft-1".to_owned()))
            .unwrap()
            .unwrap()
            .relay_id,
        1
    );
}

#[tokio::test]
async fn consumed_retry_is_idempotent_after_the_connection_is_gone() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-consumed-retry").await;
    let source = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let target = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let pack = insert_pack(
        &db.conn,
        "draft-consumed-retry",
        source,
        Some(target),
        "consumed",
    )
    .await
    .unwrap();
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::ConsumeClientMessageId,
            sea_orm::sea_query::Expr::value(Some("message-consumed".to_owned())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumedSnapshotJson,
            sea_orm::sea_query::Expr::value(Some("{\"immutable\":true}".to_owned())),
        )
        .filter(relay_context_pack::Column::Id.eq(pack.id))
        .exec(&db.conn)
        .await
        .unwrap();

    let result = send_prompt_with_relay_core(
        &ConnectionManager::new(),
        &db,
        &EventEmitter::Noop,
        AcpPromptRequest {
            connection_id: "already-disconnected".to_owned(),
            blocks: vec![PromptInputBlock::Text {
                text: "do not send twice".to_owned(),
            }],
            folder_id: Some(folder_id),
            conversation_id: Some(target),
            client_message_id: Some("message-consumed".to_owned()),
            relay_id: Some(pack.id),
            target_draft_id: Some("draft-consumed-retry".to_owned()),
        },
    )
    .await;

    assert!(
        result.is_ok(),
        "same-id consumed retry must be a no-op: {result:?}"
    );
}

struct RelaySendCoreTranscriptFixture {
    transcript_dir: std::path::PathBuf,
}

impl Drop for RelaySendCoreTranscriptFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.transcript_dir);
    }
}

fn reloaded_relay_snapshot(source: i32, folder_id: i32) -> RelaySnapshot {
    let included_round = relay_round("reload-round", "source request");
    RelaySnapshot {
        version: 1,
        source: RelaySnapshotSource {
            conversation_id: source,
            folder_id,
        },
        scope: RelayScopeSelection {
            scope_type: RelayScopeType::RecentRounds,
            selected_round_ids: vec![included_round.id.clone()],
        },
        available_rounds: vec![included_round.clone()],
        included_rounds: vec![included_round],
        summary: None,
        files: Vec::new(),
        stats: RelayStats {
            message_count: 2,
            file_count: 0,
            todo_count: 0,
        },
        canonical_context: "SECRET_RELAY_BODY".to_owned(),
    }
}

async fn seed_consumed_relay_target(
    db: &codeg_lib::db::AppDatabase,
    folder_id: i32,
    agent_id: &'static str,
    session_id: &str,
    prompts: impl FnOnce(i32, &RelaySnapshot) -> Vec<Vec<PromptInputBlock>>,
) -> (i32, RelaySendCoreTranscriptFixture) {
    let source = seed_conversation(db, folder_id, AgentType::Codex).await;
    let target_agent = AgentType::Custom(agent_id);
    let target = seed_conversation(db, folder_id, target_agent).await;
    update_external_id(&db.conn, target, session_id.to_owned())
        .await
        .unwrap();
    let snapshot = reloaded_relay_snapshot(source, folder_id);
    let pack = insert_pack(
        &db.conn,
        &format!("draft-{session_id}"),
        source,
        Some(target),
        "consumed",
    )
    .await
    .unwrap();
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::ConsumedSnapshotJson,
            sea_orm::sea_query::Expr::value(Some(serde_json::to_string(&snapshot).unwrap())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumedAt,
            sea_orm::sea_query::Expr::value(Some(chrono::Utc::now())),
        )
        .filter(relay_context_pack::Column::Id.eq(pack.id))
        .exec(&db.conn)
        .await
        .unwrap();

    let agent_dir = codeg_lib::acp::registry::registry_id_for(target_agent);
    let transcript_dir = codeg_lib::paths::codeg_acp_transcripts_root().join(agent_dir);
    let _ = std::fs::remove_dir_all(&transcript_dir);
    codeg_lib::acp_transcript::record_header(
        agent_dir,
        &codeg_lib::acp_transcript::TranscriptHeader::new(
            &target_agent.as_wire(),
            session_id,
            "C:/workspace/relay-reload",
            codeg_lib::acp_transcript::now_epoch_ms(),
        ),
    )
    .await
    .unwrap();
    for prompt in prompts(pack.id, &snapshot) {
        codeg_lib::acp_transcript::record_entry(
            agent_dir,
            session_id,
            codeg_lib::acp_transcript::EntryKind::Prompt,
            serde_json::to_value(prompt).unwrap(),
        )
        .await
        .unwrap();
        codeg_lib::acp_transcript::record_entry(
            agent_dir,
            session_id,
            codeg_lib::acp_transcript::EntryKind::TurnEnd,
            serde_json::json!({ "stopReason": "end_turn" }),
        )
        .await
        .unwrap();
    }

    (target, RelaySendCoreTranscriptFixture { transcript_dir })
}

fn text_block(block: &ContentBlock) -> &str {
    match block {
        ContentBlock::Text { text } => text,
        other => panic!("expected text block, got {other:?}"),
    }
}

#[tokio::test]
async fn hidden_context_is_removed_from_reloaded_detail() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-reload-matched").await;
    let (target, _fixture) = seed_consumed_relay_target(
        &db,
        folder_id,
        "relay-reload-matched",
        "relay-reload-matched-session",
        |relay_id, snapshot| {
            let marker = marker_for_snapshot(relay_id, &snapshot.canonical_context);
            vec![vec![
                build_hidden_relay_block(&marker, &snapshot.canonical_context),
                PromptInputBlock::Text {
                    text: "actual user request".to_owned(),
                },
            ]]
        },
    )
    .await;

    let (detail, parsed_title) = get_folder_conversation_core(&db.conn, target)
        .await
        .unwrap();

    assert_eq!(detail.turns.len(), 1);
    assert_eq!(detail.turns[0].blocks.len(), 1);
    assert_eq!(
        text_block(&detail.turns[0].blocks[0]),
        "actual user request"
    );
    assert_eq!(parsed_title.as_deref(), Some("actual user request"));

    let live_detail = get_folder_conversation_with_live_core(
        &db.conn,
        &ConnectionManager::new(),
        &codeg_lib::chat_channel::manager::ChatChannelManager::new(),
        &EventEmitter::Noop,
        target,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        live_detail.summary.title.as_deref(),
        Some("actual user request")
    );
    let persisted = conversation::Entity::find_by_id(target)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(persisted.title.as_deref(), Some("actual user request"));
}

#[tokio::test]
async fn reloaded_detail_preserves_hidden_block_with_wrong_relay_id() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-reload-wrong-id").await;
    let (target, _fixture) = seed_consumed_relay_target(
        &db,
        folder_id,
        "relay-reload-wrong-id",
        "relay-reload-wrong-id-session",
        |relay_id, snapshot| {
            let marker = marker_for_snapshot(relay_id + 1, &snapshot.canonical_context);
            vec![vec![
                build_hidden_relay_block(&marker, &snapshot.canonical_context),
                PromptInputBlock::Text {
                    text: "actual user request".to_owned(),
                },
            ]]
        },
    )
    .await;

    let (detail, _) = get_folder_conversation_core(&db.conn, target)
        .await
        .unwrap();

    assert_eq!(detail.turns[0].blocks.len(), 2);
    assert!(text_block(&detail.turns[0].blocks[0]).contains("SECRET_RELAY_BODY"));
}

#[tokio::test]
async fn reloaded_detail_preserves_hidden_block_with_wrong_snapshot_hash() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-reload-wrong-hash").await;
    let (target, _fixture) = seed_consumed_relay_target(
        &db,
        folder_id,
        "relay-reload-wrong-hash",
        "relay-reload-wrong-hash-session",
        |relay_id, snapshot| {
            let marker = RelayContextMarker {
                relay_id,
                snapshot_sha256: "0".repeat(64),
            };
            vec![vec![
                build_hidden_relay_block(&marker, &snapshot.canonical_context),
                PromptInputBlock::Text {
                    text: "actual user request".to_owned(),
                },
            ]]
        },
    )
    .await;

    let (detail, _) = get_folder_conversation_core(&db.conn, target)
        .await
        .unwrap();

    assert_eq!(detail.turns[0].blocks.len(), 2);
    assert!(text_block(&detail.turns[0].blocks[0]).contains("SECRET_RELAY_BODY"));
}

#[tokio::test]
async fn reloaded_detail_preserves_mixed_or_later_relay_like_text() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-reload-user-text").await;
    let (target, _fixture) = seed_consumed_relay_target(
        &db,
        folder_id,
        "relay-reload-user-text",
        "relay-reload-user-text-session",
        |relay_id, snapshot| {
            let marker = marker_for_snapshot(relay_id, &snapshot.canonical_context);
            let hidden = build_hidden_relay_block(&marker, &snapshot.canonical_context);
            let PromptInputBlock::Text { text: hidden_text } = hidden else {
                unreachable!()
            };
            vec![
                vec![PromptInputBlock::Text {
                    text: format!("user prefix\n{hidden_text}"),
                }],
                vec![
                    build_hidden_relay_block(&marker, &snapshot.canonical_context),
                    PromptInputBlock::Text {
                        text: "later user request".to_owned(),
                    },
                ],
            ]
        },
    )
    .await;

    let (detail, _) = get_folder_conversation_core(&db.conn, target)
        .await
        .unwrap();

    assert_eq!(detail.turns.len(), 2);
    assert!(text_block(&detail.turns[0].blocks[0]).starts_with("user prefix"));
    assert_eq!(detail.turns[1].blocks.len(), 2);
    assert!(text_block(&detail.turns[1].blocks[0]).contains("SECRET_RELAY_BODY"));
}

async fn assert_invalid_consumed_snapshot_fails_closed(
    agent_id: &'static str,
    session_id: &str,
    consumed_snapshot_json: Option<&str>,
) {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, &format!("C:/workspace/{session_id}")).await;
    let (target, _fixture) = seed_consumed_relay_target(
        &db,
        folder_id,
        agent_id,
        session_id,
        |relay_id, snapshot| {
            let marker = marker_for_snapshot(relay_id, &snapshot.canonical_context);
            vec![vec![
                build_hidden_relay_block(&marker, &snapshot.canonical_context),
                PromptInputBlock::Text {
                    text: "actual user request".to_owned(),
                },
            ]]
        },
    )
    .await;
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::ConsumedSnapshotJson,
            sea_orm::sea_query::Expr::value(consumed_snapshot_json.map(str::to_owned)),
        )
        .filter(relay_context_pack::Column::TargetConversationId.eq(target))
        .exec(&db.conn)
        .await
        .unwrap();

    let error = get_folder_conversation_core(&db.conn, target)
        .await
        .expect_err("invalid consumed snapshot must not return hidden transcript content");

    assert_eq!(error.message, "relay_source_unavailable");
}

#[tokio::test]
async fn reloaded_detail_fails_closed_when_consumed_snapshot_is_missing() {
    assert_invalid_consumed_snapshot_fails_closed(
        "relay-reload-missing-snapshot",
        "relay-reload-missing-snapshot-session",
        None,
    )
    .await;
}

#[tokio::test]
async fn reloaded_detail_fails_closed_when_consumed_snapshot_is_malformed() {
    assert_invalid_consumed_snapshot_fails_closed(
        "relay-reload-malformed-snapshot",
        "relay-reload-malformed-snapshot-session",
        Some("{not-json"),
    )
    .await;
}

async fn seed_relay_send_core_source(
    db: &codeg_lib::db::AppDatabase,
    folder_id: i32,
    agent_id: &'static str,
    session_id: &str,
    folder_path: &str,
) -> (i32, RelaySnapshot, RelaySendCoreTranscriptFixture) {
    let agent_type = AgentType::Custom(agent_id);
    let agent_dir = codeg_lib::acp::registry::registry_id_for(agent_type);
    let transcript_dir = codeg_lib::paths::codeg_acp_transcripts_root().join(agent_dir);
    let _ = std::fs::remove_dir_all(&transcript_dir);

    codeg_lib::acp_transcript::record_header(
        agent_dir,
        &codeg_lib::acp_transcript::TranscriptHeader::new(
            &agent_type.as_wire(),
            session_id,
            folder_path,
            codeg_lib::acp_transcript::now_epoch_ms(),
        ),
    )
    .await
    .unwrap();
    codeg_lib::acp_transcript::record_entry(
        agent_dir,
        session_id,
        codeg_lib::acp_transcript::EntryKind::Prompt,
        serde_json::json!([{ "type": "text", "text": "inspect the source history" }]),
    )
    .await
    .unwrap();
    let update = codeg_lib::acp_transcript::record_entry(
        agent_dir,
        session_id,
        codeg_lib::acp_transcript::EntryKind::Update,
        serde_json::json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "source history inspected" }
        }),
    );
    codeg_lib::acp_transcript::record_entry(
        agent_dir,
        session_id,
        codeg_lib::acp_transcript::EntryKind::TurnEnd,
        serde_json::json!({ "stopReason": "end_turn" }),
    )
    .await
    .unwrap();
    update.await.unwrap();

    let source = seed_conversation(&db, folder_id, agent_type).await;
    update_external_id(&db.conn, source, session_id.to_owned())
        .await
        .unwrap();
    let (source_detail, _) = get_folder_conversation_core(&db.conn, source)
        .await
        .unwrap();
    let available_rounds = normalize_relay_rounds(&source_detail.turns);
    let scope = RelayScopeSelection {
        scope_type: RelayScopeType::Summary,
        selected_round_ids: vec![available_rounds[0].id.clone()],
    };
    let snapshot = build_relay_snapshot(
        RelaySnapshotSource {
            conversation_id: source,
            folder_id,
        },
        scope,
        available_rounds,
        None,
    )
    .unwrap();

    (
        source,
        snapshot,
        RelaySendCoreTranscriptFixture { transcript_dir },
    )
}

#[tokio::test]
async fn relay_send_core_claims_splits_wire_content_and_persists_the_actor_outcome() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-send-core").await;
    let (source, snapshot, _fixture) = seed_relay_send_core_source(
        &db,
        folder_id,
        "relay-core-test-accepted",
        "relay-core-test-accepted-session",
        "C:/workspace/relay-send-core",
    )
    .await;
    let target = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let snapshot_json = serde_json::to_string(&snapshot).unwrap();
    let estimated_tokens =
        codeg_lib::conversation_relay::estimate_relay_tokens(&snapshot.canonical_context);
    let pack = create_or_replace_draft(
        &db.conn,
        NewRelayPack {
            target_draft_id: "draft-send-core".to_owned(),
            source_conversation_id: source,
            source_folder_id: folder_id,
            scope_type: "summary".to_owned(),
            selected_round_ids_json: serde_json::to_string(&snapshot.scope.selected_round_ids)
                .unwrap(),
            snapshot_json: snapshot_json.clone(),
            source_fingerprint: fingerprint_rounds(&snapshot.included_rounds),
            estimated_tokens: i32::try_from(estimated_tokens).unwrap(),
            context_window_tokens: None,
            target_model: None,
            allowed_tokens: 4_000,
        },
    )
    .await
    .unwrap();
    let txn = db.conn.begin().await.unwrap();
    bind_to_conversation(&txn, pack.id, "draft-send-core", target)
        .await
        .unwrap();
    txn.commit().await.unwrap();

    let manager = ConnectionManager::new();
    let mut commands = manager
        .insert_test_connection_live(
            "relay-send-core",
            AgentType::Codex,
            Some("C:/workspace/relay-send-core".into()),
            EventEmitter::Noop,
        )
        .await;
    let user_blocks = vec![PromptInputBlock::Text {
        text: "continue the task".to_owned(),
    }];
    let mut send = Box::pin(send_prompt_with_relay_core(
        &manager,
        &db,
        &EventEmitter::Noop,
        AcpPromptRequest {
            connection_id: "relay-send-core".to_owned(),
            blocks: user_blocks.clone(),
            folder_id: Some(folder_id),
            conversation_id: Some(target),
            client_message_id: Some("message-send-core".to_owned()),
            relay_id: Some(pack.id),
            target_draft_id: Some("draft-send-core".to_owned()),
        },
    ));
    let command = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::select! {
            result = &mut send => panic!("send finished before actor outcome: {result:?}"),
            command = commands.recv() => command.expect("prompt command"),
        }
    })
    .await
    .expect("prompt must reach the connection actor");
    let ConnectionCommand::Prompt {
        blocks,
        persisted_blocks,
        user_message,
        deferred_user_prompt_preview,
        relay_preflight,
        relay_outcome,
    } = command
    else {
        panic!("expected prompt command")
    };

    let marker = marker_for_snapshot(pack.id, &snapshot.canonical_context);
    assert_eq!(
        serde_json::to_value(strip_hidden_relay_context(&blocks, Some(&marker))).unwrap(),
        serde_json::to_value(&user_blocks).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&persisted_blocks).unwrap(),
        serde_json::to_value(&user_blocks).unwrap()
    );
    assert!(user_message.is_some());
    assert_eq!(
        deferred_user_prompt_preview.as_deref(),
        Some("continue the task")
    );
    let preflight = relay_preflight.expect("relay preflight");
    assert_eq!(preflight.expected_model, None);
    assert_eq!(preflight.expected_context_window_tokens, None);
    assert_eq!(preflight.estimated_tokens, estimated_tokens);
    relay_outcome
        .expect("relay outcome sender")
        .send(RelayPromptOutcome::Accepted)
        .unwrap();

    tokio::time::timeout(Duration::from_secs(2), &mut send)
        .await
        .expect("core must finalize the actor outcome")
        .unwrap();
    let consumed = relay_context_pack::Entity::find_by_id(pack.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(consumed.status, "consumed");
    assert_eq!(
        consumed.consumed_snapshot_json.as_deref(),
        Some(snapshot_json.as_str())
    );
    assert_eq!(
        consumed.consume_client_message_id.as_deref(),
        Some("message-send-core")
    );
}

#[tokio::test]
async fn relay_send_core_releases_claim_and_cancels_target_when_actor_rejects_model_change() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace/relay-send-model-rejected").await;
    let (source, snapshot, _fixture) = seed_relay_send_core_source(
        &db,
        folder_id,
        "relay-core-test-model-rejected",
        "relay-core-test-model-rejected-session",
        "C:/workspace/relay-send-model-rejected",
    )
    .await;
    let target = seed_conversation(&db, folder_id, AgentType::Codex).await;
    let snapshot_json = serde_json::to_string(&snapshot).unwrap();
    let pack = create_or_replace_draft(
        &db.conn,
        NewRelayPack {
            target_draft_id: "draft-send-model-rejected".to_owned(),
            source_conversation_id: source,
            source_folder_id: folder_id,
            scope_type: "summary".to_owned(),
            selected_round_ids_json: serde_json::to_string(&snapshot.scope.selected_round_ids)
                .unwrap(),
            snapshot_json,
            source_fingerprint: fingerprint_rounds(&snapshot.included_rounds),
            estimated_tokens: i32::try_from(codeg_lib::conversation_relay::estimate_relay_tokens(
                &snapshot.canonical_context,
            ))
            .unwrap(),
            context_window_tokens: None,
            target_model: None,
            allowed_tokens: 4_000,
        },
    )
    .await
    .unwrap();
    let txn = db.conn.begin().await.unwrap();
    bind_to_conversation(&txn, pack.id, "draft-send-model-rejected", target)
        .await
        .unwrap();
    txn.commit().await.unwrap();

    let manager = ConnectionManager::new();
    let mut commands = manager
        .insert_test_connection_live(
            "relay-send-model-rejected",
            AgentType::Codex,
            Some("C:/workspace/relay-send-model-rejected".into()),
            EventEmitter::Noop,
        )
        .await;
    let mut send = Box::pin(send_prompt_with_relay_core(
        &manager,
        &db,
        &EventEmitter::Noop,
        AcpPromptRequest {
            connection_id: "relay-send-model-rejected".to_owned(),
            blocks: vec![PromptInputBlock::Text {
                text: "continue the task".to_owned(),
            }],
            folder_id: Some(folder_id),
            conversation_id: Some(target),
            client_message_id: Some("message-send-model-rejected".to_owned()),
            relay_id: Some(pack.id),
            target_draft_id: Some("draft-send-model-rejected".to_owned()),
        },
    ));
    let command = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::select! {
            result = &mut send => panic!("send finished before actor outcome: {result:?}"),
            command = commands.recv() => command.expect("prompt command"),
        }
    })
    .await
    .expect("prompt must reach the connection actor");
    let ConnectionCommand::Prompt { relay_outcome, .. } = command else {
        panic!("expected prompt command")
    };
    relay_outcome
        .expect("relay outcome sender")
        .send(RelayPromptOutcome::Rejected(
            RelayPromptRejection::ModelChanged,
        ))
        .unwrap();

    let error = tokio::time::timeout(Duration::from_secs(2), &mut send)
        .await
        .expect("core must finalize the actor rejection")
        .unwrap_err();
    assert_eq!(error.message, "relay_model_changed");

    let released = relay_context_pack::Entity::find_by_id(pack.id)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(released.status, "attached");
    assert!(released.consume_client_message_id.is_none());
    assert!(released.consume_attempt_state.is_none());

    let target = conversation::Entity::find_by_id(target)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(target.status, conversation::ConversationStatus::Cancelled);
}

#[tokio::test]
async fn a_claimed_relay_cannot_be_removed_while_the_prompt_outcome_is_pending() {
    let db = seeded_relay_db().await;
    claim_consume(&db.conn, 1, "message-pending").await.unwrap();

    let error = remove_relay_context_core(&db.conn, &EventEmitter::Noop, 1)
        .await
        .unwrap_err();

    assert_eq!(
        error.message,
        RelayErrorCode::RelayConsumeConflict.to_string()
    );
    let retained = relay_context_pack::Entity::find_by_id(1)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retained.status, "attached");
    assert_eq!(retained.consume_attempt_state.as_deref(), Some("claimed"));
}

#[tokio::test]
async fn an_uncertain_relay_can_be_removed_without_erasing_the_attempt_record() {
    let db = seeded_relay_db().await;
    claim_consume(&db.conn, 1, "message-uncertain")
        .await
        .unwrap();
    let uncertain = mark_uncertain(&db.conn, 1, "message-uncertain")
        .await
        .unwrap();
    assert_eq!(uncertain.status, "attached");
    assert_eq!(
        uncertain.consume_attempt_state.as_deref(),
        Some("uncertain")
    );

    let removed = remove_unclaimed(&db.conn, 1).await.unwrap();

    assert_eq!(removed.status, "removed");
    let persisted = relay_context_pack::Entity::find_by_id(1)
        .one(&db.conn)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        persisted.consume_client_message_id.as_deref(),
        Some("message-uncertain")
    );
    assert_eq!(
        persisted.consume_attempt_state.as_deref(),
        Some("uncertain")
    );
}
