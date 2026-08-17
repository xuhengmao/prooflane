use chrono::Utc;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, Condition, ConnectionTrait,
    DatabaseConnection, DatabaseTransaction, EntityTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};

use crate::db::entities::relay_context_pack;
use crate::db::error::DbError;
use crate::models::conversation_relay::{RelayError, RelayErrorCode};

const STATUS_DRAFT: &str = "draft";
const STATUS_ATTACHED: &str = "attached";
const STATUS_CONSUMED: &str = "consumed";
const STATUS_REMOVED: &str = "removed";
const STATUS_INVALID: &str = "invalid";
const CLAIMED: &str = "claimed";
const UNCERTAIN: &str = "uncertain";

#[derive(Debug, Clone)]
pub struct NewRelayPack {
    pub target_draft_id: String,
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
    pub invalid_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ConsumeClaim {
    Claimed { pack: relay_context_pack::Model },
    AlreadyClaimed { pack: relay_context_pack::Model },
}

fn relay_error(code: RelayErrorCode) -> RelayError {
    RelayError::new(code)
}

fn relay_db_error(error: sea_orm::DbErr) -> RelayError {
    if error.to_string().contains("UNIQUE constraint failed") {
        return relay_error(RelayErrorCode::RelayConsumeConflict);
    }
    relay_error(RelayErrorCode::RelaySourceUnavailable)
}

pub(crate) fn consume_not_claimed() -> Condition {
    Condition::any()
        .add(relay_context_pack::Column::ConsumeAttemptState.is_null())
        .add(relay_context_pack::Column::ConsumeAttemptState.ne(CLAIMED))
}

async fn find_pack<C>(conn: &C, relay_id: i32) -> Result<relay_context_pack::Model, RelayError>
where
    C: sea_orm::ConnectionTrait,
{
    relay_context_pack::Entity::find_by_id(relay_id)
        .one(conn)
        .await
        .map_err(relay_db_error)?
        .ok_or_else(|| relay_error(RelayErrorCode::RelaySourceNotFound))
}

pub async fn get_by_id(
    conn: &DatabaseConnection,
    relay_id: i32,
) -> Result<relay_context_pack::Model, RelayError> {
    find_pack(conn, relay_id).await
}

pub async fn get_consumed_by_target(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Option<relay_context_pack::Model>, DbError> {
    Ok(relay_context_pack::Entity::find()
        .filter(relay_context_pack::Column::TargetConversationId.eq(conversation_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_CONSUMED))
        .one(conn)
        .await?)
}

pub async fn get_context_bearing_attempt_by_target(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Option<relay_context_pack::Model>, DbError> {
    Ok(
        get_context_bearing_attempts_by_target(conn, conversation_id)
            .await?
            .into_iter()
            .next(),
    )
}

pub async fn get_context_bearing_attempts_by_target(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Vec<relay_context_pack::Model>, DbError> {
    Ok(relay_context_pack::Entity::find()
        .filter(relay_context_pack::Column::TargetConversationId.eq(conversation_id))
        .filter(
            Condition::any()
                .add(relay_context_pack::Column::Status.eq(STATUS_CONSUMED))
                .add(relay_context_pack::Column::ConsumeAttemptState.is_in([CLAIMED, UNCERTAIN])),
        )
        .order_by_desc(relay_context_pack::Column::UpdatedAt)
        .order_by_desc(relay_context_pack::Column::Id)
        .all(conn)
        .await?)
}

pub async fn create_or_replace_draft(
    conn: &DatabaseConnection,
    pack: NewRelayPack,
) -> Result<relay_context_pack::Model, DbError> {
    let txn = conn.begin().await?;
    let now = Utc::now();
    let status = if pack.invalid_reason.is_some() {
        STATUS_INVALID
    } else {
        STATUS_DRAFT
    };

    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_REMOVED),
        )
        .col_expr(relay_context_pack::Column::UpdatedAt, Expr::value(now))
        .filter(relay_context_pack::Column::TargetDraftId.eq(&pack.target_draft_id))
        .filter(relay_context_pack::Column::Status.is_in([
            STATUS_DRAFT,
            STATUS_ATTACHED,
            STATUS_INVALID,
        ]))
        .filter(consume_not_claimed())
        .exec(&txn)
        .await?;

    let model = relay_context_pack::ActiveModel {
        id: NotSet,
        target_draft_id: Set(pack.target_draft_id),
        target_conversation_id: Set(None),
        source_conversation_id: Set(pack.source_conversation_id),
        source_folder_id: Set(pack.source_folder_id),
        scope_type: Set(pack.scope_type),
        selected_round_ids_json: Set(pack.selected_round_ids_json),
        snapshot_json: Set(pack.snapshot_json),
        source_fingerprint: Set(pack.source_fingerprint),
        estimated_tokens: Set(pack.estimated_tokens),
        context_window_tokens: Set(pack.context_window_tokens),
        target_model: Set(pack.target_model),
        allowed_tokens: Set(pack.allowed_tokens),
        status: Set(status.to_owned()),
        invalid_reason: Set(pack.invalid_reason),
        consume_client_message_id: Set(None),
        consume_attempt_state: Set(None),
        consumed_snapshot_json: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        consumed_at: Set(None),
    }
    .insert(&txn)
    .await?;

    txn.commit().await?;
    Ok(model)
}

pub async fn replace_draft_if_current(
    conn: &DatabaseConnection,
    expected_relay_id: i32,
    pack: NewRelayPack,
) -> Result<relay_context_pack::Model, RelayError> {
    let txn = conn.begin().await.map_err(relay_db_error)?;
    let now = Utc::now();
    let status = if pack.invalid_reason.is_some() {
        STATUS_INVALID
    } else {
        STATUS_DRAFT
    };
    let updated = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_REMOVED),
        )
        .col_expr(relay_context_pack::Column::UpdatedAt, Expr::value(now))
        .filter(relay_context_pack::Column::Id.eq(expected_relay_id))
        .filter(relay_context_pack::Column::TargetDraftId.eq(&pack.target_draft_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_DRAFT))
        .filter(relay_context_pack::Column::InvalidReason.is_null())
        .filter(consume_not_claimed())
        .exec(&txn)
        .await
        .map_err(relay_db_error)?;

