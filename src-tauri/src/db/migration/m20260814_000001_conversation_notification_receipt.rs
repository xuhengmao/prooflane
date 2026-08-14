use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ConversationNotificationReceipts::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::ConversationId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::RunId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::NotificationType)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::MessageId)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::SentAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::ClickedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(ConversationNotificationReceipts::ClearedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_conversation_notification_receipt_conversation")
                            .from(
                                ConversationNotificationReceipts::Table,
                                ConversationNotificationReceipts::ConversationId,
                            )
                            .to(Conversation::Table, Conversation::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("uq_conversation_notification_receipt_run_type")
                    .table(ConversationNotificationReceipts::Table)
                    .col(ConversationNotificationReceipts::ConversationId)
                    .col(ConversationNotificationReceipts::RunId)
                    .col(ConversationNotificationReceipts::NotificationType)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(ConversationNotificationReceipts::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum ConversationNotificationReceipts {
    Table,
    Id,
    ConversationId,
    RunId,
    NotificationType,
    MessageId,
    SentAt,
    ClickedAt,
    ClearedAt,
}

#[derive(DeriveIden)]
enum Conversation {
    Table,
    Id,
}
