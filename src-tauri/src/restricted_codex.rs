use std::collections::BTreeMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use crate::acp::manager::ConnectionManager;
use crate::acp::types::{ConnectionStatus, PromptInputBlock};
use crate::commands::acp::{build_session_runtime_env, verify_agent_installed};
use crate::db::AppDatabase;
use crate::models::agent::AgentType;
use crate::web::event_bridge::EventEmitter;

const TRANSPORT_CLEANUP_DELAY: Duration = Duration::from_millis(250);

pub struct RestrictedCodexRequest {
    pub operation: String,
    pub instruction: String,
    pub timeout: Duration,
    pub cancellation: CancellationToken,
}

#[derive(Debug, thiserror::Error)]
pub enum RestrictedCodexError {
    #[error("restricted Codex request was cancelled")]
    Cancelled,
    #[error("restricted Codex request timed out")]
    TimedOut,
    #[error("{0}")]
    Failed(String),
}

struct PreparedRestrictedCodexEnvironment {
    _temp_dir: tempfile::TempDir,
    workspace: PathBuf,
    runtime_env: BTreeMap<String, String>,
}

impl PreparedRestrictedCodexEnvironment {
    fn workspace(&self) -> &Path {
        &self.workspace
    }

    fn runtime_env(&self) -> &BTreeMap<String, String> {
        &self.runtime_env
    }
}

fn operation_title(operation: &str) -> &str {
    match operation {
        "prompt-optimization" => "Prompt optimization",
        "conversation-relay-summary" => "Conversation relay summary",
        _ => "Restricted Codex request",
    }
}

fn operation_description(operation: &str) -> &str {
    match operation {
        "prompt-optimization" => "prompt optimization",
        "conversation-relay-summary" => "conversation relay summary",
        _ => "restricted Codex request",
    }
}

fn default_codex_home() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

fn codex_home_for_runtime(runtime_env: &BTreeMap<String, String>) -> PathBuf {
    match runtime_env.get("CODEX_HOME") {
        Some(value) if value.is_empty() => default_codex_home(),
        Some(value) => {
            let trimmed = value.trim();
            if trimmed == "~" {
                dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
            } else if let Some(relative) = trimmed.strip_prefix("~/") {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(relative)
            } else {
                PathBuf::from(value)
            }
        }
        None => crate::parsers::codex::resolve_codex_home_dir(),
    }
}

fn restricted_codex_config(
    source: Option<&str>,
    operation: &str,
) -> Result<String, RestrictedCodexError> {
    let source = match source {
        Some(raw) => raw.parse::<toml::Value>().map_err(|error| {
            RestrictedCodexError::Failed(format!(
                "Invalid Codex config for {}: {error}",
                operation_description(operation)
            ))
        })?,
        None => toml::Value::Table(toml::map::Map::new()),
    };
    let source = source.as_table().ok_or_else(|| {
        RestrictedCodexError::Failed(format!(
            "Invalid Codex config for {}: root must be a table",
            operation_description(operation)
        ))
    })?;
    let mut restricted = toml::map::Map::new();

    // Keep model selection and provider transport only. Tools, hooks, skills,
    // project trust and every other user capability stay outside this profile.
    for key in [
        "model",
        "model_provider",
        "model_reasoning_effort",
        "model_reasoning_summary",
        "model_verbosity",
        "service_tier",
        "personality",
        "preferred_auth_method",
        "chatgpt_base_url",
        "model_providers",
    ] {
        if let Some(value) = source.get(key) {
            restricted.insert(key.to_string(), value.clone());
        }
    }
    restricted.insert(
        "approval_policy".into(),
        toml::Value::String("never".into()),
    );
    restricted.insert(
        "sandbox_mode".into(),
        toml::Value::String("read-only".into()),
    );

    toml::to_string_pretty(&toml::Value::Table(restricted)).map_err(|error| {
        RestrictedCodexError::Failed(format!("Serialize restricted Codex config failed: {error}"))
    })
}

fn prepare_restricted_codex_home(
    source: &Path,
    target: &Path,
    operation: &str,
) -> Result<(), RestrictedCodexError> {
    std::fs::create_dir_all(target).map_err(|error| {
        RestrictedCodexError::Failed(format!("Create restricted Codex home failed: {error}"))
    })?;

    let source_config = match std::fs::read_to_string(source.join("config.toml")) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(RestrictedCodexError::Failed(format!(
                "Read Codex config for {} failed: {error}",
                operation_description(operation)
            )))
        }
    };
    let config = restricted_codex_config(source_config.as_deref(), operation)?;
    std::fs::write(target.join("config.toml"), config).map_err(|error| {
        RestrictedCodexError::Failed(format!("Write restricted Codex config failed: {error}"))
    })?;

    match std::fs::read(source.join("auth.json")) {
        Ok(auth) => std::fs::write(target.join("auth.json"), auth).map_err(|error| {
            RestrictedCodexError::Failed(format!("Copy Codex authentication failed: {error}"))
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(RestrictedCodexError::Failed(format!(
                "Read Codex authentication failed: {error}"
            )))
        }
    }
    Ok(())
}