    if updated.rows_affected != 1 {
        txn.rollback().await.map_err(relay_db_error)?;
        return Err(relay_error(RelayErrorCode::RelayConsumeConflict));
    }

    let model = relay_context_pack::ActiveModel {
        id: NotSet,
        target_draft_id: Set(pack.target_draft_id),
        target_conversation_id: Set(None),
        source_conversation_id: Set(pack.source_conversation_id),
        source_folder_id: Set(pack.source_folder_id),
        scope_type: Set(pack.scope_type),
        selected_round_ids_json: Set(pack.selected_round_ids_json),
        snapshot_json: Set(pack.snapshot_json),
        source_fingerprint: Set(pack.source_fingerprint),
        estimated_tokens: Set(pack.estimated_tokens),
        context_window_tokens: Set(pack.context_window_tokens),
        target_model: Set(pack.target_model),
        allowed_tokens: Set(pack.allowed_tokens),
        status: Set(status.to_owned()),
        invalid_reason: Set(pack.invalid_reason),
        consume_client_message_id: Set(None),
        consume_attempt_state: Set(None),
        consumed_snapshot_json: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        consumed_at: Set(None),
    }
    .insert(&txn)
    .await
    .map_err(relay_db_error)?;

    txn.commit().await.map_err(relay_db_error)?;
    Ok(model)
}

pub async fn get_active_by_draft(
    conn: &DatabaseConnection,
    target_draft_id: &str,
) -> Result<Option<relay_context_pack::Model>, DbError> {
    Ok(relay_context_pack::Entity::find()
        .filter(relay_context_pack::Column::TargetDraftId.eq(target_draft_id))
        .filter(relay_context_pack::Column::Status.is_in([STATUS_DRAFT, STATUS_ATTACHED]))
        .filter(relay_context_pack::Column::InvalidReason.is_null())
        .one(conn)
        .await?)
}

pub async fn get_restorable_by_draft(
    conn: &DatabaseConnection,
    target_draft_id: &str,
) -> Result<Option<relay_context_pack::Model>, DbError> {
    if let Some(active) = get_active_by_draft(conn, target_draft_id).await? {
        return Ok(Some(active));
    }

    Ok(relay_context_pack::Entity::find()
        .filter(relay_context_pack::Column::TargetDraftId.eq(target_draft_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_INVALID))
        .filter(relay_context_pack::Column::InvalidReason.is_not_null())
        .filter(consume_not_claimed())
        .order_by_desc(relay_context_pack::Column::UpdatedAt)
        .order_by_desc(relay_context_pack::Column::Id)
        .one(conn)
        .await?)
}

