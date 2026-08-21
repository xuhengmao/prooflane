use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "design_revision")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub artifact_id: String,
    pub parent_revision_id: Option<String>,
    pub revision_number: i32,
    pub schema_version: i32,
    #[sea_orm(column_type = "Text")]
    pub document_json: String,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::design_artifact::Entity",
        from = "Column::ArtifactId",
        to = "super::design_artifact::Column::Id",
        on_delete = "Cascade"
    )]
    Artifact,
}

impl Related<super::design_artifact::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Artifact.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
