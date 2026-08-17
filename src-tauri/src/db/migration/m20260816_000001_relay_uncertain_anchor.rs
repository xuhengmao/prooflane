use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "DROP INDEX IF EXISTS uq_relay_target_conversation;\
                 CREATE UNIQUE INDEX uq_relay_target_conversation \
                 ON relay_context_pack(target_conversation_id) \
                 WHERE target_conversation_id IS NOT NULL \
                   AND status IN ('attached', 'consumed');",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE relay_context_pack \
                 SET target_conversation_id = NULL \
                 WHERE target_conversation_id IS NOT NULL \
                   AND status NOT IN ('attached', 'consumed');\
                 DROP INDEX IF EXISTS uq_relay_target_conversation;\
                 CREATE UNIQUE INDEX uq_relay_target_conversation \
                 ON relay_context_pack(target_conversation_id) \
                 WHERE target_conversation_id IS NOT NULL;",
            )
            .await?;
        Ok(())
    }
}
