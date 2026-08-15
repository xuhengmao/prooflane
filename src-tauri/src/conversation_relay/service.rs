use std::path::Path;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    Set,
};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayPreviewRequest {
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

async fn build_snapshot(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    source_conversation_id: i32,
    source_folder_id: i32,
    scope: RelayScopeSelection,
    available_rounds: Vec<crate::models::conversation_relay::RelayRound>,
) -> Result<RelaySnapshot, AppCommandError> {
    let selected =
        select_relay_rounds(&available_rounds, &scope).map_err(|error| relay_error(error.code))?;
    let summary = if scope.scope_type == RelayScopeType::Summary {
        let summarizer = CodexRelaySummarizer::new(manager, db, data_dir, CancellationToken::new());
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

async fn persist_snapshot(
    db: &AppDatabase,
    target_draft_id: String,
    target_model: Option<String>,
    snapshot: RelaySnapshot,
) -> Result<RelayContextPackView, AppCommandError> {
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
    let model = relay_context_pack_service::create_or_replace_draft(
        &db.conn,
        relay_context_pack_service::NewRelayPack {
            target_draft_id,
            source_conversation_id: snapshot.source.conversation_id,
            source_folder_id: snapshot.source.folder_id,
            scope_type: scope_type_name(snapshot.scope.scope_type).to_owned(),
            selected_round_ids_json,
            snapshot_json,
            source_fingerprint,
            estimated_tokens: i32::try_from(estimated_tokens)
                .map_err(|_| relay_error(RelayErrorCode::RelayBudgetExceeded))?,
            context_window_tokens: context_window_tokens
                .and_then(|value| i32::try_from(value).ok()),
            allowed_tokens: i32::try_from(allowed_tokens)
                .map_err(|_| relay_error(RelayErrorCode::RelayBudgetExceeded))?,
        },
    )
    .await
    .map_err(|_| storage_error())?;
    view_from_model(model)
}

pub async fn preview_relay_context_core(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    request: RelayPreviewRequest,
) -> Result<RelayContextPackView, AppCommandError> {
    ensure_relay_enabled(&db.conn).await?;
    let target_model = validate_target_model(request.target_model)?;
    let target_draft_id = request.target_draft_id.trim();
    if target_draft_id.is_empty() {
        return Err(relay_error(RelayErrorCode::RelaySourceUnavailable));
    }
    let source = find_source(&db.conn, request.source_conversation_id).await?;
    let (detail, _) = get_folder_conversation_core(&db.conn, request.source_conversation_id)
        .await
        .map_err(|_| relay_error(RelayErrorCode::RelaySourceUnavailable))?;
    let available_rounds = normalize_relay_rounds(&detail.turns);
    let snapshot = build_snapshot(
        manager,
        db,
        data_dir,
        source.id,
        source.folder_id,
        request.scope,
        available_rounds,
    )
    .await?;
    persist_snapshot(db, target_draft_id.to_owned(), target_model, snapshot).await
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
    ensure_relay_enabled(&db.conn).await?;
    let target_model = validate_target_model(request.target_model)?;
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
    let snapshot = build_snapshot(
        manager,
        db,
        data_dir,
        existing.source_conversation_id,
        existing.source_folder_id,
        request.scope,
        prior_snapshot.available_rounds,
    )
    .await?;
    persist_snapshot(db, existing.target_draft_id, target_model, snapshot).await
}

pub async fn remove_relay_context_core(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    relay_id: i32,
) -> Result<RelayContextPackView, AppCommandError> {
    let model = relay_context_pack::Entity::find_by_id(relay_id)
        .one(conn)
        .await
        .map_err(|_| storage_error())?
        .ok_or_else(|| relay_error(RelayErrorCode::RelaySourceNotFound))?;
    if !matches!(model.status.as_str(), "draft" | "attached") {
        return Err(relay_error(RelayErrorCode::RelayImmutableSnapshot));
    }
    let mut active = model.into_active_model();
    active.status = Set("removed".to_owned());
    active.updated_at = Set(chrono::Utc::now());
    let removed = active.update(conn).await.map_err(|_| storage_error())?;
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
