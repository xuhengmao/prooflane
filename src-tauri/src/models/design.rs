use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDesignArtifact {
    pub name: String,
    pub kind: String,
    pub project_folder_id: Option<i32>,
    pub document: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDesignRevision {
    pub artifact_id: String,
    pub expected_revision_id: String,
    pub schema_version: i32,
    pub document: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignArtifactInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub current_revision_id: String,
    pub project_folder_id: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignRevisionInfo {
    pub id: String,
    pub artifact_id: String,
    pub parent_revision_id: Option<String>,
    pub revision_number: i32,
    pub schema_version: i32,
    pub document: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignArtifactDetail {
    pub artifact: DesignArtifactInfo,
    pub revision: DesignRevisionInfo,
}
