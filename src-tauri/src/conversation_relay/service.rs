use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::acp::manager::ConnectionManager;
use crate::app_error::AppCommandError;
use crate::commands::conversations::get_folder_conversation_core;
use crate::db::entities::{conversation, relay_context_pack};
use crate::db::service::{conversation_capability_service, relay_context_pack_service};
use crate::db::AppDatabase;
use crate::models::agent::AgentType;
use crate::models::conversation_relay::{
    RelayContextPackView, RelayErrorCode, RelayProvenanceView, RelayScopeSelection, RelayScopeType,
    RelaySnapshot, RelaySnapshotSource, RelaySummary,
};
use crate::web::event_bridge::{
    emit_event, ConversationRelayChange, EventEmitter, CONVERSATION_RELAY_CHANGED_EVENT,
};

use super::summarizer::{CodexRelaySummarizer, RelayStructuredSummary, RelaySummarizer};
use super::{
    build_relay_snapshot, estimate_relay_tokens, fingerprint_rounds, normalize_relay_rounds,
    relay_budget, select_relay_rounds,
};

const RELAY_STORAGE_UNAVAILABLE: &str = "relay_storage_unavailable";
const MAX_PREVIEW_REQUEST_ID_BYTES: usize = 128;
const MAX_PREVIEW_TARGET_DRAFT_ID_BYTES: usize = 512;
const MAX_PENDING_PREVIEW_REQUESTS: usize = 1_024;
const MAX_ACTIVE_PREVIEWS: usize = 32;
const PREVIEW_RESERVATION_TTL: Duration = Duration::from_secs(30);

#[derive(Clone)]
struct RelayPreviewEntry {
    cancellation: CancellationToken,
    target_draft_id: String,
    generation: u64,
    active: bool,
    committed: bool,
}

#[derive(Default)]
struct RelayPreviewRegistry {
    requests: HashMap<String, RelayPreviewEntry>,
    latest_by_draft: HashMap<String, String>,
    next_generation: u64,
}

struct RelayPreviewGuard {
    registration: Option<(String, String)>,
    cancellation: CancellationToken,
}

impl RelayPreviewGuard {
    fn new(request_id: String, target_draft_id: String, cancellation: CancellationToken) -> Self {
        Self {
            registration: Some((request_id, target_draft_id)),
            cancellation,
        }
    }

    async fn finish(mut self) {
        if let Some((request_id, target_draft_id)) = self.registration.as_ref() {
            finish_relay_preview(request_id, target_draft_id).await;
        }
        self.registration = None;
    }
}

impl Drop for RelayPreviewGuard {
    fn drop(&mut self) {
        let Some((request_id, target_draft_id)) = self.registration.take() else {
            return;
        };
        self.cancellation.cancel();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                finish_relay_preview(&request_id, &target_draft_id).await;
            });
        }
    }
}

