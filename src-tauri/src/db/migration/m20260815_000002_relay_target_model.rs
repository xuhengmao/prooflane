use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(RelayContextPack::Table)
                    .add_column(ColumnDef::new(RelayContextPack::TargetModel).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(RelayContextPack::Table)
                    .drop_column(RelayContextPack::TargetModel)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum RelayContextPack {
    Table,
    TargetModel,
}