fn prepare_restricted_codex_environment(
    mut runtime_env: BTreeMap<String, String>,
    operation: &str,
) -> Result<PreparedRestrictedCodexEnvironment, RestrictedCodexError> {
    let temp_dir = tempfile::Builder::new()
        .prefix(&format!("prooflane-{operation}-"))
        .tempdir()
        .map_err(|error| RestrictedCodexError::Failed(error.to_string()))?;
    let codex_home = temp_dir.path().join("codex-home");
    prepare_restricted_codex_home(
        &codex_home_for_runtime(&runtime_env),
        &codex_home,
        operation,
    )?;
    let workspace = temp_dir.path().join("workspace");
    std::fs::create_dir(&workspace)
        .map_err(|error| RestrictedCodexError::Failed(error.to_string()))?;
    runtime_env.insert(
        "CODEX_HOME".into(),
        codex_home.to_string_lossy().into_owned(),
    );
    // sacp-tokio removes empty values from the child environment, preventing
    // inherited adapter JSON from restoring MCP servers or user capabilities.
    runtime_env.insert("CODEX_CONFIG".into(), String::new());
    runtime_env.insert(
        crate::acp::connection::RESTRICTED_SESSION_ENV.into(),
        "1".into(),
    );

    Ok(PreparedRestrictedCodexEnvironment {
        _temp_dir: temp_dir,
        workspace,
        runtime_env,
    })
}

fn restricted_session_mode(
    operation: &str,
    selectors_ready: bool,
    current_mode: Option<&str>,
) -> Option<Result<(), RestrictedCodexError>> {
    if !selectors_ready {
        return None;
    }
    let title = operation_title(operation);
    Some(match current_mode {
        Some("read-only") => Ok(()),
        Some(_) => Err(RestrictedCodexError::Failed(format!(
            "{title} agent failed to enter read-only mode"
        ))),
        None => Err(RestrictedCodexError::Failed(format!(
            "{title} agent did not advertise read-only mode"
        ))),
    })
}

pub fn normalize_restricted_codex_output(operation: &str, raw: &str) -> String {
    let trimmed = raw.trim();
    if operation != "prompt-optimization"
        || !trimmed.starts_with("```")
        || !trimmed.ends_with("```")
    {
        return trimmed.to_string();
    }

    let without_open = trimmed
        .strip_prefix("```")
        .unwrap_or(trimmed)
        .trim_start_matches(|character| character != '\n' && character != '\r')
        .trim_start_matches(['\r', '\n']);
    without_open
        .strip_suffix("```")
        .unwrap_or(without_open)
        .trim()
        .to_string()
}

fn usable_assistant_output(operation: &str, raw: &str) -> Option<String> {
    let normalized = normalize_restricted_codex_output(operation, raw);
    (!normalized.is_empty()).then(|| raw.trim().to_string())
}

async fn await_with_cleanup<T, Run, Cleanup, CleanupFuture>(
    run: Run,
    timeout: Duration,
    cancellation: CancellationToken,
    cleanup: Cleanup,
    cleanup_delay: Duration,
) -> Result<T, RestrictedCodexError>
where
    Run: Future<Output = Result<T, RestrictedCodexError>>,
    Cleanup: FnOnce() -> CleanupFuture,
    CleanupFuture: Future<Output = ()>,
{
    let result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(RestrictedCodexError::Cancelled),
        result = tokio::time::timeout(timeout, run) => result
            .map_err(|_| RestrictedCodexError::TimedOut)
            .and_then(|result| result),
    };
    cleanup().await;
    tokio::time::sleep(cleanup_delay).await;
    result
}