pub async fn bind_to_conversation(
    txn: &DatabaseTransaction,
    relay_id: i32,
    target_draft_id: &str,
    conversation_id: i32,
) -> Result<relay_context_pack::Model, RelayError> {
    let now = Utc::now();
    let updated = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_ATTACHED),
        )
        .col_expr(
            relay_context_pack::Column::TargetConversationId,
            Expr::value(Some(conversation_id)),
        )
        .col_expr(relay_context_pack::Column::UpdatedAt, Expr::value(now))
        .filter(relay_context_pack::Column::Id.eq(relay_id))
        .filter(relay_context_pack::Column::TargetDraftId.eq(target_draft_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_DRAFT))
        .filter(relay_context_pack::Column::TargetConversationId.is_null())
        .exec(txn)
        .await
        .map_err(relay_db_error)?;

    if updated.rows_affected != 1 {
        return Err(relay_error(RelayErrorCode::RelayConsumeConflict));
    }

    find_pack(txn, relay_id).await
}

pub async fn claim_consume(
    conn: &DatabaseConnection,
    relay_id: i32,
    client_message_id: &str,
) -> Result<ConsumeClaim, RelayError> {
    let txn = conn.begin().await.map_err(relay_db_error)?;
    let now = Utc::now();
    let updated = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::ConsumeClientMessageId,
            Expr::value(Some(client_message_id.to_owned())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumeAttemptState,
            Expr::value(Some(CLAIMED.to_owned())),
        )
        .col_expr(relay_context_pack::Column::UpdatedAt, Expr::value(now))
        .filter(relay_context_pack::Column::Id.eq(relay_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_ATTACHED))
        .filter(relay_context_pack::Column::InvalidReason.is_null())
        .filter(relay_context_pack::Column::ConsumeClientMessageId.is_null())
        .exec(&txn)
        .await
        .map_err(relay_db_error)?;

    if updated.rows_affected == 1 {
        let pack = find_pack(&txn, relay_id).await?;
        txn.commit().await.map_err(relay_db_error)?;
        return Ok(ConsumeClaim::Claimed { pack });
    }

    let existing = find_pack(&txn, relay_id).await?;
    txn.rollback().await.map_err(relay_db_error)?;
    if existing.status == STATUS_ATTACHED
        && existing.consume_client_message_id.as_deref() == Some(client_message_id)
    {
        return Ok(ConsumeClaim::AlreadyClaimed { pack: existing });
    }

    Err(relay_error(RelayErrorCode::RelayConsumeConflict))
}

pub async fn mark_consumed(
    conn: &DatabaseConnection,
    relay_id: i32,
    client_message_id: &str,
    consumed_snapshot_json: &str,
) -> Result<relay_context_pack::Model, RelayError> {
    let txn = conn.begin().await.map_err(relay_db_error)?;
    let now = Utc::now();
    let updated = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_CONSUMED),
        )
        .col_expr(
            relay_context_pack::Column::ConsumedSnapshotJson,
            Expr::value(Some(consumed_snapshot_json.to_owned())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumedAt,
            Expr::value(Some(now)),
        )
        .col_expr(
            relay_context_pack::Column::InvalidReason,
            Expr::value(Option::<String>::None),
        )
        .col_expr(relay_context_pack::Column::UpdatedAt, Expr::value(now))
        .filter(relay_context_pack::Column::Id.eq(relay_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_ATTACHED))
        .filter(relay_context_pack::Column::ConsumeClientMessageId.eq(client_message_id))
        .filter(relay_context_pack::Column::ConsumeAttemptState.eq(CLAIMED))
        .filter(relay_context_pack::Column::ConsumedSnapshotJson.is_null())
        .exec(&txn)
        .await
        .map_err(relay_db_error)?;

    if updated.rows_affected == 1 {
        let pack = find_pack(&txn, relay_id).await?;
        txn.commit().await.map_err(relay_db_error)?;
        return Ok(pack);
    }

    let existing = find_pack(&txn, relay_id).await?;
    txn.rollback().await.map_err(relay_db_error)?;
    if existing.status == STATUS_CONSUMED && existing.consumed_snapshot_json.is_some() {
        return Err(relay_error(RelayErrorCode::RelayImmutableSnapshot));
    }

    Err(relay_error(RelayErrorCode::RelayConsumeConflict))
}

