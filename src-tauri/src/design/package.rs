#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::Builder;

const FORMAT_VERSION: u32 = 1;
const PACKAGE_DIRECTORIES: [&str; 5] = ["assets", "snapshots", "history", "previews", ""];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageManifest {
    pub format_version: u32,
    pub design_id: String,
    pub ast_sha256: String,
    pub asset_refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageReceipt {
    pub design_id: String,
    pub revision: String,
    pub ast_sha256: String,
    pub asset_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDesignPackage {
    pub manifest: PackageManifest,
    pub ast: Vec<u8>,
    pub receipt: PackageReceipt,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackageError {
    InvalidPath,
    UnsupportedFormat,
    InvalidHash,
    HashMismatch,
    InvalidAst,
    MissingEntry(String),
    AssetIndexMismatch,
    AtomicReplace(String),
    Io(String),
    Json(String),
}

impl From<std::io::Error> for PackageError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<serde_json::Error> for PackageError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error.to_string())
    }
}

fn validate_relative_asset(asset: &str) -> Result<(), PackageError> {
    if asset.is_empty() || asset.contains('\0') || asset.contains('\\') {
        return Err(PackageError::InvalidPath);
    }
    let path = Path::new(asset);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        || asset.contains(':')
    {
        return Err(PackageError::InvalidPath);
    }
    Ok(())
}

pub fn ast_sha256(ast: &[u8]) -> String {
    format!("{:x}", Sha256::digest(ast))
}

fn ast_revision(ast: &[u8]) -> Result<String, PackageError> {
    let value: Value = serde_json::from_slice(ast).map_err(|_| PackageError::InvalidAst)?;
    let object = value.as_object().ok_or(PackageError::InvalidAst)?;
    if object.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(PackageError::UnsupportedFormat);
    }
    let revision = object
        .get("revision")
        .and_then(Value::as_str)
        .filter(|revision| !revision.trim().is_empty())
        .ok_or(PackageError::InvalidAst)?;
    Ok(revision.to_string())
}

pub fn validate_manifest(manifest: &PackageManifest, ast: &[u8]) -> Result<(), PackageError> {
    if manifest.format_version != FORMAT_VERSION || manifest.design_id.trim().is_empty() {
        return Err(PackageError::UnsupportedFormat);
    }
    if manifest.ast_sha256.len() != 64
        || !manifest
            .ast_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(PackageError::InvalidHash);
    }
    if manifest.ast_sha256.to_ascii_lowercase() != ast_sha256(ast) {
        return Err(PackageError::HashMismatch);
    }
    for asset in &manifest.asset_refs {
        validate_relative_asset(asset)?;
    }
    ast_revision(ast).map(|_| ())
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), PackageError> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), PackageError> {
    File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), PackageError> {
    Ok(())
}

fn backup_name(path: &Path) -> Result<PathBuf, PackageError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(PackageError::InvalidPath)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| PackageError::AtomicReplace("clock before epoch".into()))?
        .as_nanos();
    Ok(path
        .parent()
        .ok_or(PackageError::InvalidPath)?
        .join(format!(".{name}.backup-{stamp}")))
}

pub fn save_package(
    path: &Path,
    manifest: &PackageManifest,
    ast: &[u8],
) -> Result<PackageReceipt, PackageError> {
    validate_manifest(manifest, ast)?;
    let parent = path.parent().ok_or(PackageError::InvalidPath)?;
    fs::create_dir_all(parent)?;
    let staging = Builder::new()
        .prefix(".proofdesign-staging-")
        .tempdir_in(parent)?;
    for directory in PACKAGE_DIRECTORIES {
        if !directory.is_empty() {
            fs::create_dir_all(staging.path().join(directory))?;
        }
    }
    write_synced(
        &staging.path().join("manifest.json"),
        &serde_json::to_vec_pretty(manifest)?,
    )?;
    write_synced(&staging.path().join("design.ast.json"), ast)?;
    write_synced(
        &staging.path().join("assets/index.json"),
        &serde_json::to_vec_pretty(&manifest.asset_refs)?,
    )?;
    sync_directory(&staging.path().join("assets"))?;
    sync_directory(staging.path())?;

    let staging_path = staging.path().to_path_buf();
    let backup = if path.exists() {
        let backup = backup_name(path)?;
        fs::rename(path, &backup)
            .map_err(|error| PackageError::AtomicReplace(error.to_string()))?;
        Some(backup)
    } else {
        None
    };
    if let Err(error) = fs::rename(&staging_path, path) {
        if let Some(backup) = &backup {
            let _ = fs::rename(backup, path);
        }
        return Err(PackageError::AtomicReplace(error.to_string()));
    }
    if let Some(backup) = backup {
        let _ = fs::remove_dir_all(backup);
    }
    let _ = sync_directory(parent);

    let revision = ast_revision(ast)?;
    Ok(PackageReceipt {
        design_id: manifest.design_id.clone(),
        revision,
        ast_sha256: ast_sha256(ast),
        asset_count: manifest.asset_refs.len(),
    })
}

pub fn load_package(path: &Path) -> Result<LoadedDesignPackage, PackageError> {
    if !path.is_dir() {
        return Err(PackageError::MissingEntry(path.display().to_string()));
    }
    for directory in PACKAGE_DIRECTORIES {
        let entry = if directory.is_empty() {
            path.to_path_buf()
        } else {
            path.join(directory)
        };
        if !entry.is_dir() {
            return Err(PackageError::MissingEntry(entry.display().to_string()));
        }
    }
    let manifest_path = path.join("manifest.json");
    let ast_path = path.join("design.ast.json");
    let manifest: PackageManifest = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|_| PackageError::MissingEntry(manifest_path.display().to_string()))?,
    )?;
    let ast = fs::read(&ast_path)
        .map_err(|_| PackageError::MissingEntry(ast_path.display().to_string()))?;
    validate_manifest(&manifest, &ast)?;
    let index: Vec<String> =
        serde_json::from_slice(&fs::read(path.join("assets/index.json")).map_err(|_| {
            PackageError::MissingEntry(path.join("assets/index.json").display().to_string())
        })?)?;
    if index != manifest.asset_refs {
        return Err(PackageError::AssetIndexMismatch);
    }
    let revision = ast_revision(&ast)?;
    let receipt = PackageReceipt {
        design_id: manifest.design_id.clone(),
        revision,
        ast_sha256: ast_sha256(&ast),
        asset_count: manifest.asset_refs.len(),
    };
    Ok(LoadedDesignPackage {
        manifest,
        ast,
        receipt,
    })
}

pub fn package_path(root: &Path, name: &str) -> PathBuf {
    root.join(name).with_extension("proofdesign")
}
