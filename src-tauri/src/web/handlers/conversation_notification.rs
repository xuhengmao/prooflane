use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::conversation_notification::{
    claim_conversation_notification_core, ClaimConversationNotificationResult,
    mark_conversation_notification_clicked_core, release_conversation_notification_core,
    ConversationNotificationType, MarkConversationNotificationClickedResult,
    ReleaseConversationNotificationResult,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimConversationNotificationParams {
    pub conversation_id: i32,
    pub run_id: String,
    pub notification_type: ConversationNotificationType,
    pub message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationNotificationKeyParams {
    pub conversation_id: i32,
    pub run_id: String,
    pub notification_type: ConversationNotificationType,
}

pub async fn claim_conversation_notification(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ClaimConversationNotificationParams>,
) -> Result<Json<ClaimConversationNotificationResult>, AppCommandError> {
    let result = claim_conversation_notification_core(
        &state.db.conn,
        params.conversation_id,
        &params.run_id,
        params.notification_type,
        params.message_id.as_deref(),
    )
    .await?;
    Ok(Json(result))
}

pub async fn release_conversation_notification(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ConversationNotificationKeyParams>,
) -> Result<Json<ReleaseConversationNotificationResult>, AppCommandError> {
    let result = release_conversation_notification_core(
        &state.db.conn,
        params.conversation_id,
        &params.run_id,
        params.notification_type,
    )
    .await?;
    Ok(Json(result))
}

pub async fn mark_conversation_notification_clicked(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ConversationNotificationKeyParams>,
) -> Result<Json<MarkConversationNotificationClickedResult>, AppCommandError> {
    let result = mark_conversation_notification_clicked_core(
        &state.db.conn,
        params.conversation_id,
        &params.run_id,
        params.notification_type,
    )
    .await?;
    Ok(Json(result))
}
