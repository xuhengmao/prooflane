use chrono::Utc;
use sea_orm::sea_query::{Expr, OnConflict};
use sea_orm::{
    ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
};

use crate::db::entities::conversation_notification_receipt;
use crate::db::error::DbError;

pub async fn claim(
    conn: &DatabaseConnection,
    conversation_id: i32,
    run_id: &str,
    notification_type: &str,
    message_id: Option<&str>,
) -> Result<bool, DbError> {
    let active = conversation_notification_receipt::ActiveModel {
        id: NotSet,
        conversation_id: Set(conversation_id),
        run_id: Set(run_id.to_owned()),
        notification_type: Set(notification_type.to_owned()),
        message_id: Set(message_id.map(str::to_owned)),
        sent_at: Set(Utc::now()),
        clicked_at: Set(None),
        cleared_at: Set(None),
    };

    let result = conversation_notification_receipt::Entity::insert(active)
        .on_conflict(
            OnConflict::columns([
                conversation_notification_receipt::Column::ConversationId,
                conversation_notification_receipt::Column::RunId,
                conversation_notification_receipt::Column::NotificationType,
            ])
            .do_nothing()
            .to_owned(),
        )
        .exec_without_returning(conn)
        .await?;

    Ok(result == 1)
}

pub async fn release(
    conn: &DatabaseConnection,
    conversation_id: i32,
    run_id: &str,
    notification_type: &str,
) -> Result<bool, DbError> {
    let result = conversation_notification_receipt::Entity::delete_many()
        .filter(conversation_notification_receipt::Column::ConversationId.eq(conversation_id))
        .filter(conversation_notification_receipt::Column::RunId.eq(run_id))
        .filter(
            conversation_notification_receipt::Column::NotificationType.eq(notification_type),
        )
        .exec(conn)
        .await?;

    Ok(result.rows_affected == 1)
}

pub async fn mark_clicked(
    conn: &DatabaseConnection,
    conversation_id: i32,
    run_id: &str,
    notification_type: &str,
) -> Result<bool, DbError> {
    let now = Utc::now();
    let result = conversation_notification_receipt::Entity::update_many()
        .col_expr(
            conversation_notification_receipt::Column::ClickedAt,
            Expr::value(now),
        )
        .col_expr(
            conversation_notification_receipt::Column::ClearedAt,
            Expr::value(now),
        )
        .filter(conversation_notification_receipt::Column::ConversationId.eq(conversation_id))
        .filter(conversation_notification_receipt::Column::RunId.eq(run_id))
        .filter(
            conversation_notification_receipt::Column::NotificationType.eq(notification_type),
        )
        .filter(conversation_notification_receipt::Column::ClickedAt.is_null())
        .exec(conn)
        .await?;

    Ok(result.rows_affected == 1)
}
