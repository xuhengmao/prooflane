use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "relay_context_pack")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub target_draft_id: String,
    pub target_conversation_id: Option<i32>,
    pub source_conversation_id: i32,
    pub source_folder_id: i32,
    pub scope_type: String,
    pub selected_round_ids_json: String,
    pub snapshot_json: String,
    pub source_fingerprint: String,
    pub estimated_tokens: i32,
    pub context_window_tokens: Option<i32>,
    pub target_model: Option<String>,
    pub allowed_tokens: i32,
    pub status: String,
    pub invalid_reason: Option<String>,
    pub consume_client_message_id: Option<String>,
    pub consume_attempt_state: Option<String>,
    pub consumed_snapshot_json: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub consumed_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::conversation::Entity",
        from = "Column::SourceConversationId",
        to = "super::conversation::Column::Id",
        on_delete = "NoAction"
    )]
    SourceConversation,
    #[sea_orm(
        belongs_to = "super::conversation::Entity",
        from = "Column::TargetConversationId",
        to = "super::conversation::Column::Id",
        on_delete = "NoAction"
    )]
    TargetConversation,
    #[sea_orm(
        belongs_to = "super::folder::Entity",
        from = "Column::SourceFolderId",
        to = "super::folder::Column::Id",
        on_delete = "NoAction"
    )]
    SourceFolder,
}

impl ActiveModelBehavior for ActiveModel {}
