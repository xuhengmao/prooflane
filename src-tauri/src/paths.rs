//! Centralized resolution of codeg-owned filesystem paths.
//!
//! Mirrors the conventions already used by `preferences.rs` (`~/.codeg/`)
//! and `experts.rs` (`~/.codeg/skills/`). New features that need a
//! user-scoped persistent directory should call into this module instead of
//! re-deriving `dirs::home_dir().join(".codeg")` themselves.

use std::{
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
};

const CODEG_DIR_NAME: &str = ".codeg";
pub const PROOFLANE_DATA_DIR_NAME: &str = "prooflane";
pub const LEGACY_DESKTOP_DATA_DIR_NAME: &str = "io.github.xuhengmao.prooflane";
const PETS_DIR_NAME: &str = "pets";
const UPLOADS_DIR_NAME: &str = "uploads";
const LOGS_DIR_NAME: &str = "logs";
const TURN_TIMINGS_DIR_NAME: &str = "turn-timings";
const ACP_TRANSCRIPTS_DIR_NAME: &str = "acp-transcripts";
const BACKGROUNDS_DIR_NAME: &str = "backgrounds";

/// Replace Tauri's identifier-derived desktop data directory with the
/// Prooflane-branded sibling while leaving every other fallback untouched.
pub fn branded_desktop_data_dir(tauri_fallback: &Path) -> PathBuf {
    if tauri_fallback.file_name() == Some(OsStr::new(LEGACY_DESKTOP_DATA_DIR_NAME)) {
        return tauri_fallback.with_file_name(PROOFLANE_DATA_DIR_NAME);
    }
    tauri_fallback.to_path_buf()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataDirMigrationOutcome {
    NotApplicable,
    LegacyDirectoryMissing,
    Migrated,
    MigratedReplacingEmptyTarget,
    SkippedTargetNotEmpty,
}

/// Atomically move Tauri's legacy identifier-derived directory to the
/// Prooflane-branded sibling. Existing non-empty targets are never modified.
pub fn migrate_legacy_desktop_data_dir(
    tauri_fallback: &Path,
) -> io::Result<DataDirMigrationOutcome> {
    let branded_data_dir = branded_desktop_data_dir(tauri_fallback);
    if branded_data_dir == tauri_fallback {
        return Ok(DataDirMigrationOutcome::NotApplicable);
    }

    let legacy_exists = tauri_fallback.try_exists().map_err(|error| {
        migration_io_error("inspect legacy data directory", tauri_fallback, error)
    })?;
    if !legacy_exists {
        return Ok(DataDirMigrationOutcome::LegacyDirectoryMissing);
    }

    let target_exists = branded_data_dir.try_exists().map_err(|error| {
        migration_io_error("inspect branded data directory", &branded_data_dir, error)
    })?;
    let mut replaced_empty_target = false;
    if target_exists {
        let target_metadata = fs::symlink_metadata(&branded_data_dir).map_err(|error| {
            migration_io_error("inspect branded data directory", &branded_data_dir, error)
        })?;
        if !target_metadata.file_type().is_dir() {
            return Ok(DataDirMigrationOutcome::SkippedTargetNotEmpty);
        }

        let mut entries = fs::read_dir(&branded_data_dir).map_err(|error| {
            migration_io_error("read branded data directory", &branded_data_dir, error)
        })?;
        if let Some(entry) = entries.next() {
            entry.map_err(|error| {
                migration_io_error("read branded data directory", &branded_data_dir, error)
            })?;
            return Ok(DataDirMigrationOutcome::SkippedTargetNotEmpty);
        }

        fs::remove_dir(&branded_data_dir).map_err(|error| {
            migration_io_error(
                "remove empty branded data directory",
                &branded_data_dir,
                error,
            )
        })?;
        replaced_empty_target = true;
    }

    fs::rename(tauri_fallback, &branded_data_dir).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "failed to migrate legacy data directory from {} to {}: {error}",
                tauri_fallback.display(),
                branded_data_dir.display()
            ),
        )
    })?;

    Ok(if replaced_empty_target {
        DataDirMigrationOutcome::MigratedReplacingEmptyTarget
    } else {
        DataDirMigrationOutcome::Migrated
    })
}

fn migration_io_error(operation: &str, path: &Path, error: io::Error) -> io::Error {
    io::Error::new(
        error.kind(),
        format!("failed to {operation} at {}: {error}", path.display()),
    )
}

