use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "design_artifact")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub current_revision_id: String,
    pub project_folder_id: Option<i32>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub deleted_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::design_revision::Entity")]
    Revisions,
    #[sea_orm(
        belongs_to = "super::folder::Entity",
        from = "Column::ProjectFolderId",
        to = "super::folder::Column::Id",
        on_delete = "SetNull"
    )]
    ProjectFolder,
}

impl Related<super::design_revision::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Revisions.def()
    }
}

impl Related<super::folder::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ProjectFolder.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
