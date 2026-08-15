use chrono::Utc;
use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, TransactionTrait};
use serde::Serialize;

use crate::app_error::AppCommandError;
use crate::db::entities::{conversation_capability_setting, relay_context_pack};
use crate::db::error::DbError;
use crate::web::event_bridge::{
    emit_event, ConversationRelayChange, EventEmitter, CONVERSATION_CAPABILITIES_CHANGED_EVENT,
    CONVERSATION_RELAY_CHANGED_EVENT,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationCapabilitySettings {
    pub relay_enabled: bool,
}

pub async fn get_capabilities(
    conn: &DatabaseConnection,
) -> Result<ConversationCapabilitySettings, DbError> {
    let setting = conversation_capability_setting::Entity::find_by_id(1)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound("conversation capability setting".to_owned()))?;

    Ok(ConversationCapabilitySettings {
        relay_enabled: setting.relay_enabled,
    })
}

pub async fn set_relay_enabled(
    conn: &DatabaseConnection,
    emitter: &EventEmitter,
    enabled: bool,
) -> Result<ConversationCapabilitySettings, AppCommandError> {
    let txn = conn.begin().await.map_err(DbError::from)?;
    let now = Utc::now();
    let removed = if enabled {
        Vec::new()
    } else {
        relay_context_pack::Entity::find()
            .filter(relay_context_pack::Column::Status.is_in(["draft", "attached"]))
            .all(&txn)
            .await
            .map_err(DbError::from)?
    };

    conversation_capability_setting::Entity::update_many()
        .col_expr(
            conversation_capability_setting::Column::RelayEnabled,
            Expr::value(enabled),
        )
        .col_expr(
            conversation_capability_setting::Column::UpdatedAt,
            Expr::value(now),
        )
        .filter(conversation_capability_setting::Column::Id.eq(1))
        .exec(&txn)
        .await
        .map_err(DbError::from)?;

    if !enabled {
        relay_context_pack::Entity::update_many()
            .col_expr(relay_context_pack::Column::Status, Expr::value("removed"))
            .col_expr(relay_context_pack::Column::UpdatedAt, Expr::value(now))
            .filter(relay_context_pack::Column::Status.is_in(["draft", "attached"]))
            .exec(&txn)
            .await
            .map_err(DbError::from)?;
    }

    txn.commit().await.map_err(DbError::from)?;

    let settings = ConversationCapabilitySettings {
        relay_enabled: enabled,
    };
    emit_event(emitter, CONVERSATION_CAPABILITIES_CHANGED_EVENT, settings);
    for pack in removed {
        emit_event(
            emitter,
            CONVERSATION_RELAY_CHANGED_EVENT,
            ConversationRelayChange {
                relay_id: pack.id,
                target_draft_id: pack.target_draft_id,
                status: "removed".to_owned(),
                error_code: None,
            },
        );
    }

    Ok(settings)
}
