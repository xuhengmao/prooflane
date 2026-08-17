use std::sync::Arc;

use axum::extract::{Extension, Path, Query};
use axum::Json;
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::conversation_relay::service::{
    cancel_relay_preview_core, get_conversation_capabilities_core, get_conversation_relay_core,
    get_relay_context_by_target_core, preview_relay_context_core, remove_relay_context_core,
    reserve_relay_preview_core, update_conversation_capabilities_core, update_relay_context_core,
    RelayPatchRequest, RelayPreviewRequest, UpdateConversationCapabilitiesInput,
};
use crate::db::service::conversation_capability_service::ConversationCapabilitySettings;
use crate::models::{RelayContextPackView, RelayProvenanceView};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftIdParams {
    target_draft_id: String,
    target_conversation_id: Option<i32>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetConversationQuery {
    target_conversation_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayIdParams {
    relay_id: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationIdParams {
    conversation_id: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRelayPreviewParams {
    request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReserveRelayPreviewParams {
    request_id: String,
    target_draft_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelayContextParams {
    relay_id: i32,
    input: RelayPatchRequest,
}

pub async fn get_conversation_capabilities(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<ConversationCapabilitySettings>, AppCommandError> {
    Ok(Json(
        get_conversation_capabilities_core(&state.db.conn).await?,
    ))
}

pub async fn update_conversation_capabilities(
    Extension(state): Extension<Arc<AppState>>,
    Json(input): Json<UpdateConversationCapabilitiesInput>,
) -> Result<Json<ConversationCapabilitySettings>, AppCommandError> {
    Ok(Json(
        update_conversation_capabilities_core(&state.db.conn, &state.emitter, input).await?,
    ))
}

pub async fn preview_relay_context(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<RelayPreviewRequest>,
) -> Result<Json<RelayContextPackView>, AppCommandError> {
    Ok(Json(
        preview_relay_context_core(
            &state.connection_manager,
            &state.db,
            &state.data_dir,
            request,
        )
        .await?,
    ))
}

pub async fn cancel_relay_preview(Json(params): Json<CancelRelayPreviewParams>) -> Json<bool> {
    Json(cancel_relay_preview_core(&params.request_id).await)
}

pub async fn reserve_relay_preview(Json(params): Json<ReserveRelayPreviewParams>) -> Json<bool> {
    Json(reserve_relay_preview_core(&params.request_id, &params.target_draft_id).await)
}

pub async fn get_relay_context_by_draft(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DraftIdParams>,
) -> Result<Json<Option<RelayContextPackView>>, AppCommandError> {
    Ok(Json(
        get_relay_context_by_target_core(
            &state.db.conn,
            &params.target_draft_id,
            params.target_conversation_id,
        )
        .await?,
    ))
}

pub async fn get_relay_context_by_draft_rest(
    Extension(state): Extension<Arc<AppState>>,
    Path(target_draft_id): Path<String>,
    Query(query): Query<TargetConversationQuery>,
) -> Result<Json<Option<RelayContextPackView>>, AppCommandError> {
    Ok(Json(
        get_relay_context_by_target_core(
            &state.db.conn,
            &target_draft_id,
            query.target_conversation_id,
        )
        .await?,
    ))
}

pub async fn update_relay_context(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateRelayContextParams>,
) -> Result<Json<RelayContextPackView>, AppCommandError> {
    Ok(Json(
        update_relay_context_core(
            &state.connection_manager,
            &state.db,
            &state.data_dir,
            params.relay_id,
            params.input,
        )
        .await?,
    ))
}

pub async fn update_relay_context_rest(
    Extension(state): Extension<Arc<AppState>>,
    Path(relay_id): Path<i32>,
    Json(input): Json<RelayPatchRequest>,
) -> Result<Json<RelayContextPackView>, AppCommandError> {
    Ok(Json(
        update_relay_context_core(
            &state.connection_manager,
            &state.db,
            &state.data_dir,
            relay_id,
            input,
        )
        .await?,
    ))
}

pub async fn remove_relay_context(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<RelayIdParams>,
) -> Result<Json<RelayContextPackView>, AppCommandError> {
    Ok(Json(
        remove_relay_context_core(&state.db.conn, &state.emitter, params.relay_id).await?,
    ))
}

pub async fn remove_relay_context_rest(
    Extension(state): Extension<Arc<AppState>>,
    Path(relay_id): Path<i32>,
) -> Result<Json<RelayContextPackView>, AppCommandError> {
    Ok(Json(
        remove_relay_context_core(&state.db.conn, &state.emitter, relay_id).await?,
    ))
}

pub async fn get_conversation_relay(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ConversationIdParams>,
) -> Result<Json<Option<RelayProvenanceView>>, AppCommandError> {
    Ok(Json(
        get_conversation_relay_core(&state.db.conn, params.conversation_id).await?,
    ))
}

pub async fn get_conversation_relay_rest(
    Extension(state): Extension<Arc<AppState>>,
    Path(conversation_id): Path<i32>,
) -> Result<Json<Option<RelayProvenanceView>>, AppCommandError> {
    Ok(Json(
        get_conversation_relay_core(&state.db.conn, conversation_id).await?,
    ))
}