/// `$CODEG_HOME` if set (and non-empty), else `~/.codeg/`.
///
/// Returns the relative `.codeg` path when no home directory is available;
/// callers must still handle creation failures gracefully.
pub fn codeg_home_dir() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom);
    }
    dirs::home_dir()
        .map(|h| h.join(CODEG_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(CODEG_DIR_NAME))
}

/// Root directory for desktop-pet assets.
///
/// Resolution order:
/// 1. `$CODEG_HOME/pets` (explicit override, used in tests and custom installs)
/// 2. `$CODEG_DATA_DIR/pets` (server-mode data directory, populated by
///    `codeg-server` from the corresponding env var)
/// 3. `~/.codeg/pets` (default for the desktop app)
pub fn codeg_pets_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(PETS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("CODEG_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(PETS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(CODEG_DIR_NAME).join(PETS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(CODEG_DIR_NAME).join(PETS_DIR_NAME))
}

/// Root directory for attachments uploaded from the web client.
///
/// Resolution order matches `codeg_pets_root()`:
/// 1. `$CODEG_HOME/uploads`
/// 2. `$CODEG_DATA_DIR/uploads` (server-mode data directory)
/// 3. `~/.codeg/uploads` (desktop default)
///
/// Files in this directory are not garbage-collected by codeg itself —
/// later conversations may still reference them via `file://` URIs
/// embedded in session history. To bound the long-term footprint on
/// shared / multi-tenant servers, operators can set
/// `CODEG_UPLOAD_MAX_TOTAL_BYTES` (see `web::handlers::files`): new
/// uploads beyond the cap are rejected at the API boundary while
/// existing files stay readable.
///
/// **Concurrency contract:** the quota check uses a process-local
/// in-flight reservation counter to make `CODEG_UPLOAD_MAX_TOTAL_BYTES`
/// a hard ceiling within one `codeg-server` process. Multiple
/// `codeg-server` processes sharing the same uploads root (e.g.
/// horizontally-scaled containers mounted on the same volume) will
/// each enforce the cap independently and can collectively exceed it.
/// codeg is designed for single-process deployments; horizontal
/// scaling would require external coordination (file lock, Redis,
/// reverse-proxy quota) that this codebase does not provide.
pub fn codeg_uploads_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(UPLOADS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("CODEG_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(UPLOADS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(CODEG_DIR_NAME).join(UPLOADS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(CODEG_DIR_NAME).join(UPLOADS_DIR_NAME))
}

/// Root directory for the user-selected workspace background image.
///
/// Resolution mirrors [`codeg_pets_root`] exactly:
/// 1. `$CODEG_HOME/backgrounds` (explicit override)
/// 2. `$CODEG_DATA_DIR/backgrounds` (server-mode data directory)
/// 3. `~/.codeg/backgrounds` (desktop default)
pub fn codeg_backgrounds_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(BACKGROUNDS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("CODEG_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(BACKGROUNDS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(CODEG_DIR_NAME).join(BACKGROUNDS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(CODEG_DIR_NAME).join(BACKGROUNDS_DIR_NAME))
}

/// Root directory for application diagnostic logs (rotating files written by
/// the `tracing` file appender; see `crate::logging`).
///
/// Resolution mirrors [`codeg_uploads_root`] exactly so logs land on the same
/// filesystem root as uploads/pets/the database:
/// 1. `$CODEG_HOME/logs` (explicit override)
/// 2. `$CODEG_DATA_DIR/logs` (server-mode data directory)
/// 3. `~/.codeg/logs` (default for the desktop app)
///
/// Pure env + `dirs::home_dir()`, so it is callable at the very start of a
/// process — before the database (or, in `codeg-server`, the tokio runtime)
/// exists — which is exactly when the subscriber must be installed.
pub fn codeg_logs_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(LOGS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("CODEG_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(LOGS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(CODEG_DIR_NAME).join(LOGS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(CODEG_DIR_NAME).join(LOGS_DIR_NAME))
}

/// Root directory for codeg's own per-turn timing observations (see
/// `crate::turn_timings`) — wall-clock turn spans the ACP connection layer
/// records for agents whose native session store carries no per-turn
/// timestamps (Cursor). Written by the live connection, read back by the
/// history parser.
///
/// Resolution mirrors [`codeg_uploads_root`]:
/// 1. `$CODEG_HOME/turn-timings`
/// 2. `$CODEG_DATA_DIR/turn-timings` (server-mode data directory)
/// 3. `~/.codeg/turn-timings` (desktop default)
pub fn codeg_turn_timings_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(TURN_TIMINGS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("CODEG_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(TURN_TIMINGS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(CODEG_DIR_NAME).join(TURN_TIMINGS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(CODEG_DIR_NAME).join(TURN_TIMINGS_DIR_NAME))
}

/// Root directory for codeg's own ACP transcripts (see
/// `crate::acp_transcript`) — the raw `session/update` stream and outgoing
/// prompts recorded for **custom ACP agents**, which have no codeg-side
/// transcript parser of their own. Written by the live connection, read back
/// by `crate::parsers::acp_native`.
///
/// Resolution mirrors [`codeg_turn_timings_root`]:
/// 1. `$CODEG_HOME/acp-transcripts`
/// 2. `$CODEG_DATA_DIR/acp-transcripts` (server-mode data directory)
/// 3. `~/.codeg/acp-transcripts` (desktop default)
pub fn codeg_acp_transcripts_root() -> PathBuf {
    if let Some(custom) = std::env::var_os("CODEG_HOME").filter(|s| !s.is_empty()) {
        return PathBuf::from(custom).join(ACP_TRANSCRIPTS_DIR_NAME);
    }
    if let Some(data) = std::env::var_os("CODEG_DATA_DIR").filter(|s| !s.is_empty()) {
        return PathBuf::from(data).join(ACP_TRANSCRIPTS_DIR_NAME);
    }
    dirs::home_dir()
        .map(|h| h.join(CODEG_DIR_NAME).join(ACP_TRANSCRIPTS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(CODEG_DIR_NAME).join(ACP_TRANSCRIPTS_DIR_NAME))
}

/// Single source of truth for "where does the database live, and where
/// do `paths::*` resolve their roots against."
///
/// Resolution:
/// 1. If `CODEG_DATA_DIR` is set and non-empty, return its absolutized
///    form. Honors the operator's choice even on desktop, where a
///    pre-set env var should override Tauri's identifier-derived path.
/// 2. Otherwise map Tauri's legacy identifier-derived desktop directory to
///    the Prooflane-branded sibling, then return its absolutized form. Every
///    other fallback (including the server's default data dir) is unchanged.
///
/// Always returns an absolute path (`absolutize` re-bases against the
/// process CWD if needed). Callers should treat the result as
/// authoritative and not re-read `CODEG_DATA_DIR` themselves; the
/// startup code in `lib.rs` / `bin/codeg_server.rs` writes the
/// resolved value back to the env so subprocess inheritance works,
/// but the in-process source of truth is this function.
///
/// This exists because Tauri's `app.path().app_data_dir()` does **not**
/// consult `CODEG_DATA_DIR` — it returns the identifier-derived path
/// unconditionally. Call sites that pass `app_data_dir()` straight
/// into git credential helpers, ACP, terminal sessions, etc. would
/// otherwise generate scripts pointing at an empty DB when the
/// operator pre-set `CODEG_DATA_DIR` to a custom location.
pub fn resolve_effective_data_dir(tauri_fallback: &Path) -> PathBuf {
    let custom = std::env::var_os("CODEG_DATA_DIR").filter(|value| !value.is_empty());
    resolve_effective_data_dir_with_override(tauri_fallback, custom.as_deref())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedDesktopDataDir {
    pub effective_data_dir: PathBuf,
    pub migration_outcome: Option<DataDirMigrationOutcome>,
}

/// Resolve the desktop data root and, when no explicit override is present,
/// migrate the legacy identifier-derived directory before database startup.
pub fn prepare_desktop_data_dir(
    tauri_fallback: &Path,
    custom: Option<&OsStr>,
) -> io::Result<PreparedDesktopDataDir> {
    let effective_data_dir = resolve_effective_data_dir_with_override(tauri_fallback, custom);
    let migration_outcome = if custom.is_some() {
        None
    } else {
        Some(migrate_legacy_desktop_data_dir(tauri_fallback)?)
    };

    Ok(PreparedDesktopDataDir {
        effective_data_dir,
        migration_outcome,
    })
}

fn resolve_effective_data_dir_with_override(
    tauri_fallback: &Path,
    custom: Option<&OsStr>,
) -> PathBuf {
    if let Some(custom) = custom {
        return crate::git_credential::absolutize(Path::new(custom));
    }
    crate::git_credential::absolutize(&branded_desktop_data_dir(tauri_fallback))
}

/// Drop the Windows extended-length ("verbatim") prefix from a path, so the
/// plain form is what leaves this process.
///
/// `fs::canonicalize` on Windows resolves through `GetFinalPathNameByHandleW`
/// and **always** returns the verbatim form — `\\?\C:\…`, or `\\?\UNC\server\
/// share\…` for a network share. That is the right thing to keep feeding back
/// into Rust filesystem calls, but it must not escape into a value some other
/// layer parses: the frontend's `buildFileUri` normalizes `\` to `/`, which
/// turns `\\?\C:\…` into `//?/C:/…` and trips its UNC-authority branch,
/// yielding a uri that decodes back to the bogus path `?/C:/…` (issue #392).
/// Callers that hand a canonical path to a client should route it through
/// here first; the canonical value itself stays in use for jail checks.
///
/// Only the two prefixes with a plain equivalent are rewritten. `\\?\Volume{…}`
/// and other device paths have none, so they pass through untouched — as does
/// every path that never had a verbatim prefix, which on Unix is all of them
/// (the prefix is not valid syntax there, and an upload path cannot acquire
/// one: `sanitize_upload_filename` strips backslashes and the bucket name is
/// alphanumeric). Non-UTF-8 paths are returned as-is rather than risk a lossy
/// rewrite.
pub fn simplify_verbatim_path(path: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path.to_path_buf();
    };
    if let Some(rest) = strip_prefix_ignore_ascii_case(text, r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        let bytes = rest.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

/// `str::strip_prefix` with an ASCII-case-insensitive comparison. Windows
/// accepts `\\?\unc\` as readily as `\\?\UNC\`, and the casing a path picked
/// up is not ours to predict.
fn strip_prefix_ignore_ascii_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

// Environment-reading wrappers above still depend on process-global state.
// Their path decisions are exercised through pure helpers so these tests can
// run in parallel without mutating `CODEG_HOME` or `CODEG_DATA_DIR`.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_legacy_desktop_data_dir_to_branded_sibling() {
        let fallback = PathBuf::from("app-data").join("io.github.xuhengmao.prooflane");

        assert_eq!(
            branded_desktop_data_dir(&fallback),
            PathBuf::from("app-data").join("prooflane")
        );
    }

    #[test]
    fn leaves_non_legacy_desktop_data_dir_unchanged() {
        let fallback = PathBuf::from("app-data").join("custom-prooflane-data");

        assert_eq!(branded_desktop_data_dir(&fallback), fallback);
    }

    #[test]
    fn migrates_the_complete_legacy_desktop_data_directory() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);
        let branded = temp.path().join(PROOFLANE_DATA_DIR_NAME);
        std::fs::create_dir_all(legacy.join("chat-sessions").join("session-1")).unwrap();
        std::fs::write(legacy.join("codeg.db"), b"database").unwrap();
        std::fs::write(
            legacy
                .join("chat-sessions")
                .join("session-1")
                .join("messages.json"),
            b"session",
        )
        .unwrap();

        let outcome = migrate_legacy_desktop_data_dir(&legacy).unwrap();

        assert_eq!(outcome, DataDirMigrationOutcome::Migrated);
        assert!(!legacy.exists());
        assert_eq!(
            std::fs::read(branded.join("codeg.db")).unwrap(),
            b"database"
        );
        assert_eq!(
            std::fs::read(
                branded
                    .join("chat-sessions")
                    .join("session-1")
                    .join("messages.json")
            )
            .unwrap(),
            b"session"
        );
    }

    #[test]
    fn replaces_an_empty_branded_directory_during_migration() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);
        let branded = temp.path().join(PROOFLANE_DATA_DIR_NAME);
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("codeg.db"), b"database").unwrap();
        std::fs::create_dir(&branded).unwrap();

        let outcome = migrate_legacy_desktop_data_dir(&legacy).unwrap();

        assert_eq!(
            outcome,
            DataDirMigrationOutcome::MigratedReplacingEmptyTarget
        );
        assert!(!legacy.exists());
        assert_eq!(
            std::fs::read(branded.join("codeg.db")).unwrap(),
            b"database"
        );
    }

    #[test]
    fn preserves_both_directories_when_the_branded_directory_is_not_empty() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);
        let branded = temp.path().join(PROOFLANE_DATA_DIR_NAME);
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("legacy.db"), b"legacy").unwrap();
        std::fs::create_dir(&branded).unwrap();
        std::fs::write(branded.join("current.db"), b"current").unwrap();

        let outcome = migrate_legacy_desktop_data_dir(&legacy).unwrap();

        assert_eq!(outcome, DataDirMigrationOutcome::SkippedTargetNotEmpty);
        assert_eq!(std::fs::read(legacy.join("legacy.db")).unwrap(), b"legacy");
        assert_eq!(
            std::fs::read(branded.join("current.db")).unwrap(),
            b"current"
        );
    }

    #[test]
    fn does_not_create_a_branded_directory_when_legacy_data_is_missing() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);
        let branded = temp.path().join(PROOFLANE_DATA_DIR_NAME);

        let outcome = migrate_legacy_desktop_data_dir(&legacy).unwrap();

        assert_eq!(outcome, DataDirMigrationOutcome::LegacyDirectoryMissing);
        assert!(!branded.exists());
    }

    #[test]
    fn does_not_migrate_a_non_legacy_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let fallback = temp.path().join("custom-prooflane-data");
        std::fs::create_dir(&fallback).unwrap();
        std::fs::write(fallback.join("current.db"), b"current").unwrap();

        let outcome = migrate_legacy_desktop_data_dir(&fallback).unwrap();

        assert_eq!(outcome, DataDirMigrationOutcome::NotApplicable);
        assert_eq!(
            std::fs::read(fallback.join("current.db")).unwrap(),
            b"current"
        );
        assert!(!temp.path().join(PROOFLANE_DATA_DIR_NAME).exists());
    }

    #[test]
    fn explicit_data_dir_override_wins_over_the_branded_default() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);
        let custom = temp.path().join("operator-data");

        assert_eq!(
            resolve_effective_data_dir_with_override(&legacy, Some(custom.as_os_str())),
            custom
        );
    }

    #[test]
    fn resolves_the_branded_desktop_data_dir_without_an_override() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);

        assert_eq!(
            resolve_effective_data_dir_with_override(&legacy, None),
            temp.path().join(PROOFLANE_DATA_DIR_NAME)
        );
    }

    #[test]
    fn prepares_and_migrates_the_branded_directory_without_an_override() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);
        let branded = temp.path().join(PROOFLANE_DATA_DIR_NAME);
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("codeg.db"), b"database").unwrap();

        let prepared = prepare_desktop_data_dir(&legacy, None).unwrap();

        assert_eq!(prepared.effective_data_dir, branded);
        assert_eq!(
            prepared.migration_outcome,
            Some(DataDirMigrationOutcome::Migrated)
        );
        assert!(!legacy.exists());
        assert_eq!(
            std::fs::read(prepared.effective_data_dir.join("codeg.db")).unwrap(),
            b"database"
        );
    }

    #[test]
    fn explicit_override_prepares_custom_dir_without_migrating_legacy_data() {
        let temp = tempfile::tempdir().unwrap();
        let legacy = temp.path().join(LEGACY_DESKTOP_DATA_DIR_NAME);
        let branded = temp.path().join(PROOFLANE_DATA_DIR_NAME);
        let custom = temp.path().join("operator-data");
        std::fs::create_dir(&legacy).unwrap();
        std::fs::write(legacy.join("codeg.db"), b"database").unwrap();

        let prepared = prepare_desktop_data_dir(&legacy, Some(custom.as_os_str())).unwrap();

        assert_eq!(prepared.effective_data_dir, custom);
        assert_eq!(prepared.migration_outcome, None);
        assert_eq!(std::fs::read(legacy.join("codeg.db")).unwrap(), b"database");
        assert!(!branded.exists());
    }

    /// The shape `fs::canonicalize` hands back on Windows, and the one that
    /// broke image attachments in issue #392.
    #[test]
    fn simplifies_a_verbatim_drive_path() {
        assert_eq!(
            simplify_verbatim_path(Path::new(r"\\?\C:\Users\song\.codeg\uploads\b\img.png")),
            PathBuf::from(r"C:\Users\song\.codeg\uploads\b\img.png")
        );
    }

    #[test]
    fn simplifies_a_verbatim_unc_path_in_either_casing() {
        assert_eq!(
            simplify_verbatim_path(Path::new(r"\\?\UNC\srv\share\img.png")),
            PathBuf::from(r"\\srv\share\img.png")
        );
        assert_eq!(
            simplify_verbatim_path(Path::new(r"\\?\unc\srv\share\img.png")),
            PathBuf::from(r"\\srv\share\img.png")
        );
    }

    /// Everything without a rewritable prefix must come back byte-identical —
    /// this is what keeps the Linux/macOS/Docker upload response unchanged.
    #[test]
    fn leaves_every_other_shape_untouched() {
        for path in [
            "/home/u/.codeg/uploads/b/img.png",
            "/data/uploads/b/img.png",
            r"C:\Users\song\img.png",
            r"\\srv\share\img.png",
            r"\\?\Volume{7b2f1c40-0000-0000-0000-100000000000}\img.png",
            "relative/path.png",
        ] {
            assert_eq!(
                simplify_verbatim_path(Path::new(path)),
                PathBuf::from(path),
                "rewrote a path that has no verbatim prefix: {path}"
            );
        }
    }
}
