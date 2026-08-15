//! HTTP API integration tests.
//!
//! Builds the real Axum router from `web::router::build_router`, wired to an
//! in-memory SQLite database (`fresh_in_memory_db`) and a `WebOnly` event
//! emitter (`EventEmitter::test_web_only`). Drives requests through
//! `axum-test::TestServer` so no TCP socket is involved.
//!
//! Scope of this first pass:
//! - Authentication matrix on a representative protected endpoint
//! - Public endpoint (`get_system_language_settings`) reachable without token
//! - DB-backed endpoints (`load_folder_history`, `list_open_folders`) return
//!   the expected JSON shape. `list_folders` is NOT one of them — it parses
//!   the real home directory and ignores the test DB entirely.
//!
//! Not covered: WebSocket attach (separate concern), endpoints that touch the
//! Tauri webview (those are gated behind `tauri-runtime`).

use std::sync::Arc;

use axum_test::TestServer;
use codeg_lib::app_state::AppState;
use codeg_lib::conversation_relay::fingerprint_rounds;
use codeg_lib::conversation_relay::service::get_relay_context_by_draft_core;
use codeg_lib::db::entities::relay_context_pack;
use codeg_lib::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use codeg_lib::models::agent::AgentType;
use codeg_lib::models::conversation_relay::{
    RelayRound, RelayScopeSelection, RelayScopeType, RelaySnapshot, RelaySnapshotSource, RelayStats,
};
use codeg_lib::web::router::build_router;
use codeg_lib::web::shutdown::ShutdownSignal;
use sea_orm::{ActiveModelTrait, EntityTrait, PaginatorTrait, Set};
use serde_json::{json, Value};

const TEST_TOKEN: &str = "integration-test-token";

async fn build_test_server() -> (TestServer, tempfile::TempDir, tempfile::TempDir) {
    let data_dir = tempfile::tempdir().expect("data dir");
    let static_dir = tempfile::tempdir().expect("static dir");

    let db = fresh_in_memory_db().await;
    let state = Arc::new(AppState::new_for_test(db, data_dir.path().to_path_buf()));
    let shutdown = Arc::new(ShutdownSignal::new());

    let router = build_router(
        state,
        TEST_TOKEN.to_string(),
        static_dir.path().to_path_buf(),
        shutdown,
    );

    let server = TestServer::new(router).expect("test server");
    // Keep data_dir and static_dir alive for the whole test by returning them.
    (server, data_dir, static_dir)
}

// ────────────────────────────────────────────────────────────────────────────
// Auth matrix
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn protected_endpoint_rejects_missing_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server.post("/api/list_folders").json(&json!({})).await;
    assert_eq!(resp.status_code(), 401);
}

#[tokio::test]
async fn protected_endpoint_rejects_wrong_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/list_folders")
        .add_header("authorization", "Bearer wrong-token")
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 401);
}

#[tokio::test]
async fn protected_endpoint_accepts_correct_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/list_folders")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
}

// ────────────────────────────────────────────────────────────────────────────
// Public endpoint
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn public_language_settings_reachable_without_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/get_system_language_settings")
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body: Value = resp.json();
    // Shape contract: returns a JSON object (exact fields vary by default).
    assert!(body.is_object(), "expected object body, got {body}");
}

// ────────────────────────────────────────────────────────────────────────────
// DB-backed endpoint
// ────────────────────────────────────────────────────────────────────────────

// Note: `/api/list_folders` invokes every parser against the *real* user home
// directory, so it can't be asserted to-be-empty without elaborate filesystem
// isolation. We test DB-backed endpoints (`load_folder_history`,
// `list_open_folders`) instead — those only touch the in-memory SQLite.

#[tokio::test]
async fn load_folder_history_returns_empty_array_on_fresh_db() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/load_folder_history")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body: Value = resp.json();
    assert_eq!(
        body.as_array().expect("array body").len(),
        0,
        "fresh DB should have no folder history"
    );
}

