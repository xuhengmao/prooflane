use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::models::{
    ContentBlock, MessageTurn, RelayError, RelayErrorCode, RelayFileReference, RelayRound,
    RelayScopeSelection, RelayToolFact, TurnRole,
};

const MAX_TOOL_PREVIEW_CHARS: usize = 1_000;

static FILE_PATH_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?x)
        (?:
            [A-Za-z]:[\\/][^\s\"'`<>|]+ |
            /[^\s\"'`<>|]+ |
            (?:\.?\.?[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+ |
            \b[A-Za-z0-9_-]+\.(?:rs|md|toml|json|yaml|yml|ts|tsx|js|jsx|py|go|java|txt)\b
        )
        "#,
    )
    .expect("relay file-path regex is valid")
});

pub fn normalize_relay_rounds(turns: &[MessageTurn]) -> Vec<RelayRound> {
    let mut rounds = Vec::new();
    let mut current: Option<RelayRound> = None;

    for turn in turns {
        match turn.role {
            TurnRole::User => {
                if let Some(round) = current.take() {
                    rounds.push(round);
                }

                let mut round = RelayRound {
                    id: turn.id.clone(),
                    user_text: String::new(),
                    assistant_text: String::new(),
                    tools: Vec::new(),
                    files: Vec::new(),
                    source_message_ids: vec![turn.id.clone()],
                };
                absorb_blocks(&mut round, turn, false);
                current = Some(round);
            }
            TurnRole::Assistant => {
                if let Some(round) = current.as_mut() {
                    push_source_message_id(round, &turn.id);
                    absorb_blocks(round, turn, true);
                }
            }
            TurnRole::System => {}
        }
    }

    if let Some(round) = current {
        rounds.push(round);
    }
    rounds
}

pub fn select_relay_rounds(
    rounds: &[RelayRound],
    scope: &RelayScopeSelection,
) -> Result<Vec<RelayRound>, RelayError> {
    if scope.selected_round_ids.is_empty() {
        return Err(RelayError::new(RelayErrorCode::RelayScopeEmpty));
    }

    let selected_ids: HashSet<&str> = scope
        .selected_round_ids
        .iter()
        .map(String::as_str)
        .collect();
    let selected: Vec<RelayRound> = rounds
        .iter()
        .filter(|round| selected_ids.contains(round.id.as_str()))
        .cloned()
        .collect();

    if selected.is_empty() {
        return Err(RelayError::new(RelayErrorCode::RelayScopeEmpty));
    }
    if selected.len() != selected_ids.len() {
        return Err(RelayError::new(RelayErrorCode::RelayRoundsChanged));
    }

    Ok(selected)
}

pub fn fingerprint_rounds(rounds: &[RelayRound]) -> String {
    let canonical = serde_json::to_vec(rounds).expect("relay rounds always serialize");
    let digest = Sha256::digest(canonical);
    format!("{digest:x}")
}

fn absorb_blocks(round: &mut RelayRound, turn: &MessageTurn, assistant: bool) {
    let mut text_parts = Vec::new();
    for block in &turn.blocks {
        match block {
            ContentBlock::Text { text } => {
                collect_file_paths(round, text, &turn.id);
                let text = text.trim();
                if !text.is_empty() {
                    text_parts.push(text.to_owned());
                }
            }
            ContentBlock::Image { mime_type, uri, .. } => {
                add_image_reference(round, uri.as_deref(), mime_type, &turn.id)
            }
            ContentBlock::ImageGeneration { image, .. } => {
                if let Some(image) = image {
                    add_image_reference(round, image.uri.as_deref(), &image.mime_type, &turn.id);
                }
            }
            ContentBlock::ToolUse {
                tool_use_id,
                tool_name,
                input_preview,
                ..
            } => {
                let input = truncate_chars(input_preview.as_deref().unwrap_or_default());
                collect_file_paths(round, &input, &turn.id);
                round.tools.push(RelayToolFact {
                    tool_use_id: tool_use_id.clone(),
                    name: tool_name.clone(),
                    input,
                    output: None,
                    is_error: false,
                });
            }
            ContentBlock::ToolResult {
                tool_use_id,
                output_preview,
                is_error,
                ..
            } => {
                let output = output_preview.as_deref().map(truncate_chars);
                if let Some(output) = &output {
                    collect_file_paths(round, output, &turn.id);
                }
                if let Some(tool) = round
                    .tools
                    .iter_mut()
                    .rev()
                    .find(|tool| tool.tool_use_id == *tool_use_id)
                {
                    tool.output = output;
                    tool.is_error = *is_error;
                } else {
                    round.tools.push(RelayToolFact {
                        tool_use_id: tool_use_id.clone(),
                        name: "tool_result".to_owned(),
                        input: String::new(),
                        output,
                        is_error: *is_error,
                    });
                }
            }
            ContentBlock::Thinking { .. } => {}
        }
    }

    if assistant && !text_parts.is_empty() {
        append_text(&mut round.assistant_text, &text_parts.join("\n"));
    } else if !assistant && !text_parts.is_empty() {
        append_text(&mut round.user_text, &text_parts.join("\n"));
    }
}

fn add_image_reference(
    round: &mut RelayRound,
    uri: Option<&str>,
    mime_type: &str,
    source_message_id: &str,
) {
    let path = uri
        .filter(|uri| !uri.trim().is_empty())
        .unwrap_or("inline-image")
        .to_owned();
    add_file_reference(round, path, Some(mime_type.to_owned()), source_message_id);
}

fn collect_file_paths(round: &mut RelayRound, text: &str, source_message_id: &str) {
    for path in FILE_PATH_PATTERN
        .find_iter(text)
        .map(|matched| matched.as_str())
    {
        add_file_reference(round, path.to_owned(), None, source_message_id);
    }
}

fn add_file_reference(
    round: &mut RelayRound,
    path: String,
    mime_type: Option<String>,
    source_message_id: &str,
) {
    if round.files.iter().any(|file| file.path == path) {
        return;
    }
    round.files.push(RelayFileReference {
        path,
        mime_type,
        source_message_id: source_message_id.to_owned(),
    });
}

fn append_text(target: &mut String, text: &str) {
    if !target.is_empty() {
        target.push('\n');
    }
    target.push_str(text);
}

fn push_source_message_id(round: &mut RelayRound, id: &str) {
    if !round
        .source_message_ids
        .iter()
        .any(|source_id| source_id == id)
    {
        round.source_message_ids.push(id.to_owned());
    }
}

fn truncate_chars(text: &str) -> String {
    text.chars().take(MAX_TOOL_PREVIEW_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::models::{ContentBlock, MessageTurn, RelayScopeSelection, RelayScopeType, TurnRole};

    use super::{fingerprint_rounds, normalize_relay_rounds, select_relay_rounds};

    fn turn(id: &str, role: TurnRole, blocks: Vec<ContentBlock>) -> MessageTurn {
        MessageTurn {
            id: id.to_owned(),
            role,
            blocks,
            timestamp: Utc::now(),
            usage: None,
            duration_ms: None,
            model: None,
            completed_at: None,
        }
    }

    fn custom(ids: &[&str]) -> RelayScopeSelection {
        RelayScopeSelection {
            scope_type: RelayScopeType::CustomRounds,
            selected_round_ids: ids.iter().map(|id| (*id).to_owned()).collect(),
        }
    }

    fn fixture_turns() -> Vec<MessageTurn> {
        vec![
            turn(
                "round-1",
                TurnRole::User,
                vec![ContentBlock::Text {
                    text: "Inspect src/main.rs".to_owned(),
                }],
            ),
            turn(
                "assistant-1",
                TurnRole::Assistant,
                vec![
                    ContentBlock::ToolUse {
                        tool_use_id: Some("read-1".to_owned()),
                        tool_name: "Read".to_owned(),
                        input_preview: Some("src/main.rs".to_owned()),
                        status: None,
                        meta: None,
                    },
                    ContentBlock::ToolResult {
                        tool_use_id: Some("read-1".to_owned()),
                        output_preview: Some("fn main() {}".to_owned()),
                        is_error: false,
                        agent_stats: None,
                        images: vec![],
                    },
                    ContentBlock::Text {
                        text: "The entry point is ready.".to_owned(),
                    },
                ],
            ),
            turn(
                "round-2",
                TurnRole::User,
                vec![ContentBlock::Text {
                    text: "Check README.md".to_owned(),
                }],
            ),
            turn(
                "assistant-2",
                TurnRole::Assistant,
                vec![ContentBlock::Text {
                    text: "README is present.".to_owned(),
                }],
            ),
        ]
    }

    #[test]
    fn normalizes_a_complete_user_round_with_following_assistant_facts() {
        let rounds = normalize_relay_rounds(&fixture_turns());

        assert_eq!(rounds.len(), 2);
        assert_eq!(rounds[0].id, "round-1");
        assert_eq!(rounds[0].user_text, "Inspect src/main.rs");
        assert_eq!(rounds[0].assistant_text, "The entry point is ready.");
        assert_eq!(rounds[0].tools.len(), 1);
        assert_eq!(rounds[0].files[0].path, "src/main.rs");
        assert_eq!(rounds[0].source_message_ids, ["round-1", "assistant-1"]);
    }

    #[test]
    fn custom_scope_preserves_source_order_for_non_contiguous_rounds() {
        let selected = select_relay_rounds(
            &normalize_relay_rounds(&fixture_turns()),
            &custom(&["round-2", "round-1"]),
        )
        .unwrap();

        assert_eq!(
            selected
                .iter()
                .map(|round| round.id.as_str())
                .collect::<Vec<_>>(),
            ["round-1", "round-2"]
        );
    }

    #[test]
    fn excludes_thinking_and_binary_data_and_bounds_tool_previews() {
        let long_input = "i".repeat(1_001);
        let long_output = "o".repeat(1_001);
        let rounds = normalize_relay_rounds(&[
            turn(
                "round-1",
                TurnRole::User,
                vec![ContentBlock::Image {
                    data: "base64-should-not-appear".to_owned(),
                    mime_type: "image/png".to_owned(),
                    uri: Some("diagram.png".to_owned()),
                }],
            ),
            turn(
                "assistant-1",
                TurnRole::Assistant,
                vec![
                    ContentBlock::Thinking {
                        text: "private reasoning".to_owned(),
                    },
                    ContentBlock::ToolUse {
                        tool_use_id: Some("tool-1".to_owned()),
                        tool_name: "Read".to_owned(),
                        input_preview: Some(long_input),
                        status: None,
                        meta: None,
                    },
                    ContentBlock::ToolResult {
                        tool_use_id: Some("tool-1".to_owned()),
                        output_preview: Some(long_output),
                        is_error: false,
                        agent_stats: None,
                        images: vec![],
                    },
                ],
            ),
        ]);

        assert!(rounds[0].assistant_text.is_empty());
        assert_eq!(rounds[0].files[0].path, "diagram.png");
        assert_eq!(rounds[0].files[0].mime_type.as_deref(), Some("image/png"));
        assert_eq!(rounds[0].tools[0].input.chars().count(), 1_000);
        assert_eq!(
            rounds[0].tools[0].output.as_ref().unwrap().chars().count(),
            1_000
        );
        let serialized = serde_json::to_string(&rounds).unwrap();
        assert!(!serialized.contains("private reasoning"));
        assert!(!serialized.contains("base64-should-not-appear"));
    }

    #[test]
    fn source_append_does_not_change_selected_fingerprint() {
        let selected = select_relay_rounds(
            &normalize_relay_rounds(&fixture_turns()),
            &custom(&["round-1"]),
        )
        .unwrap();
        let before = fingerprint_rounds(&selected);
        let mut all = fixture_turns();
        all.push(turn(
            "round-3",
            TurnRole::User,
            vec![ContentBlock::Text {
                text: "New message".to_owned(),
            }],
        ));
        let after = fingerprint_rounds(
            &select_relay_rounds(&normalize_relay_rounds(&all), &custom(&["round-1"])).unwrap(),
        );

        assert_eq!(before, after);
    }
}
