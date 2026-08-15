use codeg_lib::db::test_helpers::fresh_in_memory_db;
use codeg_lib::db::test_helpers::{seed_conversation, seed_folder};
use codeg_lib::db::service::conversation_notification_service;
use codeg_lib::models::agent::AgentType;
use codeg_lib::commands::conversation_notification::{
    claim_conversation_notification_core, conversation_notification_app_focused,
    conversation_notification_block_reason,
    conversation_notification_permission_from_windows_error,
    ConversationNotificationPermission, ConversationNotificationActivationPayload,
    ConversationNotificationSendReason, ConversationNotificationSendResult,
    ConversationNotificationType, ConversationNotificationWindowState,
};
use sea_orm::{ConnectionTrait, DbBackend, Statement};

#[test]
fn application_focus_requires_a_visible_unminimized_focused_window() {
    assert!(!conversation_notification_app_focused(&[
        ConversationNotificationWindowState {
            visible: false,
            minimized: false,
            focused: true,
        },
        ConversationNotificationWindowState {
            visible: true,
            minimized: true,
            focused: true,
        },
        ConversationNotificationWindowState {
            visible: true,
            minimized: false,
            focused: false,
        },
    ]));

    assert!(conversation_notification_app_focused(&[
        ConversationNotificationWindowState {
            visible: false,
            minimized: false,
            focused: false,
        },
        ConversationNotificationWindowState {
            visible: true,
            minimized: false,
            focused: true,
        },
    ]));
}

#[test]
fn delivery_gate_prioritizes_foreground_then_permission() {
    assert_eq!(
        conversation_notification_block_reason(
            true,
            ConversationNotificationPermission::Denied,
        ),
        Some(ConversationNotificationSendReason::Foreground)
    );
    assert_eq!(
        conversation_notification_block_reason(
            false,
            ConversationNotificationPermission::Denied,
        ),
        Some(ConversationNotificationSendReason::PermissionDenied)
    );
    assert_eq!(
        conversation_notification_block_reason(
            false,
            ConversationNotificationPermission::Prompt,
        ),
        Some(ConversationNotificationSendReason::PermissionPrompt)
    );
    assert_eq!(
        conversation_notification_block_reason(
            false,
            ConversationNotificationPermission::Unsupported,
        ),
        Some(ConversationNotificationSendReason::Unsupported)
    );
    assert_eq!(
        conversation_notification_block_reason(
            false,
            ConversationNotificationPermission::Granted,
        ),
        None
    );
}

#[test]
fn missing_windows_notification_registration_allows_the_first_delivery() {
    assert_eq!(
        conversation_notification_permission_from_windows_error(0x80070490u32 as i32),
        ConversationNotificationPermission::Granted
    );
}

#[test]
fn desktop_notification_wire_payload_uses_frontend_field_names() {
    let payload = ConversationNotificationActivationPayload {
        conversation_id: 42,
        run_id: "run-42".to_owned(),
        notification_type: ConversationNotificationType::ActionRequired,
        message_id: Some("message-42".to_owned()),
    };
    assert_eq!(
        serde_json::to_value(payload).expect("serialize activation payload"),
        serde_json::json!({
            "conversationId": 42,
            "runId": "run-42",
            "notificationType": "action_required",
            "messageId": "message-42",
        })
    );

    assert_eq!(
        serde_json::to_value(ConversationNotificationSendResult {
            sent: false,
            reason: Some(ConversationNotificationSendReason::Foreground),
        })
        .expect("serialize blocked delivery"),
        serde_json::json!({ "sent": false, "reason": "foreground" })
    );
}

#[tokio::test]
async fn migration_creates_conversation_notification_receipt_columns() {
    let db = fresh_in_memory_db().await;

    let rows = db
        .conn
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA table_info(conversation_notification_receipts)".to_owned(),
        ))
        .await
        .expect("read notification receipt schema");
    let columns = rows
        .iter()
        .map(|row| row.try_get::<String>("", "name").expect("column name"))
        .collect::<Vec<_>>();

    assert_eq!(
        columns,
        [
            "id",
            "conversation_id",
            "run_id",
            "notification_type",
            "message_id",
            "sent_at",
            "clicked_at",
            "cleared_at",
        ]
    );
}

#[tokio::test]
async fn migration_enforces_one_receipt_per_conversation_run_and_type() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;

    let insert = |run_id: &str, notification_type: &str| {
        Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO conversation_notification_receipts \
                 (conversation_id, run_id, notification_type, sent_at) \
                 VALUES ({conversation_id}, '{run_id}', '{notification_type}', \
                 '2026-08-14T12:00:00Z')"
            ),
        )
    };

    db.conn
        .execute(insert("run-1", "completed"))
        .await
        .expect("insert first receipt");
    let duplicate = db
        .conn
        .execute(insert("run-1", "completed"))
        .await;

    assert!(duplicate.is_err(), "duplicate receipt must be rejected");
    db.conn
        .execute(insert("run-1", "failed"))
        .await
        .expect("a different notification type is independent");
    db.conn
        .execute(insert("run-2", "completed"))
        .await
        .expect("a different run is independent");
}

