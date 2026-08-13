use std::sync::Arc;

use axum::{extract::Extension, Json};

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::prompt_optimization::{
    cancel_prompt_optimization_core, optimize_prompt_core, PromptOptimizationRequest,
};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelPromptOptimizationRequest {
    pub request_id: String,
}

pub async fn optimize_prompt(
    Extension(state): Extension<Arc<AppState>>,
    Json(request): Json<PromptOptimizationRequest>,
) -> Result<Json<String>, AppCommandError> {
    let result = optimize_prompt_core(
        &state.connection_manager,
        &state.db,
        &state.data_dir,
        request,
    )
    .await
    .map_err(AppCommandError::task_execution_failed)?;
    Ok(Json(result))
}

pub async fn cancel_prompt_optimization(
    Json(request): Json<CancelPromptOptimizationRequest>,
) -> Json<bool> {
    Json(cancel_prompt_optimization_core(&request.request_id).await)
}