pub async fn release_claim(
    conn: &DatabaseConnection,
    relay_id: i32,
    client_message_id: &str,
) -> Result<relay_context_pack::Model, RelayError> {
    let txn = conn.begin().await.map_err(relay_db_error)?;
    let updated = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::case(
                relay_context_pack::Column::InvalidReason.is_not_null(),
                STATUS_INVALID,
            )
            .finally(STATUS_ATTACHED)
            .into(),
        )
        .col_expr(
            relay_context_pack::Column::ConsumeClientMessageId,
            Expr::value(Option::<String>::None),
        )
        .col_expr(
            relay_context_pack::Column::ConsumeAttemptState,
            Expr::value(Option::<String>::None),
        )
        .col_expr(
            relay_context_pack::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(relay_context_pack::Column::Id.eq(relay_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_ATTACHED))
        .filter(relay_context_pack::Column::ConsumeClientMessageId.eq(client_message_id))
        .filter(relay_context_pack::Column::ConsumeAttemptState.eq(CLAIMED))
        .exec(&txn)
        .await
        .map_err(relay_db_error)?;

    if updated.rows_affected != 1 {
        txn.rollback().await.map_err(relay_db_error)?;
        return Err(relay_error(RelayErrorCode::RelayConsumeConflict));
    }

    let pack = find_pack(&txn, relay_id).await?;
    txn.commit().await.map_err(relay_db_error)?;
    Ok(pack)
}

pub async fn invalidate_claim(
    conn: &DatabaseConnection,
    relay_id: i32,
    client_message_id: &str,
    reason: RelayErrorCode,
) -> Result<relay_context_pack::Model, RelayError> {
    let txn = conn.begin().await.map_err(relay_db_error)?;
    let updated = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_INVALID),
        )
        .col_expr(
            relay_context_pack::Column::InvalidReason,
            Expr::value(Some(reason.to_string())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumeClientMessageId,
            Expr::value(Option::<String>::None),
        )
        .col_expr(
            relay_context_pack::Column::ConsumeAttemptState,
            Expr::value(Option::<String>::None),
        )
        .col_expr(
            relay_context_pack::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(relay_context_pack::Column::Id.eq(relay_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_ATTACHED))
        .filter(relay_context_pack::Column::ConsumeClientMessageId.eq(client_message_id))
        .filter(relay_context_pack::Column::ConsumeAttemptState.eq(CLAIMED))
        .exec(&txn)
        .await
        .map_err(relay_db_error)?;

    if updated.rows_affected != 1 {
        txn.rollback().await.map_err(relay_db_error)?;
        return Err(relay_error(RelayErrorCode::RelayConsumeConflict));
    }

    let pack = find_pack(&txn, relay_id).await?;
    txn.commit().await.map_err(relay_db_error)?;
    Ok(pack)
}

pub async fn mark_uncertain(
    conn: &DatabaseConnection,
    relay_id: i32,
    client_message_id: &str,
) -> Result<relay_context_pack::Model, RelayError> {
    let txn = conn.begin().await.map_err(relay_db_error)?;
    let updated = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_INVALID),
        )
        .col_expr(
            relay_context_pack::Column::InvalidReason,
            Expr::value(Some(RelayErrorCode::RelaySendUncertain.to_string())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumeAttemptState,
            Expr::value(Some(UNCERTAIN.to_owned())),
        )
        .col_expr(
            relay_context_pack::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(relay_context_pack::Column::Id.eq(relay_id))
        .filter(relay_context_pack::Column::Status.eq(STATUS_ATTACHED))
        .filter(relay_context_pack::Column::ConsumeClientMessageId.eq(client_message_id))
        .filter(relay_context_pack::Column::ConsumeAttemptState.eq(CLAIMED))
        .exec(&txn)
        .await
        .map_err(relay_db_error)?;
    if updated.rows_affected != 1 {
        txn.rollback().await.map_err(relay_db_error)?;
        return Err(relay_error(RelayErrorCode::RelayConsumeConflict));
    }
    let pack = find_pack(&txn, relay_id).await?;
    txn.commit().await.map_err(relay_db_error)?;
    Ok(pack)
}

pub async fn recover_claimed_as_uncertain(conn: &DatabaseConnection) -> Result<u64, DbError> {
    let recovered = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_INVALID),
        )
        .col_expr(
            relay_context_pack::Column::InvalidReason,
            Expr::value(Some(RelayErrorCode::RelaySendUncertain.to_string())),
        )
        .col_expr(
            relay_context_pack::Column::ConsumeAttemptState,
            Expr::value(Some(UNCERTAIN.to_owned())),
        )
        .col_expr(
            relay_context_pack::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(relay_context_pack::Column::Status.eq(STATUS_ATTACHED))
        .filter(relay_context_pack::Column::ConsumeAttemptState.eq(CLAIMED))
        .exec(conn)
        .await?;
    Ok(recovered.rows_affected)
}

