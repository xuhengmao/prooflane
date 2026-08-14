use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

#[cfg(feature = "tauri-runtime")]
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::app_error::AppCommandError;
use crate::db::service::conversation_notification_service;

const MAX_RUN_ID_BYTES: usize = 256;
const MAX_MESSAGE_ID_BYTES: usize = 512;
const WINDOWS_ELEMENT_NOT_FOUND_HRESULT: i32 = 0x80070490u32 as i32;
#[cfg(feature = "tauri-runtime")]
const MAX_NOTIFICATION_TITLE_BYTES: usize = 256;
#[cfg(feature = "tauri-runtime")]
const MAX_NOTIFICATION_BODY_BYTES: usize = 1024;
#[cfg(feature = "tauri-runtime")]
const CONVERSATION_NOTIFICATION_ACTIVATED_EVENT: &str = "notification://activated";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationNotificationType {
    Completed,
    Failed,
    ActionRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationNotificationPermission {
    Granted,
    Denied,
    Prompt,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationNotificationSendReason {
    Foreground,
    PermissionDenied,
    PermissionPrompt,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversationNotificationWindowState {
    pub visible: bool,
    pub minimized: bool,
    pub focused: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationNotificationActivationPayload {
    pub conversation_id: i32,
    pub run_id: String,
    pub notification_type: ConversationNotificationType,
    pub message_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationNotificationState {
    pub app_focused: bool,
    pub permission: ConversationNotificationPermission,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ConversationNotificationPermissionResult {
    pub permission: ConversationNotificationPermission,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ConversationNotificationSendResult {
    pub sent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ConversationNotificationSendReason>,
}

pub fn conversation_notification_app_focused(
    windows: &[ConversationNotificationWindowState],
) -> bool {
    windows
        .iter()
        .any(|window| window.visible && !window.minimized && window.focused)
}

pub fn conversation_notification_block_reason(
    app_focused: bool,
    permission: ConversationNotificationPermission,
) -> Option<ConversationNotificationSendReason> {
    if app_focused {
        return Some(ConversationNotificationSendReason::Foreground);
    }

    match permission {
        ConversationNotificationPermission::Granted => None,
        ConversationNotificationPermission::Denied => {
            Some(ConversationNotificationSendReason::PermissionDenied)
        }
        ConversationNotificationPermission::Prompt => {
            Some(ConversationNotificationSendReason::PermissionPrompt)
        }
        ConversationNotificationPermission::Unsupported => {
            Some(ConversationNotificationSendReason::Unsupported)
        }
    }
}

pub fn conversation_notification_permission_from_windows_error(
    error_code: i32,
) -> ConversationNotificationPermission {
    if error_code == WINDOWS_ELEMENT_NOT_FOUND_HRESULT {
        // Windows creates this app-specific setting only after the first toast.
        ConversationNotificationPermission::Granted
    } else {
        ConversationNotificationPermission::Unsupported
    }
}

impl ConversationNotificationType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::ActionRequired => "action_required",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ClaimConversationNotificationResult {
    pub claimed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ReleaseConversationNotificationResult {
    pub released: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct MarkConversationNotificationClickedResult {
    pub updated: bool,
}

fn validate_key(
    conversation_id: i32,
    run_id: &str,
    message_id: Option<&str>,
) -> Result<(), AppCommandError> {
    if conversation_id <= 0 {
        return Err(AppCommandError::invalid_input(
            "conversationId must be a positive integer",
        ));
    }
    if run_id.trim().is_empty() || run_id.len() > MAX_RUN_ID_BYTES {
        return Err(AppCommandError::invalid_input(
            "runId must contain 1 to 256 bytes",
        ));
    }
    if message_id.is_some_and(|value| value.len() > MAX_MESSAGE_ID_BYTES) {
        return Err(AppCommandError::invalid_input(
            "messageId must not exceed 512 bytes",
        ));
    }
    Ok(())
}

#[cfg(feature = "tauri-runtime")]
fn notification_window_states(app: &AppHandle) -> Vec<ConversationNotificationWindowState> {
    app.webview_windows()
        .values()
        .map(|window| ConversationNotificationWindowState {
            visible: window.is_visible().unwrap_or(false),
            minimized: window.is_minimized().unwrap_or(true),
            focused: window.is_focused().unwrap_or(false),
        })
        .collect()
}

#[cfg(all(feature = "tauri-runtime", target_os = "windows"))]
fn native_notification_permission(app: &AppHandle) -> ConversationNotificationPermission {
    use windows::{
        core::HSTRING,
        UI::Notifications::{NotificationSetting, ToastNotificationManager},
    };

    let app_id = HSTRING::from(app.config().identifier.as_str());
    match ToastNotificationManager::CreateToastNotifierWithId(&app_id) {
        Ok(notifier) => match notifier.Setting() {
            Ok(NotificationSetting::Enabled) => ConversationNotificationPermission::Granted,
            Ok(_) => ConversationNotificationPermission::Denied,
            Err(error) => {
                conversation_notification_permission_from_windows_error(error.code().0)
            }
        },
        Err(_) => ConversationNotificationPermission::Unsupported,
    }
}

#[cfg(all(feature = "tauri-runtime", not(target_os = "windows")))]
fn native_notification_permission(app: &AppHandle) -> ConversationNotificationPermission {
    use tauri::plugin::PermissionState;
    use tauri_plugin_notification::NotificationExt;

    match app.notification().permission_state() {
        Ok(PermissionState::Granted) => ConversationNotificationPermission::Granted,
        Ok(PermissionState::Denied) => ConversationNotificationPermission::Denied,
        Ok(PermissionState::Prompt | PermissionState::PromptWithRationale) => {
            ConversationNotificationPermission::Prompt
        }
        Err(_) => ConversationNotificationPermission::Unsupported,
    }
}

#[cfg(all(feature = "tauri-runtime", not(target_os = "windows")))]
fn request_native_notification_permission(
    app: &AppHandle,
) -> ConversationNotificationPermission {
    use tauri::plugin::PermissionState;
    use tauri_plugin_notification::NotificationExt;

    match app.notification().request_permission() {
        Ok(PermissionState::Granted) => ConversationNotificationPermission::Granted,
        Ok(PermissionState::Denied) => ConversationNotificationPermission::Denied,
        Ok(PermissionState::Prompt | PermissionState::PromptWithRationale) => {
            ConversationNotificationPermission::Prompt
        }
        Err(_) => ConversationNotificationPermission::Unsupported,
    }
}

#[cfg(all(feature = "tauri-runtime", target_os = "windows"))]
fn request_native_notification_permission(
    app: &AppHandle,
) -> ConversationNotificationPermission {
    native_notification_permission(app)
}

#[cfg(all(feature = "tauri-runtime", target_os = "windows"))]
fn activate_conversation_notification(
    app: &AppHandle,
    target_window_label: &str,
    payload: &ConversationNotificationActivationPayload,
) {
    let target = app
        .get_webview_window(target_window_label)
        .or_else(|| app.get_webview_window("main"));
    if let Some(window) = target {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, payload);
    } else {
        crate::commands::windows::show_main_window(app);
        let _ = app.emit(CONVERSATION_NOTIFICATION_ACTIVATED_EVENT, payload);
    }
}

#[cfg(all(feature = "tauri-runtime", target_os = "windows"))]
fn show_native_conversation_notification(
    app: &AppHandle,
    target_window: &WebviewWindow,
    title: &str,
    body: &str,
    payload: &ConversationNotificationActivationPayload,
) -> Result<(), AppCommandError> {
    use tauri_winrt_notification::Toast;

    let callback_app = app.clone();
    let target_window_label = target_window.label().to_owned();
    let activation_payload = payload.clone();
    Toast::new(app.config().identifier.as_str())
        .title(title)
        .text1(body)
        .on_activated(move |_| {
            activate_conversation_notification(
                &callback_app,
                &target_window_label,
                &activation_payload,
            );
            Ok(())
        })
        .show()
        .map_err(|error| {
            AppCommandError::task_execution_failed("Failed to send system notification")
                .with_detail(error.to_string())
        })
}

#[cfg(all(feature = "tauri-runtime", not(target_os = "windows")))]
fn show_native_conversation_notification(
    app: &AppHandle,
    _target_window: &WebviewWindow,
    title: &str,
    body: &str,
    _payload: &ConversationNotificationActivationPayload,
) -> Result<(), AppCommandError> {
    use tauri_plugin_notification::NotificationExt;

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| {
            AppCommandError::task_execution_failed("Failed to send system notification")
                .with_detail(error.to_string())
        })
}

pub async fn claim_conversation_notification_core(
    conn: &DatabaseConnection,
    conversation_id: i32,
    run_id: &str,
    notification_type: ConversationNotificationType,
    message_id: Option<&str>,
) -> Result<ClaimConversationNotificationResult, AppCommandError> {
    validate_key(conversation_id, run_id, message_id)?;
    let claimed = conversation_notification_service::claim(
        conn,
        conversation_id,
        run_id,
        notification_type.as_str(),
        message_id,
    )
    .await
    .map_err(AppCommandError::from)?;
    Ok(ClaimConversationNotificationResult { claimed })
}

pub async fn release_conversation_notification_core(
    conn: &DatabaseConnection,
    conversation_id: i32,
    run_id: &str,
    notification_type: ConversationNotificationType,
) -> Result<ReleaseConversationNotificationResult, AppCommandError> {
    validate_key(conversation_id, run_id, None)?;
    let released = conversation_notification_service::release(
        conn,
        conversation_id,
        run_id,
        notification_type.as_str(),
    )
    .await
    .map_err(AppCommandError::from)?;
    Ok(ReleaseConversationNotificationResult { released })
}

pub async fn mark_conversation_notification_clicked_core(
    conn: &DatabaseConnection,
    conversation_id: i32,
    run_id: &str,
    notification_type: ConversationNotificationType,
) -> Result<MarkConversationNotificationClickedResult, AppCommandError> {
    validate_key(conversation_id, run_id, None)?;
    let updated = conversation_notification_service::mark_clicked(
        conn,
        conversation_id,
        run_id,
        notification_type.as_str(),
    )
    .await
    .map_err(AppCommandError::from)?;
    Ok(MarkConversationNotificationClickedResult { updated })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn claim_conversation_notification(
    db: tauri::State<'_, crate::db::AppDatabase>,
    conversation_id: i32,
    run_id: String,
    notification_type: ConversationNotificationType,
    message_id: Option<String>,
) -> Result<ClaimConversationNotificationResult, AppCommandError> {
    claim_conversation_notification_core(
        &db.conn,
        conversation_id,
        &run_id,
        notification_type,
        message_id.as_deref(),
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn release_conversation_notification(
    db: tauri::State<'_, crate::db::AppDatabase>,
    conversation_id: i32,
    run_id: String,
    notification_type: ConversationNotificationType,
) -> Result<ReleaseConversationNotificationResult, AppCommandError> {
    release_conversation_notification_core(
        &db.conn,
        conversation_id,
        &run_id,
        notification_type,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn mark_conversation_notification_clicked(
    db: tauri::State<'_, crate::db::AppDatabase>,
    conversation_id: i32,
    run_id: String,
    notification_type: ConversationNotificationType,
) -> Result<MarkConversationNotificationClickedResult, AppCommandError> {
    mark_conversation_notification_clicked_core(
        &db.conn,
        conversation_id,
        &run_id,
        notification_type,
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn get_conversation_notification_state(
    app: AppHandle,
) -> Result<ConversationNotificationState, AppCommandError> {
    let windows = notification_window_states(&app);
    Ok(ConversationNotificationState {
        app_focused: conversation_notification_app_focused(&windows),
        permission: native_notification_permission(&app),
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn request_conversation_notification_permission(
    app: AppHandle,
) -> Result<ConversationNotificationPermissionResult, AppCommandError> {
    Ok(ConversationNotificationPermissionResult {
        permission: request_native_notification_permission(&app),
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn send_conversation_notification(
    app: AppHandle,
    window: WebviewWindow,
    title: String,
    body: String,
    activation_payload: ConversationNotificationActivationPayload,
) -> Result<ConversationNotificationSendResult, AppCommandError> {
    validate_key(
        activation_payload.conversation_id,
        &activation_payload.run_id,
        activation_payload.message_id.as_deref(),
    )?;
    if title.trim().is_empty() || title.len() > MAX_NOTIFICATION_TITLE_BYTES {
        return Err(AppCommandError::invalid_input(
            "title must contain 1 to 256 bytes",
        ));
    }
    if body.trim().is_empty() || body.len() > MAX_NOTIFICATION_BODY_BYTES {
        return Err(AppCommandError::invalid_input(
            "body must contain 1 to 1024 bytes",
        ));
    }

    let windows = notification_window_states(&app);
    let app_focused = conversation_notification_app_focused(&windows);
    let permission = native_notification_permission(&app);
    if let Some(reason) = conversation_notification_block_reason(app_focused, permission) {
        return Ok(ConversationNotificationSendResult {
            sent: false,
            reason: Some(reason),
        });
    }

    show_native_conversation_notification(&app, &window, &title, &body, &activation_payload)?;
    Ok(ConversationNotificationSendResult {
        sent: true,
        reason: None,
    })
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn open_conversation_notification_settings(
    app: AppHandle,
) -> Result<(), AppCommandError> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        use tauri_plugin_opener::OpenerExt;

        #[cfg(target_os = "windows")]
        let target = "ms-settings:notifications";
        #[cfg(target_os = "macos")]
        let target = "x-apple.systempreferences:com.apple.preference.notifications";

        app.opener()
            .open_url(target, None::<&str>)
            .map_err(|error| {
                AppCommandError::window(
                    "Failed to open notification settings",
                    error.to_string(),
                )
            })?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = app;

    Ok(())
}
