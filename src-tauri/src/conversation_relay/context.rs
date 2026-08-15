use sha2::{Digest, Sha256};

use crate::acp::types::PromptInputBlock;

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

pub fn build_hidden_relay_block(
    marker: &RelayContextMarker,
    snapshot: &str,
) -> PromptInputBlock {
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
    let Some(snapshot) = hidden_snapshot(text, marker) else {
        return blocks.to_vec();
    };
    if marker_for_snapshot(marker.relay_id, snapshot) != *marker {
        return blocks.to_vec();
    }
    blocks[1..].to_vec()
}

fn hidden_snapshot<'a>(text: &'a str, marker: &RelayContextMarker) -> Option<&'a str> {
    let prefix = format!(
        "<prooflane-relay-context version=\"1\" relay-id=\"{}\" snapshot-sha256=\"{}\">\n",
        marker.relay_id, marker.snapshot_sha256
    );
    let suffix = "\n</prooflane-relay-context>";
    text.strip_prefix(&prefix)?.strip_suffix(suffix)
}
