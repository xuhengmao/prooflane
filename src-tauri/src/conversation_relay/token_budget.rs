pub fn estimate_relay_tokens(text: &str) -> u32 {
    let (ascii, non_ascii) = text.chars().fold((0_u32, 0_u32), |(ascii, non_ascii), ch| {
        if ch.is_ascii() {
            (ascii.saturating_add(1), non_ascii)
        } else {
            (ascii, non_ascii.saturating_add(1))
        }
    });
    let base = ascii.div_ceil(4).saturating_add(non_ascii);
    ((base as f64) * 1.15).ceil() as u32
}

pub fn relay_budget(context_window_tokens: Option<u32>) -> u32 {
    context_window_tokens
        .map(|window| window.saturating_mul(20) / 100)
        .unwrap_or(4_000)
        .min(12_000)
}

#[cfg(test)]
mod tests {
    use super::{estimate_relay_tokens, relay_budget};

    #[test]
    fn budget_applies_unknown_fallback_percentage_and_hard_cap() {
        assert_eq!(relay_budget(None), 4_000);
        assert_eq!(relay_budget(Some(20_000)), 4_000);
        assert_eq!(relay_budget(Some(200_000)), 12_000);
        assert_eq!(estimate_relay_tokens("abcd"), 2);
        assert_eq!(estimate_relay_tokens("你好"), 3);
    }
}
