use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, Set, TransactionTrait,
};
use uuid::Uuid;

use crate::db::entities::{design_artifact, design_revision};
use crate::db::error::DbError;
use crate::models::{
    CreateDesignArtifact, DesignArtifactDetail, DesignArtifactInfo, DesignRevisionInfo,
    SaveDesignRevision,
};

const SUPPORTED_KINDS: &[&str] = &[
    "page",
    "component",
    "image",
    "icon",
    "design_system",
    "flow",
];

fn artifact_info(model: design_artifact::Model) -> DesignArtifactInfo {
    DesignArtifactInfo {
        id: model.id,
        name: model.name,
        kind: model.kind,
        status: model.status,
        current_revision_id: model.current_revision_id,
        project_folder_id: model.project_folder_id,
        created_at: model.created_at,
        updated_at: model.updated_at,
        deleted_at: model.deleted_at,
    }
}

fn revision_info(model: design_revision::Model) -> Result<DesignRevisionInfo, DbError> {
    let document = serde_json::from_str(&model.document_json)
        .map_err(|error| DbError::Validation(format!("invalid stored design document: {error}")))?;
    Ok(DesignRevisionInfo {
        id: model.id,
        artifact_id: model.artifact_id,
        parent_revision_id: model.parent_revision_id,
        revision_number: model.revision_number,
        schema_version: model.schema_version,
        document,
        created_at: model.created_at,
    })
}

fn validate_document(document: &serde_json::Value, schema_version: i32) -> Result<(), DbError> {
    if schema_version < 1 {
        return Err(DbError::Validation(
            "schema version must be at least 1".to_owned(),
        ));
    }
    let embedded = document
        .get("schemaVersion")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| DbError::Validation("document schemaVersion is required".to_owned()))?;
    if embedded != i64::from(schema_version) {
        return Err(DbError::Validation(
            "document schemaVersion does not match revision".to_owned(),
        ));
    }
    Ok(())
}

fn validate_create(input: &CreateDesignArtifact) -> Result<(), DbError> {
    if input.name.trim().is_empty() {
        return Err(DbError::Validation("design name is required".to_owned()));
    }
    if !SUPPORTED_KINDS.contains(&input.kind.as_str()) {
        return Err(DbError::Validation(format!(
            "unsupported design kind: {}",
            input.kind
        )));
    }
    validate_document(&input.document, 1)
}

async fn active_artifact(
    conn: &DatabaseConnection,
    id: &str,
) -> Result<design_artifact::Model, DbError> {
    design_artifact::Entity::find_by_id(id.to_owned())
        .filter(design_artifact::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("design artifact {id}")))
}

pub async fn create(
    conn: &DatabaseConnection,
    input: CreateDesignArtifact,
) -> Result<DesignArtifactInfo, DbError> {
    validate_create(&input)?;
    let transaction = conn.begin().await?;
    let now = Utc::now();
    let artifact_id = Uuid::new_v4().to_string();
    let revision_id = Uuid::new_v4().to_string();

    let artifact = design_artifact::ActiveModel {
        id: Set(artifact_id.clone()),
        name: Set(input.name.trim().to_owned()),
        kind: Set(input.kind),
        status: Set("draft".to_owned()),
        current_revision_id: Set(revision_id.clone()),
        project_folder_id: Set(input.project_folder_id),
        created_at: Set(now),
        updated_at: Set(now),
        deleted_at: Set(None),
    }
    .insert(&transaction)
    .await?;

    design_revision::ActiveModel {
        id: Set(revision_id),
        artifact_id: Set(artifact_id),
        parent_revision_id: Set(None),
        revision_number: Set(1),
        schema_version: Set(1),
        document_json: Set(input.document.to_string()),
        created_at: Set(now),
    }
    .insert(&transaction)
    .await?;
    transaction.commit().await?;
    Ok(artifact_info(artifact))
}

