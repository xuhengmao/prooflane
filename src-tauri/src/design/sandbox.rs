use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SandboxError {
    NonLocalOrigin,
    PathEscape,
    CredentialAccessDenied,
    ArbitraryFileAccessDenied,
    NetworkAccessDenied,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewPolicy {
    pub artifact_root: PathBuf,
    pub asset_roots: Vec<PathBuf>,
    pub allow_credentials: bool,
    pub allow_arbitrary_files: bool,
    pub allow_network: bool,
}

pub fn validate_preview_origin(origin: &str) -> Result<(), SandboxError> {
    let allowed = [
        "http://127.0.0.1",
        "http://localhost",
        "https://127.0.0.1",
        "https://localhost",
        "tauri://localhost",
    ];
    if allowed
        .iter()
        .any(|prefix| origin == *prefix || origin.starts_with(&format!("{prefix}:")))
    {
        Ok(())
    } else {
        Err(SandboxError::NonLocalOrigin)
    }
}

pub fn build_preview_policy(root: &Path, asset_roots: &[PathBuf]) -> PreviewPolicy {
    PreviewPolicy {
        artifact_root: root.to_path_buf(),
        asset_roots: asset_roots.to_vec(),
        allow_credentials: false,
        allow_arbitrary_files: false,
        allow_network: false,
    }
}

pub fn validate_resource_path(
    policy: &PreviewPolicy,
    candidate: &Path,
) -> Result<PathBuf, SandboxError> {
    let canonical = candidate
        .canonicalize()
        .map_err(|_| SandboxError::PathEscape)?;
    let roots = std::iter::once(&policy.artifact_root).chain(policy.asset_roots.iter());
    if roots
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| canonical.starts_with(root))
    {
        Ok(canonical)
    } else {
        Err(SandboxError::PathEscape)
    }
}

pub fn deny_credential_access() -> Result<(), SandboxError> {
    Err(SandboxError::CredentialAccessDenied)
}

pub fn deny_arbitrary_file_access() -> Result<(), SandboxError> {
    Err(SandboxError::ArbitraryFileAccessDenied)
}

pub fn deny_network_access() -> Result<(), SandboxError> {
    Err(SandboxError::NetworkAccessDenied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_non_local_origins() {
        assert_eq!(
            validate_preview_origin("https://example.com"),
            Err(SandboxError::NonLocalOrigin)
        );
        assert!(validate_preview_origin("http://127.0.0.1:3000").is_ok());
    }

    #[test]
    fn restricts_paths_to_artifact_root() {
        let root = tempfile::tempdir().expect("temp root");
        let file = root.path().join("fixture.json");
        fs::write(&file, "{}").expect("fixture");
        let policy = build_preview_policy(root.path(), &[]);
        assert!(validate_resource_path(&policy, &file).is_ok());
        assert_eq!(
            validate_resource_path(&policy, Path::new("C:/Windows/win.ini")),
            Err(SandboxError::PathEscape)
        );
    }

    #[test]
    fn denies_sensitive_capabilities() {
        assert_eq!(
            deny_credential_access(),
            Err(SandboxError::CredentialAccessDenied)
        );
        assert_eq!(
            deny_arbitrary_file_access(),
            Err(SandboxError::ArbitraryFileAccessDenied)
        );
        assert_eq!(
            deny_network_access(),
            Err(SandboxError::NetworkAccessDenied)
        );
    }
}
