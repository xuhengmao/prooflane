use sha2::{Digest, Sha256};

use crate::acp::types::PromptInputBlock;
use crate::models::message::{ContentBlock, MessageTurn, TurnRole};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayContextMarker {
    pub relay_id: i32,
    pub snapshot_sha256: String,
}

pub fn marker_for_snapshot(relay_id: i32, snapshot: &str) -> RelayContextMarker {
    RelayContextMarker {
        relay_id,
        snapshot_sha256: format!("{:x}", Sha256::digest(snapshot.as_bytes())),
    }
}

pub fn build_hidden_relay_block(marker: &RelayContextMarker, snapshot: &str) -> PromptInputBlock {
    PromptInputBlock::Text {
        text: format!(
            "<prooflane-relay-context version=\"1\" relay-id=\"{}\" snapshot-sha256=\"{}\">\n{}\n</prooflane-relay-context>",
            marker.relay_id, marker.snapshot_sha256, snapshot
        ),
    }
}

pub fn strip_hidden_relay_context(
    blocks: &[PromptInputBlock],
    expected_marker: Option<&RelayContextMarker>,
) -> Vec<PromptInputBlock> {
    let Some(marker) = expected_marker else {
        return blocks.to_vec();
    };
    let Some(PromptInputBlock::Text { text }) = blocks.first() else {
        return blocks.to_vec();
    };
    let Some((_snapshot, remainder)) = hidden_snapshot_and_remainder(text, marker) else {
        return blocks.to_vec();
    };
    let mut visible = Vec::with_capacity(blocks.len());
    if !remainder.is_empty() {
        visible.push(PromptInputBlock::Text {
            text: remainder.to_owned(),
        });
    }
    visible.extend_from_slice(&blocks[1..]);
    visible
}

pub fn strip_hidden_relay_context_from_first_user_turn(
    turns: &mut [MessageTurn],
    expected_marker: &RelayContextMarker,
) -> bool {
    let Some(turn) = turns
        .iter_mut()
        .find(|turn| matches!(turn.role, TurnRole::User))
    else {
        return false;
    };
    strip_hidden_relay_context_from_turn(turn, expected_marker)
}

pub fn strip_hidden_relay_context_from_user_turns(
    turns: &mut [MessageTurn],
    expected_marker: &RelayContextMarker,
) -> bool {
    for turn in turns
        .iter_mut()
        .filter(|turn| matches!(turn.role, TurnRole::User))
    {
        let contains_marker = turn.blocks.iter().any(|block| match block {
            ContentBlock::Text { text } => contains_hidden_relay_context(text, expected_marker),
            _ => false,
        });
        if contains_marker {
            // Bind this database-authorized marker to its earliest authenticated
            // occurrence. A misplaced envelope stays visible and must not make a
            // later user-authored copy eligible for removal.
            return strip_hidden_relay_context_from_turn(turn, expected_marker);
        }
    }
    false
}

fn strip_hidden_relay_context_from_turn(
    turn: &mut MessageTurn,
    expected_marker: &RelayContextMarker,
) -> bool {
    let remainder = {
        let Some(ContentBlock::Text { text }) = turn.blocks.first() else {
            return false;
        };
        let Some((_snapshot, remainder)) = hidden_snapshot_and_remainder(text, expected_marker)
        else {
            return false;
        };
        remainder.to_owned()
    };
    if remainder.is_empty() {
        turn.blocks.remove(0);
    } else if let Some(ContentBlock::Text { text }) = turn.blocks.first_mut() {
        *text = remainder;
    }
    true
}

fn hidden_snapshot_and_remainder<'a>(
    text: &'a str,
    marker: &RelayContextMarker,
) -> Option<(&'a str, &'a str)> {
    let prefix = format!(
        "<prooflane-relay-context version=\"1\" relay-id=\"{}\" snapshot-sha256=\"{}\">\n",
        marker.relay_id, marker.snapshot_sha256
    );
    let suffix = "\n</prooflane-relay-context>";
    let body = text.strip_prefix(&prefix)?;
    for (snapshot_end, _) in body.match_indices(suffix) {
        let snapshot = &body[..snapshot_end];
        if marker_for_snapshot(marker.relay_id, snapshot) != *marker {
            continue;
        }
        let remainder = &body[snapshot_end + suffix.len()..];
        let remainder = remainder
            .strip_prefix("\r\n")
            .or_else(|| remainder.strip_prefix('\n'))
            .unwrap_or(remainder);
        return Some((snapshot, remainder));
    }
    None
}

