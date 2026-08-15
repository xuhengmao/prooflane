use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelayScopeType {
    Summary,
    RecentRounds,
    CustomRounds,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayScopeSelection {
    pub scope_type: RelayScopeType,
    pub selected_round_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayToolFact {
    pub tool_use_id: Option<String>,
    pub name: String,
    pub input: String,
    pub output: Option<String>,
    pub is_error: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayFileReference {
    pub path: String,
    pub mime_type: Option<String>,
    pub source_message_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayRound {
    pub id: String,
    pub user_text: String,
    pub assistant_text: String,
    pub tools: Vec<RelayToolFact>,
    pub files: Vec<RelayFileReference>,
    pub source_message_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayStats {
    pub message_count: u32,
    pub file_count: u32,
    pub todo_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySummary {
    pub goals: Vec<String>,
    pub decisions: Vec<String>,
    pub progress: Vec<String>,
    pub todos: Vec<String>,
    pub constraints: Vec<String>,
    pub files: Vec<String>,
    pub open_questions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySnapshotSource {
    pub conversation_id: i32,
    pub folder_id: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelaySnapshot {
    pub version: u32,
    pub source: RelaySnapshotSource,
    pub scope: RelayScopeSelection,
    pub available_rounds: Vec<RelayRound>,
    pub included_rounds: Vec<RelayRound>,
    pub summary: Option<RelaySummary>,
    pub files: Vec<RelayFileReference>,
    pub stats: RelayStats,
    pub canonical_context: String,
}

/// API response shape for an attached or consumed relay context pack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayContextPackView {
    pub id: i32,
    pub target_draft_id: String,
    pub target_conversation_id: Option<i32>,
    pub source_conversation_id: i32,
    pub source_folder_id: i32,
    pub scope: RelayScopeSelection,
    pub snapshot: RelaySnapshot,
    pub source_fingerprint: String,
    pub estimated_tokens: u32,
    pub context_window_tokens: Option<u32>,
    pub allowed_tokens: u32,
    pub status: String,
    pub invalid_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub consumed_at: Option<DateTime<Utc>>,
}

/// Minimal source record shown after a relay pack has been consumed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayProvenanceView {
    pub relay_id: i32,
    pub source_conversation_id: i32,
    pub source_folder_id: i32,
    pub scope: RelayScopeSelection,
    pub selected_round_ids: Vec<String>,
    pub consumed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelayErrorCode {
    RelayDisabled,
    RelaySourceNotFound,
    RelaySourceUnavailable,
    RelayRoundsChanged,
    RelayScopeEmpty,
    RelayBudgetExceeded,
    RelaySummaryUnavailable,
    RelaySummaryInvalid,
    RelaySummaryInputTooLarge,
    RelayModelChanged,
    RelayConsumeConflict,
    RelaySendUncertain,
    RelayImmutableSnapshot,
}

impl std::fmt::Display for RelayErrorCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let value = match self {
            Self::RelayDisabled => "relay_disabled",
            Self::RelaySourceNotFound => "relay_source_not_found",
            Self::RelaySourceUnavailable => "relay_source_unavailable",
            Self::RelayRoundsChanged => "relay_rounds_changed",
            Self::RelayScopeEmpty => "relay_scope_empty",
            Self::RelayBudgetExceeded => "relay_budget_exceeded",
            Self::RelaySummaryUnavailable => "relay_summary_unavailable",
            Self::RelaySummaryInvalid => "relay_summary_invalid",
            Self::RelaySummaryInputTooLarge => "relay_summary_input_too_large",
            Self::RelayModelChanged => "relay_model_changed",
            Self::RelayConsumeConflict => "relay_consume_conflict",
            Self::RelaySendUncertain => "relay_send_uncertain",
            Self::RelayImmutableSnapshot => "relay_immutable_snapshot",
        };
        formatter.write_str(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{code}")]
pub struct RelayError {
    pub code: RelayErrorCode,
}

impl RelayError {
    pub const fn new(code: RelayErrorCode) -> Self {
        Self { code }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_error_codes_serialize_to_stable_wire_values() {
        let cases = [
            (RelayErrorCode::RelayDisabled, "relay_disabled"),
            (
                RelayErrorCode::RelaySourceNotFound,
                "relay_source_not_found",
            ),
            (
                RelayErrorCode::RelaySourceUnavailable,
                "relay_source_unavailable",
            ),
            (RelayErrorCode::RelayRoundsChanged, "relay_rounds_changed"),
            (RelayErrorCode::RelayScopeEmpty, "relay_scope_empty"),
            (RelayErrorCode::RelayBudgetExceeded, "relay_budget_exceeded"),
            (
                RelayErrorCode::RelaySummaryUnavailable,
                "relay_summary_unavailable",
            ),
            (RelayErrorCode::RelaySummaryInvalid, "relay_summary_invalid"),
            (
                RelayErrorCode::RelaySummaryInputTooLarge,
                "relay_summary_input_too_large",
            ),
            (RelayErrorCode::RelayModelChanged, "relay_model_changed"),
            (
                RelayErrorCode::RelayConsumeConflict,
                "relay_consume_conflict",
            ),
            (RelayErrorCode::RelaySendUncertain, "relay_send_uncertain"),
            (
                RelayErrorCode::RelayImmutableSnapshot,
                "relay_immutable_snapshot",
            ),
        ];

        for (code, wire_value) in cases {
            assert_eq!(
                serde_json::to_string(&code).unwrap(),
                format!("\"{wire_value}\"")
            );
            assert_eq!(code.to_string(), wire_value);
        }
    }
}
