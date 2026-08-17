#![cfg(feature = "tauri-runtime")]

use tauri::Manager;

use crate::acp::manager::ConnectionManager;
use crate::app_error::AppCommandError;
use crate::conversation_relay::service::{
    cancel_relay_preview_core, get_conversation_capabilities_core, get_conversation_relay_core,
    get_relay_context_by_target_core, preview_relay_context_core, remove_relay_context_core,
    reserve_relay_preview_core, update_conversation_capabilities_core, update_relay_context_core,
    RelayPatchRequest, RelayPreviewRequest, UpdateConversationCapabilitiesInput,
};
use crate::db::service::conversation_capability_service::ConversationCapabilitySettings;
use crate::db::AppDatabase;
use crate::models::{AgentType, RelayContextPackView, RelayProvenanceView, RelayScopeSelection};
use crate::paths::resolve_effective_data_dir;
use crate::web::event_bridge::EventEmitter;

fn relay_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppCommandError> {
    app.path()
        .app_data_dir()
        .map(|path| resolve_effective_data_dir(&path))
        .map_err(|_| AppCommandError::configuration_invalid("relay_data_dir_unavailable"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn preview_relay_context(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ConnectionManager>,
    db: tauri::State<'_, AppDatabase>,
    request_id: String,
    target_draft_id: String,
    source_conversation_id: i32,
    target_folder_id: Option<i32>,
    target_agent_type: AgentType,
    target_model: Option<String>,
    scope: RelayScopeSelection,
) -> Result<RelayContextPackView, AppCommandError> {
    let data_dir = relay_data_dir(&app)?;
    preview_relay_context_core(
        &manager,
        &db,
        &data_dir,
        RelayPreviewRequest {
            request_id,
            target_draft_id,
            source_conversation_id,
            target_folder_id,
            target_agent_type,
            target_model,
            scope,
        },
    )
    .await
}

#[tauri::command]
pub async fn reserve_relay_preview(request_id: String, target_draft_id: String) -> bool {
    reserve_relay_preview_core(&request_id, &target_draft_id).await
}

#[tauri::command]
pub async fn cancel_relay_preview(request_id: String) -> bool {
    cancel_relay_preview_core(&request_id).await
}

#[tauri::command]
pub async fn get_relay_context_by_draft(
    db: tauri::State<'_, AppDatabase>,
    target_draft_id: String,
    target_conversation_id: Option<i32>,
) -> Result<Option<RelayContextPackView>, AppCommandError> {
    get_relay_context_by_target_core(&db.conn, &target_draft_id, target_conversation_id).await
}

#[tauri::command]
pub async fn update_relay_context(
    app: tauri::AppHandle,
    manager: tauri::State<'_, ConnectionManager>,
    db: tauri::State<'_, AppDatabase>,
    relay_id: i32,
    input: RelayPatchRequest,
) -> Result<RelayContextPackView, AppCommandError> {
    let data_dir = relay_data_dir(&app)?;
    update_relay_context_core(&manager, &db, &data_dir, relay_id, input).await
}

#[tauri::command]
pub async fn remove_relay_context(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    relay_id: i32,
) -> Result<RelayContextPackView, AppCommandError> {
    remove_relay_context_core(&db.conn, &EventEmitter::Tauri(app), relay_id).await
}

#[tauri::command]
pub async fn get_conversation_capabilities(
    db: tauri::State<'_, AppDatabase>,
) -> Result<ConversationCapabilitySettings, AppCommandError> {
    get_conversation_capabilities_core(&db.conn).await
}

#[tauri::command]
pub async fn update_conversation_capabilities(
    app: tauri::AppHandle,
    db: tauri::State<'_, AppDatabase>,
    relay_enabled: bool,
) -> Result<ConversationCapabilitySettings, AppCommandError> {
    update_conversation_capabilities_core(
        &db.conn,
        &EventEmitter::Tauri(app),
        UpdateConversationCapabilitiesInput { relay_enabled },
    )
    .await
}

#[tauri::command]
pub async fn get_conversation_relay(
    db: tauri::State<'_, AppDatabase>,
    conversation_id: i32,
) -> Result<Option<RelayProvenanceView>, AppCommandError> {
    get_conversation_relay_core(&db.conn, conversation_id).await
}