#[tokio::test]
async fn deleting_a_conversation_cascades_its_notification_receipts() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;

    db.conn
        .execute(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "INSERT INTO conversation_notification_receipts \
                 (conversation_id, run_id, notification_type, sent_at) \
                 VALUES ({conversation_id}, 'run-1', 'completed', \
                 '2026-08-14T12:00:00Z')"
            ),
        ))
        .await
        .expect("insert receipt");
    db.conn
        .execute(Statement::from_string(
            DbBackend::Sqlite,
            format!("DELETE FROM conversation WHERE id = {conversation_id}"),
        ))
        .await
        .expect("delete conversation");

    let remaining = db
        .conn
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM conversation_notification_receipts"
                .to_owned(),
        ))
        .await
        .expect("count receipts")
        .expect("count row")
        .try_get::<i64>("", "count")
        .expect("receipt count");

    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn claim_is_atomic_and_reports_duplicate_receipts() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;

    let first = conversation_notification_service::claim(
        &db.conn,
        conversation_id,
        "run-1",
        "completed",
        Some("message-1"),
    )
    .await
    .expect("claim first receipt");
    let duplicate = conversation_notification_service::claim(
        &db.conn,
        conversation_id,
        "run-1",
        "completed",
        Some("message-2"),
    )
    .await
    .expect("claim duplicate receipt");

    assert!(first);
    assert!(!duplicate);

    let rows = db
        .conn
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT message_id FROM conversation_notification_receipts".to_owned(),
        ))
        .await
        .expect("read claimed receipts");
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0]
            .try_get::<Option<String>>("", "message_id")
            .expect("stored message id"),
        Some("message-1".to_owned())
    );
}

#[tokio::test]
async fn release_allows_a_failed_notification_to_be_claimed_again() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;

    assert!(
        conversation_notification_service::claim(
            &db.conn,
            conversation_id,
            "run-1",
            "completed",
            None,
        )
        .await
        .expect("claim receipt")
    );
    assert!(
        conversation_notification_service::release(
            &db.conn,
            conversation_id,
            "run-1",
            "completed",
        )
        .await
        .expect("release receipt")
    );
    assert!(
        !conversation_notification_service::release(
            &db.conn,
            conversation_id,
            "run-1",
            "completed",
        )
        .await
        .expect("release already removed receipt")
    );
    assert!(
        conversation_notification_service::claim(
            &db.conn,
            conversation_id,
            "run-1",
            "completed",
            None,
        )
        .await
        .expect("reclaim released receipt")
    );
}

#[tokio::test]
async fn mark_clicked_sets_clicked_and_cleared_once() {
    let db = fresh_in_memory_db().await;
    let folder_id = seed_folder(&db, "C:/workspace").await;
    let conversation_id =
        seed_conversation(&db, folder_id, AgentType::ClaudeCode).await;
    conversation_notification_service::claim(
        &db.conn,
        conversation_id,
        "run-1",
        "action_required",
        Some("message-1"),
    )
    .await
    .expect("claim receipt");

    assert!(
        conversation_notification_service::mark_clicked(
            &db.conn,
            conversation_id,
            "run-1",
            "action_required",
        )
        .await
        .expect("mark first click")
    );
    let first = read_click_timestamps(&db).await;

    assert!(
        !conversation_notification_service::mark_clicked(
            &db.conn,
            conversation_id,
            "run-1",
            "action_required",
        )
        .await
        .expect("mark duplicate click")
    );
    let second = read_click_timestamps(&db).await;

    assert!(first.0.is_some());
    assert!(first.1.is_some());
    assert_eq!(second, first);
}

async fn read_click_timestamps(
    db: &codeg_lib::db::AppDatabase,
) -> (Option<String>, Option<String>) {
    let row = db
        .conn
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT clicked_at, cleared_at FROM conversation_notification_receipts"
                .to_owned(),
        ))
        .await
        .expect("read click timestamps")
        .expect("receipt row");
    (
        row.try_get("", "clicked_at").expect("clicked_at"),
        row.try_get("", "cleared_at").expect("cleared_at"),
    )
}

#[tokio::test]
async fn claim_core_rejects_invalid_identifiers_without_writing() {
    let db = fresh_in_memory_db().await;
    let invalid = [
        (0, "run-1".to_owned(), None),
        (1, "   ".to_owned(), None),
        (1, "r".repeat(257), None),
        (1, "run-1".to_owned(), Some("m".repeat(513))),
    ];

    for (conversation_id, run_id, message_id) in invalid {
        let error = claim_conversation_notification_core(
            &db.conn,
            conversation_id,
            &run_id,
            ConversationNotificationType::Completed,
            message_id.as_deref(),
        )
        .await
        .expect_err("invalid notification receipt input must fail");
        assert_eq!(
            serde_json::to_value(error).expect("serialize command error")["code"],
            "invalid_input"
        );
    }

    let count = db
        .conn
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT COUNT(*) AS count FROM conversation_notification_receipts"
                .to_owned(),
        ))
        .await
        .expect("count receipts")
        .expect("count row")
        .try_get::<i64>("", "count")
        .expect("receipt count");
    assert_eq!(count, 0);
}
