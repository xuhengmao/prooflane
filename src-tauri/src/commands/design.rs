#[cfg(debug_assertions)]
use std::path::Path;

#[cfg(debug_assertions)]
use crate::design::package::{
    load_package, save_package, LoadedDesignPackage, PackageError, PackageManifest, PackageReceipt,
};

use crate::db::error::DbError;
use crate::models::CreateDesignArtifact;

#[cfg(feature = "tauri-runtime")]
use crate::db::service::design_artifact_service;
#[cfg(feature = "tauri-runtime")]
use crate::db::AppDatabase;
#[cfg(feature = "tauri-runtime")]
use crate::models::{DesignArtifactDetail, DesignArtifactInfo, SaveDesignRevision};

const DESIGN_NAME_MAX_CHARS: usize = 120;
const DESIGN_KINDS: &[&str] = &[
    "page",
    "component",
    "image",
    "icon",
    "design_system",
    "flow",
];

pub fn validate_design_name(name: &str) -> Result<(), DbError> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err(DbError::Validation("design name is required".to_owned()));
    }
    if normalized.chars().count() > DESIGN_NAME_MAX_CHARS {
        return Err(DbError::Validation(format!(
            "design name must not exceed {DESIGN_NAME_MAX_CHARS} characters"
        )));
    }
    Ok(())
}

pub fn validate_create_input(input: &CreateDesignArtifact) -> Result<(), DbError> {
    validate_design_name(&input.name)?;
    if !DESIGN_KINDS.contains(&input.kind.as_str()) {
        return Err(DbError::Validation(format!(
            "unsupported design kind: {}",
            input.kind
        )));
    }
    if input
        .document
        .get("schemaVersion")
        .and_then(|value| value.as_i64())
        != Some(1)
    {
        return Err(DbError::Validation(
            "initial document schemaVersion must be 1".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(debug_assertions)]
#[allow(dead_code)]
pub fn save_design_package(
    path: &Path,
    manifest: &PackageManifest,
    ast: &[u8],
) -> Result<PackageReceipt, PackageError> {
    save_package(path, manifest, ast)
}

#[cfg(debug_assertions)]
#[allow(dead_code)]
pub fn load_design_package(path: &Path) -> Result<LoadedDesignPackage, PackageError> {
    load_package(path)
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn list_design_artifacts(
    db: tauri::State<'_, AppDatabase>,
    include_archived: bool,
) -> Result<Vec<DesignArtifactInfo>, DbError> {
    design_artifact_service::list(&db.conn, include_archived).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn get_design_artifact(
    db: tauri::State<'_, AppDatabase>,
    id: String,
) -> Result<DesignArtifactDetail, DbError> {
    design_artifact_service::get(&db.conn, &id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn create_design_artifact(
    db: tauri::State<'_, AppDatabase>,
    input: CreateDesignArtifact,
) -> Result<DesignArtifactInfo, DbError> {
    validate_create_input(&input)?;
    design_artifact_service::create(&db.conn, input).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn rename_design_artifact(
    db: tauri::State<'_, AppDatabase>,
    id: String,
    name: String,
) -> Result<DesignArtifactInfo, DbError> {
    validate_design_name(&name)?;
    design_artifact_service::rename(&db.conn, &id, &name).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn duplicate_design_artifact(
    db: tauri::State<'_, AppDatabase>,
    id: String,
) -> Result<DesignArtifactInfo, DbError> {
    design_artifact_service::duplicate(&db.conn, &id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn set_design_artifact_archived(
    db: tauri::State<'_, AppDatabase>,
    id: String,
    archived: bool,
) -> Result<DesignArtifactInfo, DbError> {
    design_artifact_service::set_archived(&db.conn, &id, archived).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn delete_design_artifact(
    db: tauri::State<'_, AppDatabase>,
    id: String,
) -> Result<(), DbError> {
    design_artifact_service::soft_delete(&db.conn, &id).await
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn save_design_revision(
    db: tauri::State<'_, AppDatabase>,
    input: SaveDesignRevision,
) -> Result<DesignArtifactDetail, DbError> {
    design_artifact_service::save_revision(&db.conn, input).await
}