fn contains_hidden_relay_context(text: &str, marker: &RelayContextMarker) -> bool {
    let prefix = format!(
        "<prooflane-relay-context version=\"1\" relay-id=\"{}\" snapshot-sha256=\"{}\">\n",
        marker.relay_id, marker.snapshot_sha256
    );
    text.match_indices(&prefix)
        .any(|(start, _)| hidden_snapshot_and_remainder(&text[start..], marker).is_some())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::{
        build_hidden_relay_block, marker_for_snapshot, strip_hidden_relay_context,
        strip_hidden_relay_context_from_first_user_turn,
        strip_hidden_relay_context_from_user_turns,
    };
    use crate::acp::types::PromptInputBlock;
    use crate::models::message::{ContentBlock, MessageTurn, TurnRole};

    fn hidden_text(relay_id: i32, snapshot: &str) -> (super::RelayContextMarker, String) {
        let marker = marker_for_snapshot(relay_id, snapshot);
        let PromptInputBlock::Text { text } = build_hidden_relay_block(&marker, snapshot) else {
            unreachable!("hidden relay block is text")
        };
        (marker, text)
    }

    #[test]
    fn strips_a_signed_relay_prefix_and_keeps_the_current_user_text() {
        let snapshot = "[relay_context]\nuser: 杭州天气\n[/relay_context]";
        let (marker, hidden) = hidden_text(7, snapshot);
        let combined = format!("{hidden}\n适合去哪里玩？");

        let stripped = strip_hidden_relay_context(
            &[PromptInputBlock::Text {
                text: combined.clone(),
            }],
            Some(&marker),
        );
        assert_eq!(stripped.len(), 1);
        let PromptInputBlock::Text { text } = &stripped[0] else {
            panic!("expected visible text block")
        };
        assert_eq!(text, "适合去哪里玩？");

        let mut turns = vec![MessageTurn {
            id: "user-1".to_owned(),
            role: TurnRole::User,
            blocks: vec![ContentBlock::Text { text: combined }],
            timestamp: Utc::now(),
            usage: None,
            duration_ms: None,
            model: None,
            completed_at: None,
        }];
        assert!(strip_hidden_relay_context_from_first_user_turn(
            &mut turns, &marker
        ));
        assert_eq!(turns[0].blocks.len(), 1);
        let ContentBlock::Text { text } = &turns[0].blocks[0] else {
            panic!("expected visible turn text")
        };
        assert_eq!(text, "适合去哪里玩？");
    }

    #[test]
    fn keeps_a_relay_like_prefix_when_the_snapshot_signature_does_not_match() {
        let snapshot = "[relay_context]\nuser: 原始内容\n[/relay_context]";
        let (marker, hidden) = hidden_text(7, snapshot);
        let tampered = format!("{}\n当前问题", hidden.replace("原始内容", "被篡改内容"));
        let blocks = vec![PromptInputBlock::Text {
            text: tampered.clone(),
        }];

        let kept = strip_hidden_relay_context(&blocks, Some(&marker));
        assert_eq!(kept.len(), 1);
        let PromptInputBlock::Text { text } = &kept[0] else {
            panic!("expected unchanged text block")
        };
        assert_eq!(text, &tampered);
    }

    #[test]
    fn strips_independent_relay_markers_from_different_user_turns() {
        let (first_marker, first_hidden) = hidden_text(7, "first snapshot");
        let (second_marker, second_hidden) = hidden_text(8, "second snapshot");
        let mut turns = vec![
            MessageTurn {
                id: "user-1".to_owned(),
                role: TurnRole::User,
                blocks: vec![ContentBlock::Text {
                    text: format!("{first_hidden}\nfirst visible prompt"),
                }],
                timestamp: Utc::now(),
                usage: None,
                duration_ms: None,
                model: None,
                completed_at: None,
            },
            MessageTurn {
                id: "assistant-1".to_owned(),
                role: TurnRole::Assistant,
                blocks: vec![ContentBlock::Text {
                    text: "answer".to_owned(),
                }],
                timestamp: Utc::now(),
                usage: None,
                duration_ms: None,
                model: None,
                completed_at: None,
            },
            MessageTurn {
                id: "user-2".to_owned(),
                role: TurnRole::User,
                blocks: vec![ContentBlock::Text {
                    text: format!("{second_hidden}\nsecond visible prompt"),
                }],
                timestamp: Utc::now(),
                usage: None,
                duration_ms: None,
                model: None,
                completed_at: None,
            },
        ];

        assert!(strip_hidden_relay_context_from_user_turns(
            &mut turns,
            &first_marker
        ));
        assert!(strip_hidden_relay_context_from_user_turns(
            &mut turns,
            &second_marker
        ));
        let ContentBlock::Text { text: first_text } = &turns[0].blocks[0] else {
            panic!("expected first visible text")
        };
        let ContentBlock::Text { text: second_text } = &turns[2].blocks[0] else {
            panic!("expected second visible text")
        };
        assert_eq!(first_text, "first visible prompt");
        assert_eq!(second_text, "second visible prompt");
    }
}