#[tokio::test]
async fn open_folder_then_list_open_folders_shows_it() {
    let (server, _data, _static) = build_test_server().await;
    let open_resp = server
        .post("/api/open_folder")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({"path": "/tmp/codeg-test-folder"}))
        .await;
    assert_eq!(
        open_resp.status_code(),
        200,
        "open_folder failed: {}",
        open_resp.text()
    );

    let list_resp = server
        .post("/api/list_open_folders")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(list_resp.status_code(), 200);
    let body: Value = list_resp.json();
    let arr = body.as_array().expect("array");
    assert_eq!(
        arr.len(),
        1,
        "list_open_folders should reflect the open_folder call, got {body}"
    );
}

#[tokio::test]
async fn acp_find_connection_for_conversation_returns_null_when_none_live() {
    // No live ACP connection is bound to any conversation on a fresh server, so
    // discovery returns JSON `null` (Option::None) with 200 — the frontend
    // reads this as "no live owner, open the persisted detail instead".
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/acp_find_connection_for_conversation")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({"conversationId": 999, "agentType": "claude_code"}))
        .await;
    assert_eq!(resp.status_code(), 200, "body: {}", resp.text());
    let body: Value = resp.json();
    assert!(
        body.is_null(),
        "expected null for an unbound conversation, got {body}"
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Field naming sanity (snake_case ↔ camelCase boundary)
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn health_endpoint_returns_status_field() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/health")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body: Value = resp.json();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn conversation_notification_claim_endpoint_is_atomic() {
    let (server, state, _data, _static) = build_test_server_with_state().await;
    let folder_id = seed_folder(&state.db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&state.db, folder_id, AgentType::ClaudeCode).await;
    let payload = json!({
        "conversationId": conversation_id,
        "runId": "run-1",
        "notificationType": "completed",
        "messageId": "message-1"
    });

    let first = server
        .post("/api/claim_conversation_notification")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(first.status_code(), 200, "body: {}", first.text());
    assert_eq!(first.json::<Value>()["claimed"], true);

    let duplicate = server
        .post("/api/claim_conversation_notification")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(duplicate.status_code(), 200, "body: {}", duplicate.text());
    assert_eq!(duplicate.json::<Value>()["claimed"], false);
}

#[tokio::test]
async fn conversation_notification_release_endpoint_allows_retry() {
    let (server, state, _data, _static) = build_test_server_with_state().await;
    let folder_id = seed_folder(&state.db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&state.db, folder_id, AgentType::ClaudeCode).await;
    let payload = json!({
        "conversationId": conversation_id,
        "runId": "run-1",
        "notificationType": "failed"
    });

    let claim = server
        .post("/api/claim_conversation_notification")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(claim.status_code(), 200, "body: {}", claim.text());

    let first = server
        .post("/api/release_conversation_notification")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(first.status_code(), 200, "body: {}", first.text());
    assert_eq!(first.json::<Value>()["released"], true);

    let duplicate = server
        .post("/api/release_conversation_notification")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(duplicate.status_code(), 200, "body: {}", duplicate.text());
    assert_eq!(duplicate.json::<Value>()["released"], false);

    let retry = server
        .post("/api/claim_conversation_notification")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(retry.status_code(), 200, "body: {}", retry.text());
    assert_eq!(retry.json::<Value>()["claimed"], true);
}

#[tokio::test]
async fn conversation_notification_clicked_endpoint_is_idempotent() {
    let (server, state, _data, _static) = build_test_server_with_state().await;
    let folder_id = seed_folder(&state.db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&state.db, folder_id, AgentType::ClaudeCode).await;
    let payload = json!({
        "conversationId": conversation_id,
        "runId": "run-1",
        "notificationType": "action_required"
    });
    let claim = server
        .post("/api/claim_conversation_notification")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(claim.status_code(), 200, "body: {}", claim.text());

    let first = server
        .post("/api/mark_conversation_notification_clicked")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(first.status_code(), 200, "body: {}", first.text());
    assert_eq!(first.json::<Value>()["updated"], true);

    let duplicate = server
        .post("/api/mark_conversation_notification_clicked")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&payload)
        .await;
    assert_eq!(duplicate.status_code(), 200, "body: {}", duplicate.text());
    assert_eq!(duplicate.json::<Value>()["updated"], false);
}

