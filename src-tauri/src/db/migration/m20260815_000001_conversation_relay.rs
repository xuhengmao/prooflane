use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "CREATE TABLE conversation_capability_setting (\
                    id INTEGER PRIMARY KEY CHECK (id = 1), \
                    relay_enabled BOOLEAN NOT NULL DEFAULT TRUE, \
                    created_at TEXT NOT NULL, \
                    updated_at TEXT NOT NULL\
                );\
                INSERT INTO conversation_capability_setting \
                    (id, relay_enabled, created_at, updated_at) \
                VALUES (1, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);\
                CREATE TABLE relay_context_pack (\
                    id INTEGER PRIMARY KEY AUTOINCREMENT, \
                    target_draft_id TEXT NOT NULL, \
                    target_conversation_id INTEGER NULL, \
                    source_conversation_id INTEGER NOT NULL, \
                    source_folder_id INTEGER NOT NULL, \
                    scope_type TEXT NOT NULL, \
                    selected_round_ids_json TEXT NOT NULL, \
                    snapshot_json TEXT NOT NULL, \
                    source_fingerprint TEXT NOT NULL, \
                    estimated_tokens INTEGER NOT NULL, \
                    context_window_tokens INTEGER NULL, \
                    allowed_tokens INTEGER NOT NULL, \
                    status TEXT NOT NULL DEFAULT 'draft', \
                    invalid_reason TEXT NULL, \
                    consume_client_message_id TEXT NULL, \
                    consume_attempt_state TEXT NULL, \
                    consumed_snapshot_json TEXT NULL, \
                    created_at TEXT NOT NULL, \
                    updated_at TEXT NOT NULL, \
                    consumed_at TEXT NULL, \
                    FOREIGN KEY (source_conversation_id) REFERENCES conversation(id) ON DELETE NO ACTION, \
                    FOREIGN KEY (target_conversation_id) REFERENCES conversation(id) ON DELETE NO ACTION, \
                    FOREIGN KEY (source_folder_id) REFERENCES folder(id) ON DELETE NO ACTION\
                );\
                CREATE UNIQUE INDEX uq_relay_active_draft \
                    ON relay_context_pack(target_draft_id) \
                    WHERE status IN ('draft', 'attached');\
                CREATE UNIQUE INDEX uq_relay_target_conversation \
                    ON relay_context_pack(target_conversation_id) \
                    WHERE target_conversation_id IS NOT NULL;\
                CREATE UNIQUE INDEX uq_relay_consume_message \
                    ON relay_context_pack(consume_client_message_id) \
                    WHERE consume_client_message_id IS NOT NULL;\
                CREATE INDEX idx_relay_context_pack_source_conversation \
                    ON relay_context_pack(source_conversation_id);\
                CREATE INDEX idx_relay_context_pack_source_folder \
                    ON relay_context_pack(source_folder_id);\
                CREATE INDEX idx_relay_context_pack_status \
                    ON relay_context_pack(status);\
                CREATE INDEX idx_relay_context_pack_updated_at \
                    ON relay_context_pack(updated_at);",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(RelayContextPack::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(ConversationCapabilitySetting::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RelayContextPack {
    Table,
}

#[derive(DeriveIden)]
enum ConversationCapabilitySetting {
    Table,
}