pub async fn list(
    conn: &DatabaseConnection,
    include_archived: bool,
) -> Result<Vec<DesignArtifactInfo>, DbError> {
    let mut query = design_artifact::Entity::find()
        .filter(design_artifact::Column::DeletedAt.is_null())
        .order_by_desc(design_artifact::Column::UpdatedAt)
        .order_by_asc(design_artifact::Column::Id);
    if !include_archived {
        query = query.filter(design_artifact::Column::Status.ne("archived"));
    }
    Ok(query
        .all(conn)
        .await?
        .into_iter()
        .map(artifact_info)
        .collect())
}

pub async fn get(conn: &DatabaseConnection, id: &str) -> Result<DesignArtifactDetail, DbError> {
    let artifact = active_artifact(conn, id).await?;
    let revision = design_revision::Entity::find_by_id(artifact.current_revision_id.clone())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("design revision for artifact {id}")))?;
    Ok(DesignArtifactDetail {
        artifact: artifact_info(artifact),
        revision: revision_info(revision)?,
    })
}

pub async fn rename(
    conn: &DatabaseConnection,
    id: &str,
    name: &str,
) -> Result<DesignArtifactInfo, DbError> {
    if name.trim().is_empty() {
        return Err(DbError::Validation("design name is required".to_owned()));
    }
    let mut active = active_artifact(conn, id).await?.into_active_model();
    active.name = Set(name.trim().to_owned());
    active.updated_at = Set(Utc::now());
    Ok(artifact_info(active.update(conn).await?))
}

pub async fn duplicate(conn: &DatabaseConnection, id: &str) -> Result<DesignArtifactInfo, DbError> {
    let source = get(conn, id).await?;
    create(
        conn,
        CreateDesignArtifact {
            name: format!("{} 副本", source.artifact.name),
            kind: source.artifact.kind,
            project_folder_id: source.artifact.project_folder_id,
            document: source.revision.document,
        },
    )
    .await
}

pub async fn set_archived(
    conn: &DatabaseConnection,
    id: &str,
    archived: bool,
) -> Result<DesignArtifactInfo, DbError> {
    let mut active = active_artifact(conn, id).await?.into_active_model();
    active.status = Set(if archived { "archived" } else { "active" }.to_owned());
    active.updated_at = Set(Utc::now());
    Ok(artifact_info(active.update(conn).await?))
}

pub async fn soft_delete(conn: &DatabaseConnection, id: &str) -> Result<(), DbError> {
    let now = Utc::now();
    let mut active = active_artifact(conn, id).await?.into_active_model();
    active.deleted_at = Set(Some(now));
    active.updated_at = Set(now);
    active.update(conn).await?;
    Ok(())
}

pub async fn save_revision(
    conn: &DatabaseConnection,
    input: SaveDesignRevision,
) -> Result<DesignArtifactDetail, DbError> {
    validate_document(&input.document, input.schema_version)?;
    let transaction = conn.begin().await?;
    let artifact = design_artifact::Entity::find_by_id(input.artifact_id.clone())
        .filter(design_artifact::Column::DeletedAt.is_null())
        .one(&transaction)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("design artifact {}", input.artifact_id)))?;
    if artifact.current_revision_id != input.expected_revision_id {
        return Err(DbError::Conflict(format!(
            "design artifact {} has a newer revision",
            input.artifact_id
        )));
    }

    let current = design_revision::Entity::find_by_id(artifact.current_revision_id.clone())
        .one(&transaction)
        .await?
        .ok_or_else(|| DbError::NotFound("current design revision".to_owned()))?;
    let now = Utc::now();
    let revision_id = Uuid::new_v4().to_string();
    let revision = design_revision::ActiveModel {
        id: Set(revision_id.clone()),
        artifact_id: Set(artifact.id.clone()),
        parent_revision_id: Set(Some(current.id)),
        revision_number: Set(current.revision_number + 1),
        schema_version: Set(input.schema_version),
        document_json: Set(input.document.to_string()),
        created_at: Set(now),
    }
    .insert(&transaction)
    .await?;

    let mut active = artifact.into_active_model();
    active.current_revision_id = Set(revision_id);
    active.updated_at = Set(now);
    active.status = Set("active".to_owned());
    let updated = active.update(&transaction).await?;
    transaction.commit().await?;

    Ok(DesignArtifactDetail {
        artifact: artifact_info(updated),
        revision: revision_info(revision)?,
    })
}