pub async fn remove_unclaimed(
    conn: &DatabaseConnection,
    relay_id: i32,
) -> Result<relay_context_pack::Model, RelayError> {
    let txn = conn.begin().await.map_err(relay_db_error)?;
    let update = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_REMOVED),
        )
        .col_expr(
            relay_context_pack::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(relay_context_pack::Column::Id.eq(relay_id))
        .filter(relay_context_pack::Column::Status.is_in([
            STATUS_DRAFT,
            STATUS_ATTACHED,
            STATUS_INVALID,
        ]))
        .filter(consume_not_claimed());
    let updated = update.exec(&txn).await.map_err(relay_db_error)?;

    if updated.rows_affected == 1 {
        let pack = find_pack(&txn, relay_id).await?;
        txn.commit().await.map_err(relay_db_error)?;
        return Ok(pack);
    }

    let existing = find_pack(&txn, relay_id).await;
    txn.rollback().await.map_err(relay_db_error)?;
    let existing = existing?;
    if !matches!(
        existing.status.as_str(),
        STATUS_DRAFT | STATUS_ATTACHED | STATUS_INVALID
    ) {
        return Err(relay_error(RelayErrorCode::RelayImmutableSnapshot));
    }
    if existing.consume_attempt_state.as_deref() == Some(CLAIMED) {
        return Err(relay_error(RelayErrorCode::RelayConsumeConflict));
    }

    Err(relay_error(RelayErrorCode::RelaySourceUnavailable))
}

pub async fn invalidate_unconsumed_by_source(
    conn: &DatabaseConnection,
    source_conversation_id: i32,
    reason: &str,
) -> Result<u64, DbError> {
    let txn = conn.begin().await?;
    let result = invalidate_unconsumed_by_source_on(&txn, source_conversation_id, reason).await?;
    txn.commit().await?;
    Ok(result)
}

pub async fn invalidate_unconsumed_by_source_on<C>(
    conn: &C,
    source_conversation_id: i32,
    reason: &str,
) -> Result<u64, DbError>
where
    C: ConnectionTrait,
{
    let marked = relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::InvalidReason,
            Expr::value(Some(reason.to_owned())),
        )
        .col_expr(
            relay_context_pack::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(relay_context_pack::Column::SourceConversationId.eq(source_conversation_id))
        .filter(relay_context_pack::Column::Status.is_in([STATUS_DRAFT, STATUS_ATTACHED]))
        .exec(conn)
        .await?;
    relay_context_pack::Entity::update_many()
        .col_expr(
            relay_context_pack::Column::Status,
            Expr::value(STATUS_INVALID),
        )
        .col_expr(
            relay_context_pack::Column::InvalidReason,
            Expr::value(Some(reason.to_owned())),
        )
        .col_expr(
            relay_context_pack::Column::UpdatedAt,
            Expr::value(Utc::now()),
        )
        .filter(relay_context_pack::Column::SourceConversationId.eq(source_conversation_id))
        .filter(relay_context_pack::Column::Status.is_in([STATUS_DRAFT, STATUS_ATTACHED]))
        .filter(consume_not_claimed())
        .exec(conn)
        .await?;
    Ok(marked.rows_affected)
}

pub async fn list_unconsumed_by_source(
    conn: &DatabaseConnection,
    source_conversation_id: i32,
) -> Result<Vec<relay_context_pack::Model>, DbError> {
    list_unconsumed_by_source_on(conn, source_conversation_id).await
}

pub async fn list_unconsumed_by_source_on<C>(
    conn: &C,
    source_conversation_id: i32,
) -> Result<Vec<relay_context_pack::Model>, DbError>
where
    C: ConnectionTrait,
{
    Ok(relay_context_pack::Entity::find()
        .filter(relay_context_pack::Column::SourceConversationId.eq(source_conversation_id))
        .filter(relay_context_pack::Column::Status.is_in([STATUS_DRAFT, STATUS_ATTACHED]))
        .all(conn)
        .await?)
}
