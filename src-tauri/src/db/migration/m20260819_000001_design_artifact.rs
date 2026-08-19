use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DesignArtifact::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(DesignArtifact::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(DesignArtifact::Name).string().not_null())
                    .col(ColumnDef::new(DesignArtifact::Kind).string().not_null())
                    .col(ColumnDef::new(DesignArtifact::Status).string().not_null())
                    .col(
                        ColumnDef::new(DesignArtifact::CurrentRevisionId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(DesignArtifact::ProjectFolderId).integer())
                    .col(
                        ColumnDef::new(DesignArtifact::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(DesignArtifact::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(DesignArtifact::DeletedAt).timestamp_with_time_zone())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_design_artifact_project_folder")
                            .from(DesignArtifact::Table, DesignArtifact::ProjectFolderId)
                            .to(Folder::Table, Folder::Id)
                            .on_delete(ForeignKeyAction::SetNull),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(DesignRevision::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(DesignRevision::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(DesignRevision::ArtifactId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(DesignRevision::ParentRevisionId).string())
                    .col(
                        ColumnDef::new(DesignRevision::RevisionNumber)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(DesignRevision::SchemaVersion)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(DesignRevision::DocumentJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(DesignRevision::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_design_revision_artifact")
                            .from(DesignRevision::Table, DesignRevision::ArtifactId)
                            .to(DesignArtifact::Table, DesignArtifact::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("uq_design_revision_artifact_number")
                    .table(DesignRevision::Table)
                    .col(DesignRevision::ArtifactId)
                    .col(DesignRevision::RevisionNumber)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_design_artifact_updated_at")
                    .table(DesignArtifact::Table)
                    .col(DesignArtifact::UpdatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(DesignRevision::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(DesignArtifact::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum DesignArtifact {
    Table,
    Id,
    Name,
    Kind,
    Status,
    CurrentRevisionId,
    ProjectFolderId,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(DeriveIden)]
enum DesignRevision {
    Table,
    Id,
    ArtifactId,
    ParentRevisionId,
    RevisionNumber,
    SchemaVersion,
    DocumentJson,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Folder {
    Table,
    Id,
}
