use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use sha2::{Digest, Sha256};

use crate::models::{
    ContentBlock, MessageTurn, RelayError, RelayErrorCode, RelayFileReference, RelayRound,
    RelayScopeSelection, RelaySnapshot, RelaySnapshotSource, RelayStats, RelaySummary,
    RelayToolFact, TurnRole,
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

static FILE_URI_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"file://[^\s\"'`<>|]+"#).expect("relay file URI regex is valid"));

pub fn normalize_relay_rounds(turns: &[MessageTurn]) -> Vec<RelayRound> {
    let mut rounds = Vec::new();
    let mut current: Option<RelayRound> = None;

    for turn in turns {
        match turn.role {
            TurnRole::User => {
                if let Some(round) = current.take() {
                    push_completed_round(&mut rounds, round);
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
                    absorb_assistant_blocks(round, turn);
                }
            }
            TurnRole::System => {}
        }
    }

    if let Some(round) = current {
        push_completed_round(&mut rounds, round);
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

    if selected.len() != selected_ids.len() {
        return Err(RelayError::new(RelayErrorCode::RelayRoundsChanged));
    }

    Ok(selected)
}

pub fn build_relay_snapshot(
    source: RelaySnapshotSource,
    scope: RelayScopeSelection,
    available_rounds: Vec<RelayRound>,
    summary: Option<RelaySummary>,
) -> Result<RelaySnapshot, RelayError> {
    let included_rounds = select_relay_rounds(&available_rounds, &scope)?;
    let files = collect_snapshot_files(&included_rounds);
    let stats = RelayStats {
        message_count: included_rounds.iter().fold(0_u32, |count, round| {
            count.saturating_add(round.source_message_ids.len() as u32)
        }),
        file_count: files.len() as u32,
        todo_count: included_rounds.iter().fold(0_u32, |count, round| {
            count.saturating_add(
                round
                    .tools
                    .iter()
                    .filter(|tool| is_explicit_todo_tool(&tool.name))
                    .count() as u32,
            )
        }),
    };
    let canonical_context = build_canonical_context(&included_rounds, &files, summary.as_ref());

    Ok(RelaySnapshot {
        version: 1,
        source,
        scope,
        available_rounds,
        included_rounds,
        summary,
        files,
        stats,
        canonical_context,
    })
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

fn absorb_assistant_blocks(round: &mut RelayRound, turn: &MessageTurn) {
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
                images,
                ..
            } => {
                let output = output_preview.as_deref().map(truncate_chars);
                if let Some(output) = &output {
                    collect_file_paths(round, output, &turn.id);
                }
                for image in images {
                    add_image_reference(round, image.uri.as_deref(), &image.mime_type, &turn.id);
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

    round.assistant_text = text_parts.join("\n");
}

fn add_image_reference(
    round: &mut RelayRound,
    uri: Option<&str>,
    mime_type: &str,
    source_message_id: &str,
) {
    let path = image_name(uri);
    add_file_reference(round, path, Some(mime_type.to_owned()), source_message_id);
}

fn collect_file_paths(round: &mut RelayRound, text: &str, source_message_id: &str) {
    for path in FILE_URI_PATTERN
        .find_iter(text)
        .map(|matched| matched.as_str())
    {
        add_file_reference(round, path.to_owned(), None, source_message_id);
    }
    for path in FILE_PATH_PATTERN
        .find_iter(text)
        .filter(|matched| !is_url_path_match(text, matched.start(), matched.as_str()))
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

fn push_completed_round(rounds: &mut Vec<RelayRound>, round: RelayRound) {
    if !round.assistant_text.is_empty() {
        rounds.push(round);
    }
}

fn image_name(uri: Option<&str>) -> String {
    let Some(uri) = uri.map(str::trim).filter(|uri| !uri.is_empty()) else {
        return "inline-image".to_owned();
    };
    if uri.starts_with("data:") {
        return "inline-image".to_owned();
    }

    let without_query = uri.split(['?', '#']).next().unwrap_or(uri);
    let name = without_query
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("inline-image");
    name.to_owned()
}

fn is_url_path_match(text: &str, start: usize, path: &str) -> bool {
    let starts_inside_word = text[..start]
        .chars()
        .next_back()
        .is_some_and(|character| character.is_ascii_alphanumeric());

    starts_inside_word
        || path.starts_with("//")
        || text[..start].ends_with("//")
        || (path.starts_with('/') && text[..start].ends_with(':'))
}

fn collect_snapshot_files(rounds: &[RelayRound]) -> Vec<RelayFileReference> {
    let mut files = Vec::new();
    for file in rounds.iter().flat_map(|round| &round.files) {
        if !files
            .iter()
            .any(|existing: &RelayFileReference| existing.path == file.path)
        {
            files.push(file.clone());
        }
    }
    files
}

fn is_explicit_todo_tool(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("todo")
        || name
            .split(|character: char| !character.is_ascii_alphanumeric())
            .any(|part| matches!(part, "plan" | "planning"))
}

fn build_canonical_context(
    rounds: &[RelayRound],
    files: &[RelayFileReference],
    summary: Option<&RelaySummary>,
) -> String {
    let mut context = String::from("[relay_context]\n");
    if let Some(summary) = summary {
        append_summary(&mut context, summary);
    }
    for round in rounds {
        context.push_str(&format!("[round:{}]\n", round.id));
        append_context_field(&mut context, "user", &round.user_text);
        append_context_field(&mut context, "assistant", &round.assistant_text);
        for tool in &round.tools {
            context.push_str(&format!("tool: {}\n", tool.name));
            append_context_field(&mut context, "input", &truncate_chars(&tool.input));
            if let Some(output) = &tool.output {
                append_context_field(&mut context, "output", &truncate_chars(output));
            }
            context.push_str(&format!("error: {}\n", tool.is_error));
        }
        context.push_str("[/round]\n");
    }
    for file in files {
        context.push_str(&format!("file: {}\n", file.path));
    }
    context.push_str("[/relay_context]");
    context
}

fn append_summary(context: &mut String, summary: &RelaySummary) {
    for (name, values) in [
        ("goals", &summary.goals),
        ("decisions", &summary.decisions),
        ("progress", &summary.progress),
        ("todos", &summary.todos),
        ("constraints", &summary.constraints),
        ("files", &summary.files),
        ("open_questions", &summary.open_questions),
    ] {
        for value in values {
            append_context_field(context, name, value);
        }
    }
}

fn append_context_field(context: &mut String, name: &str, value: &str) {
    if !value.is_empty() {
        context.push_str(name);
        context.push_str(": ");
        context.push_str(value);
        context.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::models::{
        ContentBlock, ImageData, MessageTurn, RelayScopeSelection, RelayScopeType,
        RelaySnapshotSource, TurnRole,
    };

    use super::{
        build_relay_snapshot, fingerprint_rounds, normalize_relay_rounds, select_relay_rounds,
    };

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
    fn excludes_user_segments_without_a_final_assistant_response() {
        let rounds = normalize_relay_rounds(&[
            turn(
                "complete-user",
                TurnRole::User,
                vec![ContentBlock::Text {
                    text: "Complete this".to_owned(),
                }],
            ),
            turn(
                "complete-assistant",
                TurnRole::Assistant,
                vec![ContentBlock::Text {
                    text: "Completed".to_owned(),
                }],
            ),
            turn(
                "pending-user",
                TurnRole::User,
                vec![ContentBlock::Text {
                    text: "Still pending".to_owned(),
                }],
            ),
        ]);

        assert_eq!(rounds.len(), 1);
        assert_eq!(rounds[0].id, "complete-user");
    }

    #[test]
    fn retains_only_the_last_assistant_messages_text_blocks() {
        let rounds = normalize_relay_rounds(&[
            turn(
                "round-1",
                TurnRole::User,
                vec![ContentBlock::Text {
                    text: "Question".to_owned(),
                }],
            ),
            turn(
                "assistant-intermediate",
                TurnRole::Assistant,
                vec![ContentBlock::Text {
                    text: "Intermediate answer".to_owned(),
                }],
            ),
            turn(
                "assistant-final",
                TurnRole::Assistant,
                vec![
                    ContentBlock::Text {
                        text: "Final part one".to_owned(),
                    },
                    ContentBlock::Thinking {
                        text: "private reasoning".to_owned(),
                    },
                    ContentBlock::Text {
                        text: "Final part two".to_owned(),
                    },
                ],
            ),
        ]);

        assert_eq!(rounds[0].assistant_text, "Final part one\nFinal part two");
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
                    ContentBlock::Text {
                        text: "Safe final response".to_owned(),
                    },
                ],
            ),
        ]);

        assert_eq!(rounds[0].assistant_text, "Safe final response");
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
    fn treats_all_missing_frozen_round_ids_as_changed() {
        let error = select_relay_rounds(
            &normalize_relay_rounds(&fixture_turns()),
            &custom(&["missing-round"]),
        )
        .unwrap_err();

        assert_eq!(error.code.to_string(), "relay_rounds_changed");
    }

    #[test]
    fn retains_only_safe_image_metadata_and_ignores_web_urls_as_paths() {
        let rounds = normalize_relay_rounds(&[
            turn(
                "round-1",
                TurnRole::User,
                vec![
                    ContentBlock::Text {
                        text:
                            "See https://example.com/a, file:///tmp/guide.md and C:\\work\\main.rs"
                                .to_owned(),
                    },
                    ContentBlock::Image {
                        data: "base64-user-image".to_owned(),
                        mime_type: "image/png".to_owned(),
                        uri: Some("data:image/png;base64,base64-user-image".to_owned()),
                    },
                ],
            ),
            turn(
                "assistant-1",
                TurnRole::Assistant,
                vec![
                    ContentBlock::ToolResult {
                        tool_use_id: Some("image-tool".to_owned()),
                        output_preview: None,
                        is_error: false,
                        agent_stats: None,
                        images: vec![ImageData {
                            data: "base64-tool-image".to_owned(),
                            mime_type: "image/jpeg".to_owned(),
                            uri: Some("C:\\work\\plot.jpg".to_owned()),
                        }],
                    },
                    ContentBlock::Text {
                        text: "Final response".to_owned(),
                    },
                ],
            ),
        ]);

        let files = &rounds[0].files;
        assert_eq!(
            files
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            [
                "file:///tmp/guide.md",
                "C:\\work\\main.rs",
                "inline-image",
                "plot.jpg"
            ]
        );
        assert_eq!(files[2].mime_type.as_deref(), Some("image/png"));
        assert_eq!(files[3].mime_type.as_deref(), Some("image/jpeg"));
        let serialized = serde_json::to_string(&rounds).unwrap();
        assert!(!serialized.contains("base64-user-image"));
        assert!(!serialized.contains("base64-tool-image"));
        assert!(!files.iter().any(|file| file.path.contains("example.com/a")));
    }

    #[test]
    fn builds_a_safe_snapshot_with_deduplicated_files_and_explicit_todos() {
        let long_output = format!("bounded output {}", "x".repeat(1_000));
        let available_rounds = normalize_relay_rounds(&[
            turn(
                "round-1",
                TurnRole::User,
                vec![ContentBlock::Text {
                    text: "Read src/main.rs and src/main.rs".to_owned(),
                }],
            ),
            turn(
                "system-log",
                TurnRole::System,
                vec![ContentBlock::Text {
                    text: "system log secret".to_owned(),
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
                        tool_use_id: Some("todo-1".to_owned()),
                        tool_name: "TodoWrite".to_owned(),
                        input_preview: Some("plan the next change".to_owned()),
                        status: None,
                        meta: None,
                    },
                    ContentBlock::ToolResult {
                        tool_use_id: Some("todo-1".to_owned()),
                        output_preview: Some(long_output),
                        is_error: false,
                        agent_stats: None,
                        images: vec![],
                    },
                    ContentBlock::Text {
                        text: "Final safe response".to_owned(),
                    },
                ],
            ),
        ]);

        let snapshot = build_relay_snapshot(
            RelaySnapshotSource {
                conversation_id: 1,
                folder_id: 2,
            },
            custom(&["round-1"]),
            available_rounds,
            None,
        )
        .unwrap();

        assert_eq!(snapshot.files.len(), 1);
        assert_eq!(snapshot.files[0].path, "src/main.rs");
        assert_eq!(snapshot.stats.message_count, 2);
        assert_eq!(snapshot.stats.file_count, 1);
        assert_eq!(snapshot.stats.todo_count, 1);
        assert!(snapshot.canonical_context.contains("Final safe response"));
        assert!(snapshot.canonical_context.contains("bounded output"));
        assert!(!snapshot.canonical_context.contains("private reasoning"));
        assert!(!snapshot.canonical_context.contains("system log secret"));
        assert!(!snapshot.canonical_context.contains(&"x".repeat(1_000)));
    }

    #[test]
    fn snapshot_does_not_count_non_plan_tools_as_todos() {
        let available_rounds = normalize_relay_rounds(&[
            turn(
                "round-1",
                TurnRole::User,
                vec![ContentBlock::Text {
                    text: "Inspect status".to_owned(),
                }],
            ),
            turn(
                "assistant-1",
                TurnRole::Assistant,
                vec![
                    ContentBlock::ToolUse {
                        tool_use_id: Some("plant-status".to_owned()),
                        tool_name: "PlantStatus".to_owned(),
                        input_preview: Some("current status".to_owned()),
                        status: None,
                        meta: None,
                    },
                    ContentBlock::Text {
                        text: "Status inspected".to_owned(),
                    },
                ],
            ),
        ]);

        let snapshot = build_relay_snapshot(
            RelaySnapshotSource {
                conversation_id: 1,
                folder_id: 2,
            },
            custom(&["round-1"]),
            available_rounds,
            None,
        )
        .unwrap();

        assert_eq!(snapshot.stats.todo_count, 0);
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