pub async fn run_restricted_codex_once(
    manager: &ConnectionManager,
    db: &AppDatabase,
    data_dir: &Path,
    request: RestrictedCodexRequest,
) -> Result<String, RestrictedCodexError> {
    let RestrictedCodexRequest {
        operation,
        instruction,
        timeout,
        cancellation,
    } = request;
    let agent = AgentType::Codex;
    verify_agent_installed(agent)
        .await
        .map_err(|error| RestrictedCodexError::Failed(error.to_string()))?;
    let runtime_env = build_session_runtime_env(db, agent, None, data_dir)
        .await
        .map_err(|error| RestrictedCodexError::Failed(error.to_string()))?;
    if cancellation.is_cancelled() {
        return Err(RestrictedCodexError::Cancelled);
    }
    let prepared = prepare_restricted_codex_environment(runtime_env, &operation)?;
    let connection_id = manager
        .spawn_agent(
            agent,
            Some(prepared.workspace().to_string_lossy().into_owned()),
            None,
            prepared.runtime_env().clone(),
            operation.clone(),
            EventEmitter::Noop,
            Some("read-only".into()),
            BTreeMap::new(),
        )
        .await
        .map_err(|error| RestrictedCodexError::Failed(error.to_string()))?;
    let Some(state) = manager.get_state(&connection_id).await else {
        let _ = manager.disconnect(&connection_id).await;
        tokio::time::sleep(TRANSPORT_CLEANUP_DELAY).await;
        return Err(RestrictedCodexError::Failed(format!(
            "{} connection disappeared",
            operation_title(&operation)
        )));
    };
    let title = operation_title(&operation);
    let run = async {
        loop {
            let readiness = {
                let snapshot = state.read().await;
                if snapshot.status == ConnectionStatus::Error {
                    return Err(RestrictedCodexError::Failed(
                        snapshot
                            .last_error
                            .as_ref()
                            .map(|error| error.message.clone())
                            .unwrap_or_else(|| format!("{title} agent failed")),
                    ));
                }
                if snapshot.status == ConnectionStatus::Disconnected {
                    return Err(RestrictedCodexError::Failed(format!(
                        "{title} agent disconnected"
                    )));
                }
                restricted_session_mode(
                    &operation,
                    snapshot.selectors_ready,
                    snapshot.current_mode.as_deref(),
                )
            };
            if let Some(readiness) = readiness {
                readiness?;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        manager
            .send_prompt(
                &connection_id,
                vec![PromptInputBlock::Text { text: instruction }],
            )
            .await
            .map_err(|error| RestrictedCodexError::Failed(error.to_string()))?;

        loop {
            {
                let snapshot = state.read().await;
                if !snapshot.turn_in_flight {
                    if snapshot.status == ConnectionStatus::Error {
                        return Err(RestrictedCodexError::Failed(
                            snapshot
                                .last_error
                                .as_ref()
                                .map(|error| error.message.clone())
                                .unwrap_or_else(|| format!("{title} agent failed")),
                        ));
                    }
                    if snapshot.last_turn_ended_abnormally {
                        return Err(RestrictedCodexError::Failed(format!(
                            "{title} agent stopped before completing"
                        )));
                    }
                    if let Some(text) = snapshot
                        .last_assistant_text
                        .as_deref()
                        .and_then(|text| usable_assistant_output(&operation, text))
                    {
                        return Ok(text);
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };

    await_with_cleanup(
        run,
        timeout,
        cancellation,
        || async {
            let _ = manager.disconnect(&connection_id).await;
        },
        TRANSPORT_CLEANUP_DELAY,
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use tokio_util::sync::CancellationToken;

    use crate::commands::prompt_optimization::normalize_optimized_prompt;

    use super::{
        await_with_cleanup, prepare_restricted_codex_environment, restricted_codex_config,
        restricted_session_mode, usable_assistant_output, RestrictedCodexError,
    };

    #[test]
    fn restricted_config_keeps_credentials_and_allowlisted_transport_only() {
        let source = tempfile::tempdir().expect("source codex home");
        std::fs::write(
            source.path().join("auth.json"),
            r#"{"tokens":{"access_token":"secret"}}"#,
        )
        .expect("write auth");
        std::fs::write(
            source.path().join("config.toml"),
            r#"
model = "gpt-5"
model_provider = "custom"
model_reasoning_effort = "high"
notify = ["dangerous-command"]

[model_providers.custom]
name = "Custom"
base_url = "https://example.test/v1"
wire_api = "responses"

[mcp_servers.user-tool]
command = "dangerous-tool"

[projects."C:/repo"]
trust_level = "trusted"
"#,
        )
        .expect("write config");
        std::fs::create_dir(source.path().join("skills")).expect("create skills");

        let mut runtime_env = BTreeMap::new();
        runtime_env.insert(
            "CODEX_HOME".to_string(),
            source.path().to_string_lossy().into_owned(),
        );
        let prepared = prepare_restricted_codex_environment(runtime_env, "test-operation")
            .expect("prepare restricted environment");
        let isolated_home = PathBuf::from(
            prepared
                .runtime_env()
                .get("CODEX_HOME")
                .expect("isolated Codex home"),
        );

        assert_eq!(
            std::fs::read_to_string(isolated_home.join("auth.json")).expect("copied auth"),
            r#"{"tokens":{"access_token":"secret"}}"#
        );
        let config: toml::Value = std::fs::read_to_string(isolated_home.join("config.toml"))
            .expect("restricted config")
            .parse()
            .expect("valid restricted config");
        assert_eq!(
            config.get("model").and_then(toml::Value::as_str),
            Some("gpt-5")
        );
        assert!(config.get("model_providers").is_some());
        assert_eq!(
            config.get("approval_policy").and_then(toml::Value::as_str),
            Some("never")
        );
        assert_eq!(
            config.get("sandbox_mode").and_then(toml::Value::as_str),
            Some("read-only")
        );
        assert!(config.get("mcp_servers").is_none());
        assert!(config.get("notify").is_none());
        assert!(config.get("projects").is_none());
        assert!(!isolated_home.join("skills").exists());
    }

    #[test]
    fn restricted_environment_has_empty_workspace_and_closed_overrides() {
        let source = tempfile::tempdir().expect("source codex home");
        let mut runtime_env = BTreeMap::new();
        runtime_env.insert(
            "CODEX_HOME".to_string(),
            source.path().to_string_lossy().into_owned(),
        );
        let prepared = prepare_restricted_codex_environment(runtime_env, "summary")
            .expect("prepare restricted environment");

        assert_eq!(
            std::fs::read_dir(prepared.workspace())
                .expect("read isolated workspace")
                .count(),
            0
        );
        assert_eq!(
            prepared
                .runtime_env()
                .get("CODEX_CONFIG")
                .map(String::as_str),
            Some("")
        );
        assert_eq!(
            prepared
                .runtime_env()
                .get(crate::acp::connection::RESTRICTED_SESSION_ENV)
                .map(String::as_str),
            Some("1")
        );
        let isolated_home = Path::new(
            prepared
                .runtime_env()
                .get("CODEX_HOME")
                .expect("isolated Codex home"),
        );
        assert!(
            isolated_home.starts_with(prepared.workspace().parent().expect("restricted temp root"))
        );
        assert!(isolated_home.join("config.toml").is_file());

        let config = restricted_codex_config(None, "summary").expect("empty source config");
        assert!(config.contains("approval_policy = \"never\""));
        assert!(config.contains("sandbox_mode = \"read-only\""));
    }

    #[tokio::test]
    async fn timeout_runs_disconnect_cleanup() {
        let cleanup_count = Arc::new(AtomicUsize::new(0));
        let cleanup_count_for_call = cleanup_count.clone();

        let result: Result<(), RestrictedCodexError> = await_with_cleanup(
            std::future::pending(),
            Duration::from_millis(1),
            CancellationToken::new(),
            move || async move {
                cleanup_count_for_call.fetch_add(1, Ordering::SeqCst);
            },
            Duration::ZERO,
        )
        .await;

        assert!(matches!(result, Err(RestrictedCodexError::TimedOut)));
        assert_eq!(cleanup_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancellation_runs_disconnect_cleanup() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let cleanup_count = Arc::new(AtomicUsize::new(0));
        let cleanup_count_for_call = cleanup_count.clone();

        let result: Result<(), RestrictedCodexError> = await_with_cleanup(
            std::future::pending(),
            Duration::from_secs(60),
            cancellation,
            move || async move {
                cleanup_count_for_call.fetch_add(1, Ordering::SeqCst);
            },
            Duration::ZERO,
        )
        .await;

        assert!(matches!(result, Err(RestrictedCodexError::Cancelled)));
        assert_eq!(cleanup_count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn restricted_session_readiness_fails_closed_until_read_only_is_confirmed() {
        assert!(restricted_session_mode("prompt-optimization", false, None).is_none());
        assert!(matches!(
            restricted_session_mode("prompt-optimization", true, None),
            Some(Err(RestrictedCodexError::Failed(message)))
                if message == "Prompt optimization agent did not advertise read-only mode"
        ));
        assert!(matches!(
            restricted_session_mode("prompt-optimization", true, Some("agent")),
            Some(Err(RestrictedCodexError::Failed(message)))
                if message == "Prompt optimization agent failed to enter read-only mode"
        ));
        assert!(matches!(
            restricted_session_mode("prompt-optimization", true, Some("read-only")),
            Some(Ok(()))
        ));
    }

    #[test]
    fn prompt_optimization_output_rejects_an_empty_markdown_fence() {
        assert_eq!(
            usable_assistant_output("prompt-optimization", "```text\n\n```"),
            None
        );
        assert_eq!(
            usable_assistant_output("prompt-optimization", "```text\nresult\n```"),
            Some("```text\nresult\n```".into())
        );
        assert_eq!(
            usable_assistant_output("conversation-relay-summary", "{}"),
            Some("{}".into())
        );
    }

    #[test]
    fn prompt_optimization_pipeline_preserves_a_complete_inner_markdown_fence() {
        let runner_output = usable_assistant_output(
            "prompt-optimization",
            "```\n```rust\nfn main() {}\n```\n```",
        )
        .expect("outer fence contains usable prompt content");

        let final_prompt = normalize_optimized_prompt(&runner_output);

        assert_eq!(final_prompt, "```rust\nfn main() {}\n```");
    }
}