#[tokio::test]
async fn unknown_endpoint_returns_501_with_typed_error() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/this_endpoint_does_not_exist")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 501);
    let body: Value = resp.json();
    assert_eq!(body["code"], "not_implemented");
    assert!(body["message"].is_string());
}

// ────────────────────────────────────────────────────────────────────────────
// Live feedback settings + submit gate
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn feedback_settings_round_trip_defaults_off() {
    let (server, _data, _static) = build_test_server().await;
    // Default is OFF (opt-in feature).
    let resp = server
        .post("/api/get_feedback_settings")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    assert_eq!(resp.json::<Value>()["enabled"], false);

    // Enable it.
    let resp = server
        .post("/api/set_feedback_settings")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({ "settings": { "enabled": true } }))
        .await;
    assert_eq!(resp.status_code(), 200);
    assert_eq!(resp.json::<Value>()["enabled"], true);

    // Reads back enabled.
    let resp = server
        .post("/api/get_feedback_settings")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.json::<Value>()["enabled"], true);
}

// The submit gate is per-connection (the agent's actual `check_user_feedback`
// capability), unit-tested in `ConnectionManager::submit_feedback`
// (`submit_feedback_rejected_when_tool_unavailable`), not via the global setting.

// ────────────────────────────────────────────────────────────────────────────
// Response compression (allowlist predicate) + turn-window params
// ────────────────────────────────────────────────────────────────────────────

async fn build_test_server_with_state() -> (
    TestServer,
    Arc<AppState>,
    tempfile::TempDir,
    tempfile::TempDir,
) {
    let data_dir = tempfile::tempdir().expect("data dir");
    let static_dir = tempfile::tempdir().expect("static dir");

    let db = fresh_in_memory_db().await;
    let state = Arc::new(AppState::new_for_test(db, data_dir.path().to_path_buf()));
    let shutdown = Arc::new(ShutdownSignal::new());

    let router = build_router(
        state.clone(),
        TEST_TOKEN.to_string(),
        static_dir.path().to_path_buf(),
        shutdown,
    );

    let server = TestServer::new(router).expect("test server");
    (server, state, data_dir, static_dir)
}