fn relay_preview_registry() -> &'static Mutex<RelayPreviewRegistry> {
    static REGISTRY: OnceLock<Mutex<RelayPreviewRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(RelayPreviewRegistry::default()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPreviewRequest {
    pub request_id: String,
    pub target_draft_id: String,
    pub source_conversation_id: i32,
    pub target_folder_id: Option<i32>,
    pub target_agent_type: AgentType,
    pub target_model: Option<String>,
    pub scope: RelayScopeSelection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPatchRequest {
    pub scope: RelayScopeSelection,
    pub target_agent_type: AgentType,
    pub target_model: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConversationCapabilitiesInput {
    pub relay_enabled: bool,
}

fn relay_error(code: RelayErrorCode) -> AppCommandError {
    let id = code.to_string();
    match code {
        RelayErrorCode::RelaySourceNotFound => AppCommandError::not_found(id),
        RelayErrorCode::RelaySourceUnavailable
        | RelayErrorCode::RelaySummaryUnavailable
        | RelayErrorCode::RelaySendUncertain => AppCommandError::task_execution_failed(id),
        RelayErrorCode::RelayConsumeConflict => AppCommandError::already_exists(id),
        _ => AppCommandError::invalid_input(id),
    }
}

fn storage_error() -> AppCommandError {
    AppCommandError::database_error(RELAY_STORAGE_UNAVAILABLE)
}

fn preview_cancelled_error() -> AppCommandError {
    relay_error(RelayErrorCode::RelaySourceUnavailable)
}

fn valid_preview_request_id(request_id: &str) -> bool {
    !request_id.is_empty() && request_id.len() <= MAX_PREVIEW_REQUEST_ID_BYTES
}

fn valid_preview_target_draft_id(target_draft_id: &str) -> bool {
    !target_draft_id.is_empty() && target_draft_id.len() <= MAX_PREVIEW_TARGET_DRAFT_ID_BYTES
}

pub async fn reserve_relay_preview_core(request_id: &str, target_draft_id: &str) -> bool {
    let request_id = request_id.trim();
    let target_draft_id = target_draft_id.trim();
    if !valid_preview_request_id(request_id) || !valid_preview_target_draft_id(target_draft_id) {
        return false;
    }

    let generation = {
        let mut registry = relay_preview_registry().lock().await;
        if registry.requests.contains_key(request_id)
            || registry.requests.len() >= MAX_PENDING_PREVIEW_REQUESTS
        {
            return false;
        }
        let Some(generation) = registry.next_generation.checked_add(1) else {
            return false;
        };
        registry.next_generation = generation;

        registry.requests.insert(
            request_id.to_owned(),
            RelayPreviewEntry {
                cancellation: CancellationToken::new(),
                target_draft_id: target_draft_id.to_owned(),
                generation,
                active: false,
                committed: false,
            },
        );
        let previous_request_id = registry
            .latest_by_draft
            .insert(target_draft_id.to_owned(), request_id.to_owned());
        if let Some(previous_request_id) = previous_request_id {
            let remove_previous =
                registry
                    .requests
                    .get(&previous_request_id)
                    .is_some_and(|previous| {
                        previous.cancellation.cancel();
                        !previous.active
                    });
            if remove_previous {
                registry.requests.remove(&previous_request_id);
            }
        }
        generation
    };

    let request_id = request_id.to_owned();
    let target_draft_id = target_draft_id.to_owned();
    let expires_at = tokio::time::Instant::now() + PREVIEW_RESERVATION_TTL;
    tokio::spawn(async move {
        tokio::time::sleep_until(expires_at).await;
        let mut registry = relay_preview_registry().lock().await;
        let expired = registry.requests.get(&request_id).is_some_and(|entry| {
            entry.generation == generation
                && entry.target_draft_id == target_draft_id
                && !entry.active
        });
        if expired {
            registry.requests.remove(&request_id);
            if registry
                .latest_by_draft
                .get(&target_draft_id)
                .is_some_and(|latest_request_id| latest_request_id == &request_id)
            {
                registry.latest_by_draft.remove(&target_draft_id);
            }
        }
    });
    true
}

async fn claim_relay_preview(
    request_id: &str,
    target_draft_id: &str,
) -> Result<CancellationToken, AppCommandError> {
    let mut registry = relay_preview_registry().lock().await;
    if registry
        .requests
        .values()
        .filter(|entry| entry.active)
        .count()
        >= MAX_ACTIVE_PREVIEWS
    {
        return Err(preview_cancelled_error());
    }
    let is_latest = registry
        .latest_by_draft
        .get(target_draft_id)
        .is_some_and(|latest_request_id| latest_request_id == request_id);
    if !is_latest {
        return Err(preview_cancelled_error());
    }

    let Some(entry) = registry.requests.get_mut(request_id) else {
        return Err(preview_cancelled_error());
    };
    if entry.active || entry.target_draft_id != target_draft_id || entry.cancellation.is_cancelled()
    {
        return Err(preview_cancelled_error());
    }
    entry.active = true;
    Ok(entry.cancellation.clone())
}

async fn finish_relay_preview(request_id: &str, target_draft_id: &str) {
    let mut registry = relay_preview_registry().lock().await;
    registry.requests.remove(request_id);
    if registry
        .latest_by_draft
        .get(target_draft_id)
        .is_some_and(|active_request_id| active_request_id == request_id)
    {
        registry.latest_by_draft.remove(target_draft_id);
    }
}

pub async fn cancel_relay_preview_core(request_id: &str) -> bool {
    let request_id = request_id.trim();
    if !valid_preview_request_id(request_id) {
        return false;
    }
    let mut registry = relay_preview_registry().lock().await;
    let (target_draft_id, active) = {
        let Some(entry) = registry.requests.get_mut(request_id) else {
            return false;
        };
        if entry.committed {
            return false;
        }
        entry.cancellation.cancel();
        (entry.target_draft_id.clone(), entry.active)
    };
    if !active {
        registry.requests.remove(request_id);
        if registry
            .latest_by_draft
            .get(&target_draft_id)
            .is_some_and(|latest_request_id| latest_request_id == request_id)
        {
            registry.latest_by_draft.remove(&target_draft_id);
        }
    }
    true
}

fn validate_target_model(target_model: Option<String>) -> Result<Option<String>, AppCommandError> {
    match target_model {
        Some(model) if model.trim().is_empty() => {
            Err(relay_error(RelayErrorCode::RelayModelChanged))
        }
        Some(model) => Ok(Some(model.trim().to_owned())),
        None => Ok(None),
    }
}

fn context_window_tokens(target_model: Option<&str>) -> Option<u32> {
    let inferred = crate::parsers::infer_context_window_max_tokens(target_model)?;
    let value = u32::try_from(inferred).ok()?;
    i32::try_from(value).ok().map(|_| value)
}

fn scope_type_name(scope_type: RelayScopeType) -> &'static str {
    match scope_type {
        RelayScopeType::Summary => "summary",
        RelayScopeType::RecentRounds => "recent_rounds",
        RelayScopeType::CustomRounds => "custom_rounds",
    }
}

fn parse_scope_type(value: &str) -> Result<RelayScopeType, AppCommandError> {
    match value {
        "summary" => Ok(RelayScopeType::Summary),
        "recent_rounds" => Ok(RelayScopeType::RecentRounds),
        "custom_rounds" => Ok(RelayScopeType::CustomRounds),
        _ => Err(relay_error(RelayErrorCode::RelaySourceUnavailable)),
    }
}

fn summary_from_structured(summary: RelayStructuredSummary) -> RelaySummary {
    RelaySummary {
        goals: summary.goal.into_iter().map(|item| item.text).collect(),
        decisions: summary
            .decisions
            .into_iter()
            .map(|item| item.text)
            .collect(),
        progress: summary.progress.into_iter().map(|item| item.text).collect(),
        todos: summary.todos.into_iter().map(|item| item.text).collect(),
        constraints: summary
            .constraints
            .into_iter()
            .map(|item| item.text)
            .collect(),
        files: summary.files.into_iter().map(|item| item.text).collect(),
        open_questions: summary
            .open_questions
            .into_iter()
            .map(|item| item.text)
            .collect(),
    }
}

fn view_from_model(
    model: relay_context_pack::Model,
) -> Result<RelayContextPackView, AppCommandError> {
    let selected_round_ids = serde_json::from_str::<Vec<String>>(&model.selected_round_ids_json)
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    let scope = RelayScopeSelection {
        scope_type: parse_scope_type(&model.scope_type)?,
        selected_round_ids,
    };
    let snapshot = serde_json::from_str::<RelaySnapshot>(&model.snapshot_json)
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    let estimated_tokens = u32::try_from(model.estimated_tokens)
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    let context_window_tokens = model
        .context_window_tokens
        .map(u32::try_from)
        .transpose()
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    let allowed_tokens = u32::try_from(model.allowed_tokens)
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;

    Ok(RelayContextPackView {
        id: model.id,
        target_draft_id: model.target_draft_id,
        target_conversation_id: model.target_conversation_id,
        source_conversation_id: model.source_conversation_id,
        source_folder_id: model.source_folder_id,
        scope,
        snapshot,
        source_fingerprint: model.source_fingerprint,
        estimated_tokens,
        context_window_tokens,
        allowed_tokens,
        status: model.status,
        invalid_reason: model.invalid_reason,
        created_at: model.created_at,
        updated_at: model.updated_at,
        consumed_at: model.consumed_at,
    })
}

async fn ensure_relay_enabled(conn: &DatabaseConnection) -> Result<(), AppCommandError> {
    let settings = conversation_capability_service::get_capabilities(conn)
        .await
        .map_err(|_| storage_error())?;
    if settings.relay_enabled {
        Ok(())
    } else {
        Err(relay_error(RelayErrorCode::RelayDisabled))
    }
}

async fn find_source(
    conn: &DatabaseConnection,
    source_conversation_id: i32,
) -> Result<conversation::Model, AppCommandError> {
    conversation::Entity::find_by_id(source_conversation_id)
        .filter(conversation::Column::DeletedAt.is_null())
        .one(conn)
        .await
        .map_err(|_| storage_error())?
        .ok_or_else(|| relay_error(RelayErrorCode::RelaySourceNotFound))
}

async fn build_snapshot_with_summarizer(
    source_conversation_id: i32,
    source_folder_id: i32,
    mut scope: RelayScopeSelection,
    available_rounds: Vec<crate::models::conversation_relay::RelayRound>,
    summarizer: Option<&dyn RelaySummarizer>,
) -> Result<RelaySnapshot, AppCommandError> {
    if scope.selected_round_ids.is_empty() {
        let first_included = match scope.scope_type {
            RelayScopeType::Summary => 0,
            RelayScopeType::RecentRounds => available_rounds.len().saturating_sub(10),
            RelayScopeType::CustomRounds => available_rounds.len(),
        };
        scope.selected_round_ids = available_rounds[first_included..]
            .iter()
            .map(|round| round.id.clone())
            .collect();
    }
    let selected =
        select_relay_rounds(&available_rounds, &scope).map_err(|error| relay_error(error.code))?;
    let summary = if scope.scope_type == RelayScopeType::Summary {
        let summarizer =
            summarizer.ok_or_else(|| relay_error(RelayErrorCode::RelaySummaryUnavailable))?;
        Some(summary_from_structured(
            summarizer
                .summarize(&selected)
                .await
                .map_err(|error| relay_error(error.code))?,
        ))
    } else {
        None
    };

    build_relay_snapshot(
        RelaySnapshotSource {
            conversation_id: source_conversation_id,
            folder_id: source_folder_id,
        },
        scope,
        available_rounds,
        summary,
    )
    .map_err(|error| relay_error(error.code))
}

async fn build_snapshot(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    source: RelaySnapshotSource,
    scope: RelayScopeSelection,
    available_rounds: Vec<crate::models::conversation_relay::RelayRound>,
    cancellation: CancellationToken,
) -> Result<RelaySnapshot, AppCommandError> {
    if scope.scope_type == RelayScopeType::Summary {
        let summarizer = CodexRelaySummarizer::new(manager, db, data_dir, cancellation);
        build_snapshot_with_summarizer(
            source.conversation_id,
            source.folder_id,
            scope,
            available_rounds,
            Some(&summarizer),
        )
        .await
    } else {
        build_snapshot_with_summarizer(
            source.conversation_id,
            source.folder_id,
            scope,
            available_rounds,
            None,
        )
        .await
    }
}

fn new_relay_pack(
    target_draft_id: String,
    target_model: Option<String>,
    snapshot: RelaySnapshot,
) -> Result<relay_context_pack_service::NewRelayPack, AppCommandError> {
    let source_fingerprint = fingerprint_rounds(&snapshot.available_rounds);
    let estimated_tokens = estimate_relay_tokens(&snapshot.canonical_context);
    let context_window_tokens = context_window_tokens(target_model.as_deref());
    let allowed_tokens = relay_budget(context_window_tokens);
    if estimated_tokens > allowed_tokens {
        return Err(relay_error(RelayErrorCode::RelayBudgetExceeded));
    }

    let selected_round_ids_json = serde_json::to_string(&snapshot.scope.selected_round_ids)
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    Ok(relay_context_pack_service::NewRelayPack {
        target_draft_id,
        source_conversation_id: snapshot.source.conversation_id,
        source_folder_id: snapshot.source.folder_id,
        scope_type: scope_type_name(snapshot.scope.scope_type).to_owned(),
        selected_round_ids_json,
        snapshot_json,
        source_fingerprint,
        estimated_tokens: i32::try_from(estimated_tokens)
            .map_err(|_| relay_error(RelayErrorCode::RelayBudgetExceeded))?,
        context_window_tokens: context_window_tokens.and_then(|value| i32::try_from(value).ok()),
        target_model,
        allowed_tokens: i32::try_from(allowed_tokens)
            .map_err(|_| relay_error(RelayErrorCode::RelayBudgetExceeded))?,
    })
}

async fn persist_snapshot(
    db: &AppDatabase,
    target_draft_id: String,
    target_model: Option<String>,
    snapshot: RelaySnapshot,
) -> Result<RelayContextPackView, AppCommandError> {
    let pack = new_relay_pack(target_draft_id, target_model, snapshot)?;
    let model = relay_context_pack_service::create_or_replace_draft(&db.conn, pack)
        .await
        .map_err(|_| storage_error())?;
    view_from_model(model)
}

async fn persist_preview_snapshot(
    db: &AppDatabase,
    request_id: &str,
    target_draft_id: String,
    target_model: Option<String>,
    snapshot: RelaySnapshot,
    cancellation: &CancellationToken,
) -> Result<RelayContextPackView, AppCommandError> {
    let pack = new_relay_pack(target_draft_id.clone(), target_model, snapshot)?;
    if cancellation.is_cancelled() {
        return Err(preview_cancelled_error());
    }

    let txn = db.conn.begin().await.map_err(|_| storage_error())?;
    let now = chrono::Utc::now();
    relay_context_pack::Entity::update_many()
        .col_expr(relay_context_pack::Column::Status, Expr::value("removed"))
        .col_expr(relay_context_pack::Column::UpdatedAt, Expr::value(now))
        .filter(relay_context_pack::Column::TargetDraftId.eq(&pack.target_draft_id))
        .filter(relay_context_pack::Column::Status.is_in(["draft", "attached"]))
        .filter(relay_context_pack_service::consume_not_claimed())
        .exec(&txn)
        .await
        .map_err(|_| storage_error())?;
    let model = relay_context_pack::ActiveModel {
        id: NotSet,
        target_draft_id: Set(pack.target_draft_id),
        target_conversation_id: Set(None),
        source_conversation_id: Set(pack.source_conversation_id),
        source_folder_id: Set(pack.source_folder_id),
        scope_type: Set(pack.scope_type),
        selected_round_ids_json: Set(pack.selected_round_ids_json),
        snapshot_json: Set(pack.snapshot_json),
        source_fingerprint: Set(pack.source_fingerprint),
        estimated_tokens: Set(pack.estimated_tokens),
        context_window_tokens: Set(pack.context_window_tokens),
        target_model: Set(pack.target_model),
        allowed_tokens: Set(pack.allowed_tokens),
        status: Set("draft".to_owned()),
        invalid_reason: Set(None),
        consume_client_message_id: Set(None),
        consume_attempt_state: Set(None),
        consumed_snapshot_json: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        consumed_at: Set(None),
    }
    .insert(&txn)
    .await
    .map_err(|_| storage_error())?;

    let mut registry = relay_preview_registry().lock().await;
    let may_commit = registry.requests.get(request_id).is_some_and(|entry| {
        entry.active
            && !entry.committed
            && entry.target_draft_id == target_draft_id
            && !entry.cancellation.is_cancelled()
    }) && registry
        .latest_by_draft
        .get(&target_draft_id)
        .is_some_and(|active_request_id| active_request_id == request_id);
    if !may_commit {
        drop(registry);
        txn.rollback().await.map_err(|_| storage_error())?;
        return Err(preview_cancelled_error());
    }
    let request_id = request_id.to_owned();
    let commit_result = tokio::spawn(async move {
        let result = txn.commit().await;
        if result.is_ok() {
            if let Some(entry) = registry.requests.get_mut(&request_id) {
                entry.committed = true;
            }
        }
        drop(registry);
        result
    })
    .await
    .map_err(|_| storage_error())?;
    commit_result.map_err(|_| storage_error())?;
    view_from_model(model)
}

pub async fn preview_relay_context_core(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    request: RelayPreviewRequest,
) -> Result<RelayContextPackView, AppCommandError> {
    let request_id = request.request_id.trim().to_owned();
    let target_draft_id = request.target_draft_id.trim().to_owned();
    if !valid_preview_request_id(&request_id) || !valid_preview_target_draft_id(&target_draft_id) {
        return Err(relay_error(RelayErrorCode::RelaySourceUnavailable));
    }
    let cancellation = claim_relay_preview(&request_id, &target_draft_id).await?;
    let guard = RelayPreviewGuard::new(
        request_id.clone(),
        target_draft_id.clone(),
        cancellation.clone(),
    );
    let result = async {
        if cancellation.is_cancelled() {
            return Err(preview_cancelled_error());
        }
        ensure_relay_enabled(&db.conn).await?;
        let target_model = validate_target_model(request.target_model)?;
        let source = find_source(&db.conn, request.source_conversation_id).await?;
        let (detail, _) = get_folder_conversation_core(&db.conn, request.source_conversation_id)
            .await
            .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
        let available_rounds = normalize_relay_rounds(&detail.turns);
        let snapshot = build_snapshot(
            manager,
            db,
            data_dir,
            RelaySnapshotSource {
                conversation_id: source.id,
                folder_id: source.folder_id,
            },
            request.scope,
            available_rounds,
            cancellation.clone(),
        )
        .await?;
        persist_preview_snapshot(
            db,
            &request_id,
            target_draft_id.clone(),
            target_model,
            snapshot,
            &cancellation,
        )
        .await
    }
    .await;
    guard.finish().await;
    result
}

#[cfg(feature = "test-utils")]
pub async fn preview_relay_context_from_rounds_with_summarizer_core(
    db: &AppDatabase,
    request: RelayPreviewRequest,
    available_rounds: Vec<crate::models::conversation_relay::RelayRound>,
    summarizer: &dyn RelaySummarizer,
) -> Result<RelayContextPackView, AppCommandError> {
    let request_id = request.request_id.trim().to_owned();
    let target_draft_id = request.target_draft_id.trim().to_owned();
    if !valid_preview_request_id(&request_id) || !valid_preview_target_draft_id(&target_draft_id) {
        return Err(relay_error(RelayErrorCode::RelaySourceUnavailable));
    }
    let cancellation = claim_relay_preview(&request_id, &target_draft_id).await?;
    let guard = RelayPreviewGuard::new(
        request_id.clone(),
        target_draft_id.clone(),
        cancellation.clone(),
    );
    let result = async {
        if cancellation.is_cancelled() {
            return Err(preview_cancelled_error());
        }
        ensure_relay_enabled(&db.conn).await?;
        let target_model = validate_target_model(request.target_model)?;
        let source = find_source(&db.conn, request.source_conversation_id).await?;
        let snapshot = build_snapshot_with_summarizer(
            source.id,
            source.folder_id,
            request.scope,
            available_rounds,
            Some(summarizer),
        )
        .await?;
        persist_preview_snapshot(
            db,
            &request_id,
            target_draft_id.clone(),
            target_model,
            snapshot,
            &cancellation,
        )
        .await
    }
    .await;
    guard.finish().await;
    result
}

pub async fn get_relay_context_by_draft_core(
    conn: &DatabaseConnection,
    target_draft_id: &str,
) -> Result<Option<RelayContextPackView>, AppCommandError> {
    let model = relay_context_pack_service::get_active_by_draft(conn, target_draft_id)
        .await
        .map_err(|_| storage_error())?;
    model.map(view_from_model).transpose()
}

pub async fn update_relay_context_core(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    relay_id: i32,
    request: RelayPatchRequest,
) -> Result<RelayContextPackView, AppCommandError> {
    let (existing, target_model, prior_snapshot) =
        prepare_relay_update(db, relay_id, request.target_model).await?;
    let snapshot = build_snapshot(
        manager,
        db,
        data_dir,
        RelaySnapshotSource {
            conversation_id: existing.source_conversation_id,
            folder_id: existing.source_folder_id,
        },
        request.scope,
        prior_snapshot.available_rounds,
        CancellationToken::new(),
    )
    .await?;
    persist_snapshot(db, existing.target_draft_id, target_model, snapshot).await
}

async fn prepare_relay_update(
    db: &AppDatabase,
    relay_id: i32,
    target_model: Option<String>,
) -> Result<(relay_context_pack::Model, Option<String>, RelaySnapshot), AppCommandError> {
    ensure_relay_enabled(&db.conn).await?;
    let target_model = validate_target_model(target_model)?;
    let existing = relay_context_pack::Entity::find_by_id(relay_id)
        .one(&db.conn)
        .await
        .map_err(|_| storage_error())?
        .ok_or_else(|| relay_error(RelayErrorCode::RelaySourceNotFound))?;
    if existing.status != "draft" {
        return Err(relay_error(RelayErrorCode::RelayImmutableSnapshot));
    }
    find_source(&db.conn, existing.source_conversation_id).await?;
    let prior_snapshot = serde_json::from_str::<RelaySnapshot>(&existing.snapshot_json)
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    if fingerprint_rounds(&prior_snapshot.available_rounds) != existing.source_fingerprint {
        return Err(relay_error(RelayErrorCode::RelayRoundsChanged));
    }
    Ok((existing, target_model, prior_snapshot))
}

#[cfg(feature = "test-utils")]
pub async fn update_relay_context_with_summarizer_core(
    db: &AppDatabase,
    relay_id: i32,
    request: RelayPatchRequest,
    summarizer: &dyn RelaySummarizer,
) -> Result<RelayContextPackView, AppCommandError> {
    let (existing, target_model, prior_snapshot) =
        prepare_relay_update(db, relay_id, request.target_model).await?;
    let snapshot = build_snapshot_with_summarizer(
        existing.source_conversation_id,
        existing.source_folder_id,
        request.scope,
        prior_snapshot.available_rounds,
        Some(summarizer),
    )
    .await?;
    persist_snapshot(db, existing.target_draft_id, target_model, snapshot).await
}

pub async fn remove_relay_context_core(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    relay_id: i32,
) -> Result<RelayContextPackView, AppCommandError> {
    let removed = relay_context_pack_service::remove_unclaimed(conn, relay_id)
        .await
        .map_err(|error| relay_error(error.code))?;
    emit_event(
        emitter,
        CONVERSATION_RELAY_CHANGED_EVENT,
        ConversationRelayChange {
            relay_id: removed.id,
            target_draft_id: removed.target_draft_id.clone(),
            status: removed.status.clone(),
            error_code: None,
        },
    );
    view_from_model(removed)
}

pub async fn get_conversation_capabilities_core(
    conn: &DatabaseConnection,
) -> Result<conversation_capability_service::ConversationCapabilitySettings, AppCommandError> {
    conversation_capability_service::get_capabilities(conn)
        .await
        .map_err(|_| storage_error())
}

pub async fn update_conversation_capabilities_core(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    input: UpdateConversationCapabilitiesInput,
) -> Result<conversation_capability_service::ConversationCapabilitySettings, AppCommandError> {
    conversation_capability_service::set_relay_enabled(conn, emitter, input.relay_enabled)
        .await
        .map_err(|_| storage_error())
}

pub async fn get_conversation_relay_core(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Option<RelayProvenanceView>, AppCommandError> {
    let model = relay_context_pack::Entity::find()
        .filter(relay_context_pack::Column::TargetConversationId.eq(conversation_id))
        .filter(relay_context_pack::Column::Status.eq("consumed"))
        .one(conn)
        .await
        .map_err(|_| storage_error())?;
    model
        .map(|model| {
            let selected_round_ids =
                serde_json::from_str::<Vec<String>>(&model.selected_round_ids_json)
                    .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
            Ok(RelayProvenanceView {
                relay_id: model.id,
                source_conversation_id: model.source_conversation_id,
                source_folder_id: model.source_folder_id,
                scope: RelayScopeSelection {
                    scope_type: parse_scope_type(&model.scope_type)?,
                    selected_round_ids: selected_round_ids.clone(),
                },
                selected_round_ids,
                consumed_at: model.consumed_at,
            })
        })
        .transpose()
}
