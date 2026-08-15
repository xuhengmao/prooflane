use codeg_lib::db::entities::{conversation_capability_setting, relay_context_pack};
use codeg_lib::db::test_helpers::{fresh_in_memory_db, seed_conversation, seed_folder};
use codeg_lib::models::agent::AgentType;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

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