async fn seed_api_relay_pack(
    state: &AppState,
    target_draft_id: &str,
    source_conversation_id: i32,
    source_folder_id: i32,
    target_conversation_id: Option<i32>,
    status: &str,
) -> relay_context_pack::Model {
    let scope = RelayScopeSelection {
        scope_type: RelayScopeType::RecentRounds,
        selected_round_ids: vec!["round-a".to_owned()],
    };
    let round = RelayRound {
        id: "round-a".to_owned(),
        user_text: "keep the API semantics aligned".to_owned(),
        assistant_text: "done".to_owned(),
        tools: Vec::new(),
        files: Vec::new(),
        source_message_ids: vec!["round-a".to_owned(), "assistant-a".to_owned()],
    };
    let snapshot = RelaySnapshot {
        version: 1,
        source: RelaySnapshotSource {
            conversation_id: source_conversation_id,
            folder_id: source_folder_id,
        },
        scope: scope.clone(),
        available_rounds: vec![round.clone()],
        included_rounds: vec![round],
        summary: None,
        files: Vec::new(),
        stats: RelayStats {
            message_count: 2,
            file_count: 0,
            todo_count: 0,
        },
        canonical_context: "previous context".to_owned(),
    };
    relay_context_pack::ActiveModel {
        target_draft_id: Set(target_draft_id.to_owned()),
        target_conversation_id: Set(target_conversation_id),
        source_conversation_id: Set(source_conversation_id),
        source_folder_id: Set(source_folder_id),
        scope_type: Set("recent_rounds".to_owned()),
        selected_round_ids_json: Set(serde_json::to_string(&scope.selected_round_ids).unwrap()),
        snapshot_json: Set(serde_json::to_string(&snapshot).unwrap()),
        source_fingerprint: Set(fingerprint_rounds(&snapshot.available_rounds)),
        estimated_tokens: Set(20),
        context_window_tokens: Set(None),
        allowed_tokens: Set(4_000),
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
    .insert(&state.db.conn)
    .await
    .unwrap()
}

fn authorized(server: &TestServer, method: &str, path: &str) -> axum_test::TestRequest {
    let request = match method {
        "GET" => server.get(path),
        "POST" => server.post(path),
        "PATCH" => server.patch(path),
        "DELETE" => server.delete(path),
        _ => panic!("unsupported test method"),
    };
    request.add_header("authorization", format!("Bearer {TEST_TOKEN}"))
}

#[tokio::test]
async fn conversation_relay_settings_command_alias_and_rest_share_state() {
    let (server, state, _data, _static) = build_test_server_with_state().await;

    let defaults = authorized(&server, "POST", "/api/get_conversation_capabilities")
        .json(&json!({}))
        .await;
    assert_eq!(defaults.status_code(), 200);
    assert_eq!(defaults.json::<Value>(), json!({ "relayEnabled": true }));

    let rest_update = authorized(&server, "PATCH", "/api/settings/conversation-capabilities")
        .json(&json!({ "relayEnabled": false }))
        .await;
    assert_eq!(rest_update.status_code(), 200);
    assert_eq!(
        rest_update.json::<Value>(),
        json!({ "relayEnabled": false })
    );

    let command_read = authorized(&server, "POST", "/api/get_conversation_capabilities")
        .json(&json!({}))
        .await;
    assert_eq!(
        command_read.json::<Value>(),
        json!({ "relayEnabled": false })
    );
    let command_update = authorized(&server, "POST", "/api/update_conversation_capabilities")
        .json(&json!({ "relayEnabled": true }))
        .await;
    let rest_read = authorized(&server, "GET", "/api/settings/conversation-capabilities").await;
    assert_eq!(command_update.json::<Value>(), rest_read.json::<Value>());
    assert_eq!(rest_read.json::<Value>(), json!({ "relayEnabled": true }));
    assert_eq!(
        relay_context_pack::Entity::find()
            .count(&state.db.conn)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn conversation_relay_restore_patch_remove_and_provenance_have_command_rest_parity() {
    let (server, state, _data, _static) = build_test_server_with_state().await;
    let folder_id = seed_folder(&state.db, "C:/workspace/relay-api").await;
    let source = seed_conversation(&state.db, folder_id, AgentType::Codex).await;
    let target = seed_conversation(&state.db, folder_id, AgentType::Codex).await;
    let command_pack =
        seed_api_relay_pack(&state, "draft-command", source, folder_id, None, "draft").await;
    let rest_pack =
        seed_api_relay_pack(&state, "draft-rest", source, folder_id, None, "draft").await;
    seed_api_relay_pack(
        &state,
        "consumed-provenance",
        source,
        folder_id,
        Some(target),
        "consumed",
    )
    .await;

    let core = get_relay_context_by_draft_core(&state.db.conn, "draft-command")
        .await
        .unwrap()
        .unwrap();
    let command_restore = authorized(&server, "POST", "/api/get_relay_context_by_draft")
        .json(&json!({ "targetDraftId": "draft-command" }))
        .await;
    let rest_restore = authorized(
        &server,
        "GET",
        "/api/relay-context-packs/by-draft/draft-command",
    )
    .await;
    assert_eq!(command_restore.status_code(), 200);
    assert_eq!(
        command_restore.json::<Value>(),
        rest_restore.json::<Value>()
    );
    assert_eq!(command_restore.json::<Value>()["id"], core.id);

    let command_patch_input = json!({
        "scope": { "scopeType": "recent_rounds", "selectedRoundIds": ["round-a"] },
        "targetAgentType": "codex",
        "targetModel": "unknown-model"
    });
    let rest_patch_input = json!({
        "scope": { "scopeType": "recent_rounds", "selectedRoundIds": ["round-a"] },
        "targetAgentType": "codex",
        "targetModel": "claude-sonnet-4-6 [5000M]"
    });
    let command_patch = authorized(&server, "POST", "/api/update_relay_context")
        .json(&json!({ "relayId": command_pack.id, "input": command_patch_input }))
        .await;
    let rest_patch = authorized(
        &server,
        "PATCH",
        &format!("/api/relay-context-packs/{}", rest_pack.id),
    )
    .json(&rest_patch_input)
    .await;
    assert_eq!(command_patch.status_code(), 200);
    assert_eq!(rest_patch.status_code(), 200);
    let command_patch_body = command_patch.json::<Value>();
    let rest_patch_body = rest_patch.json::<Value>();
    assert!(command_patch_body["contextWindowTokens"].is_null());
    assert!(rest_patch_body["contextWindowTokens"].is_null());
    for field in [
        "sourceConversationId",
        "sourceFolderId",
        "scope",
        "snapshot",
        "estimatedTokens",
        "contextWindowTokens",
        "allowedTokens",
        "status",
    ] {
        assert_eq!(command_patch_body[field], rest_patch_body[field], "{field}");
    }

    let command_remove = authorized(&server, "POST", "/api/remove_relay_context")
        .json(&json!({ "relayId": command_patch_body["id"] }))
        .await;
    let rest_remove = authorized(
        &server,
        "DELETE",
        &format!("/api/relay-context-packs/{}", rest_patch_body["id"]),
    )
    .await;
    assert_eq!(command_remove.json::<Value>()["status"], "removed");
    assert_eq!(rest_remove.json::<Value>()["status"], "removed");

    let command_provenance = authorized(&server, "POST", "/api/get_conversation_relay")
        .json(&json!({ "conversationId": target }))
        .await;
    let rest_provenance = authorized(
        &server,
        "GET",
        &format!("/api/conversations/{target}/relay"),
    )
    .await;
    assert_eq!(command_provenance.status_code(), 200);
    assert_eq!(
        command_provenance.json::<Value>(),
        rest_provenance.json::<Value>()
    );
}

#[tokio::test]
async fn conversation_relay_preview_is_explicit_and_failures_never_persist_or_replace() {
    let (server, state, _data, _static) = build_test_server_with_state().await;
    let source_folder = seed_folder(&state.db, "C:/workspace/relay-source").await;
    let target_folder = seed_folder(&state.db, "C:/workspace/relay-target").await;
    let source = seed_conversation(&state.db, source_folder, AgentType::Codex).await;
    seed_api_relay_pack(
        &state,
        "protected-draft",
        source,
        source_folder,
        None,
        "draft",
    )
    .await;

    let list = authorized(&server, "POST", "/api/list_all_conversations")
        .json(&json!({}))
        .await;
    assert_eq!(list.status_code(), 200);
    assert_eq!(
        relay_context_pack::Entity::find()
            .count(&state.db.conn)
            .await
            .unwrap(),
        1
    );

    let explicit_cross_project = json!({
        "requestId": "api-preview-command",
        "targetDraftId": "protected-draft",
        "sourceConversationId": source,
        "targetFolderId": target_folder,
        "targetAgentType": "codex",
        "targetModel": null,
        "scope": { "scopeType": "recent_rounds", "selectedRoundIds": ["round-a"] }
    });
    let command_reservation = authorized(&server, "POST", "/api/reserve_relay_preview")
        .json(&json!({
            "requestId": "api-preview-command",
            "targetDraftId": "protected-draft"
        }))
        .await;
    assert_eq!(command_reservation.status_code(), 200);
    assert_eq!(command_reservation.json::<Value>(), json!(true));
    let command = authorized(&server, "POST", "/api/preview_relay_context")
        .json(&explicit_cross_project)
        .await;
    let rest_reservation = authorized(&server, "POST", "/api/reserve_relay_preview")
        .json(&json!({
            "requestId": "api-preview-rest",
            "targetDraftId": "protected-draft"
        }))
        .await;
    assert_eq!(rest_reservation.status_code(), 200);
    assert_eq!(rest_reservation.json::<Value>(), json!(true));
    let rest = authorized(&server, "POST", "/api/relay-context-packs/preview")
        .json(&json!({
            "requestId": "api-preview-rest",
            "targetDraftId": "protected-draft",
            "sourceConversationId": source,
            "targetFolderId": target_folder,
            "targetAgentType": "codex",
            "targetModel": null,
            "scope": { "scopeType": "recent_rounds", "selectedRoundIds": ["round-a"] }
        }))
        .await;
    assert_eq!(command.status_code(), rest.status_code());
    assert_eq!(
        command.json::<Value>()["message"],
        rest.json::<Value>()["message"]
    );

    let missing_source_reservation = authorized(&server, "POST", "/api/reserve_relay_preview")
        .json(&json!({
            "requestId": "api-preview-missing-source",
            "targetDraftId": "protected-draft"
        }))
        .await;
    assert_eq!(missing_source_reservation.status_code(), 200);
    assert_eq!(missing_source_reservation.json::<Value>(), json!(true));
    let missing_source = authorized(&server, "POST", "/api/preview_relay_context")
        .json(&json!({
            "requestId": "api-preview-missing-source",
            "targetDraftId": "protected-draft",
            "targetFolderId": target_folder,
            "targetAgentType": "codex",
            "targetModel": null,
            "scope": { "scopeType": "recent_rounds", "selectedRoundIds": ["round-a"] }
        }))
        .await;
    assert!(missing_source.status_code().is_client_error());
    let retained = get_relay_context_by_draft_core(&state.db.conn, "protected-draft")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(retained.snapshot.canonical_context, "previous context");
    assert_eq!(
        relay_context_pack::Entity::find()
            .count(&state.db.conn)
            .await
            .unwrap(),
        1
    );

    let cancelled = authorized(&server, "POST", "/api/cancel_relay_preview")
        .json(&json!({ "requestId": "api-preview-cancel" }))
        .await;
    assert_eq!(cancelled.status_code(), 200);
    assert_eq!(cancelled.json::<Value>(), json!(false));
}

#[tokio::test]
async fn json_api_is_gzip_compressed_when_client_accepts() {
    let (server, state, _data, _static) = build_test_server_with_state().await;
    // Seed one folder so the JSON body clears the size-above threshold. The
    // endpoint has to be a DB-backed one: `/api/list_folders` ignores this
    // row and parses the *real* home directory instead, so it answers `[]`
    // — 2 bytes, under the threshold — on a clean CI runner while returning
    // a fat body on a developer machine.
    codeg_lib::db::service::folder_service::add_folder(
        &state.db.conn,
        "/tmp/codeg-compression-test-folder-with-a-reasonably-long-path",
    )
    .await
    .expect("seed folder");

    // Control: the same body, uncompressed, is over `MIN_COMPRESS_BYTES` —
    // that is what makes the gzip assertion below meaningful rather than an
    // accident of how much the host happens to have on disk.
    let plain = server
        .post("/api/list_open_folders")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(plain.status_code(), 200);
    assert_eq!(
        plain.json::<Value>().as_array().expect("array body").len(),
        1,
        "the seeded folder must be what this endpoint answers with"
    );
    assert!(
        plain.text().len() >= 32,
        "body must clear the size-above threshold, got {} bytes",
        plain.text().len()
    );

    let resp = server
        .post("/api/list_open_folders")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .add_header("accept-encoding", "gzip")
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    assert_eq!(
        resp.headers()
            .get("content-encoding")
            .and_then(|v| v.to_str().ok()),
        Some("gzip"),
        "JSON API responses must be gzip-compressed when the client accepts it"
    );
}

#[tokio::test]
async fn static_js_is_compressed_but_binary_download_is_not() {
    let (server, _data, static_dir) = build_test_server().await;
    let big_text = "console.log('x');\n".repeat(200);
    std::fs::write(static_dir.path().join("chunk.js"), &big_text).expect("write js");
    std::fs::write(static_dir.path().join("blob.bin"), vec![0u8; 4096]).expect("write bin");

    let js = server
        .get("/chunk.js")
        .add_header("accept-encoding", "gzip")
        .await;
    assert_eq!(js.status_code(), 200);
    assert_eq!(
        js.headers()
            .get("content-encoding")
            .and_then(|v| v.to_str().ok()),
        Some("gzip"),
        "static JS must compress"
    );

    let bin = server
        .get("/blob.bin")
        .add_header("accept-encoding", "gzip")
        .await;
    assert_eq!(bin.status_code(), 200);
    assert!(
        bin.headers().get("content-encoding").is_none(),
        "binary responses must stay identity-encoded (Content-Length preserved for progress)"
    );
    assert_eq!(
        bin.headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok()),
        Some("4096"),
        "binary Content-Length must survive the compression layer"
    );
}

#[tokio::test]
async fn get_folder_conversation_accepts_turn_window_params() {
    let (server, state, _data, _static) = build_test_server_with_state().await;
    let folder_id = codeg_lib::db::service::folder_service::add_folder(
        &state.db.conn,
        "/tmp/codeg-window-param-test",
    )
    .await
    .expect("seed folder")
    .id;
    let conv_id = codeg_lib::commands::conversations::create_conversation_core(
        &state.db.conn,
        folder_id,
        codeg_lib::models::AgentType::ClaudeCode,
        None,
    )
    .await
    .expect("create conversation");

    // tailTurns → windowed response: marker fields present even for an empty
    // transcript (offset/total 0, fingerprint = seed).
    let resp = server
        .post("/api/get_folder_conversation")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({ "conversationId": conv_id, "tailTurns": 50 }))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body = resp.json::<Value>();
    assert_eq!(body["turns_offset"], 0);
    assert_eq!(body["turns_total"], 0);
    assert_eq!(body["assistant_turns_before_offset"], 0);
    assert!(body["prefix_hash"].is_string());

    // No params → legacy full response: none of the window fields serialize.
    let resp = server
        .post("/api/get_folder_conversation")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({ "conversationId": conv_id }))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body = resp.json::<Value>();
    assert!(body.get("turns_offset").is_none());
    assert!(body.get("prefix_hash").is_none());

    // Both selectors → invalid input.
    let resp = server
        .post("/api/get_folder_conversation")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({ "conversationId": conv_id, "tailTurns": 5, "fromIndex": 3 }))
        .await;
    assert!(
        resp.status_code().is_client_error(),
        "tailTurns+fromIndex must be rejected, got {}",
        resp.status_code()
    );

    // Turns page endpoint responds with the seam fields.
    let resp = server
        .post("/api/get_folder_conversation_turns")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({ "conversationId": conv_id, "beforeIndex": 10, "limit": 5 }))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body = resp.json::<Value>();
    assert_eq!(body["turns_total"], 0);
    assert!(body["prefix_hash"].is_string());
    assert!(body["prefix_hash_before_index"].is_string());
}
