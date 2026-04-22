// Cost estimation (pricing from litellm model_prices_and_context_window.json).

pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// Resolve per-token pricing for a model string. Falls back to Sonnet pricing.
pub fn get_model_pricing(model: Option<&str>) -> ModelPricing {
    let model = match model {
        Some(m) => m.to_lowercase(),
        None => {
            return ModelPricing {
                input: 3e-06,
                output: 1.5e-05,
                cache_read: 3e-07,
                cache_write: 3.75e-06,
            };
        }
    };

    if model.contains("opus") {
        if model.contains("4-5") || model.contains("4.5") || model.contains("4-6") || model.contains("4.6") {
            ModelPricing { input: 5e-06, output: 2.5e-05, cache_read: 5e-07, cache_write: 6.25e-06 }
        } else {
            ModelPricing { input: 1.5e-05, output: 7.5e-05, cache_read: 1.5e-06, cache_write: 1.875e-05 }
        }
    } else if model.contains("haiku") {
        if model.contains("4-5") || model.contains("4.5") {
            ModelPricing { input: 1e-06, output: 5e-06, cache_read: 1e-07, cache_write: 1.25e-06 }
        } else if model.contains("3-5") || model.contains("3.5") {
            ModelPricing { input: 8e-07, output: 4e-06, cache_read: 8e-08, cache_write: 1e-06 }
        } else {
            ModelPricing { input: 2.5e-07, output: 1.25e-06, cache_read: 2.5e-08, cache_write: 3.125e-07 }
        }
    } else {
        ModelPricing { input: 3e-06, output: 1.5e-05, cache_read: 3e-07, cache_write: 3.75e-06 }
    }
}

pub fn estimate_cost(
    model: Option<&str>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
) -> f64 {
    let p = get_model_pricing(model);
    (input as f64) * p.input
        + (output as f64) * p.output
        + (cache_read as f64) * p.cache_read
        + (cache_creation as f64) * p.cache_write
}

pub fn model_display_name(model: &str) -> String {
    let lower = model.to_lowercase();
    for family in &["opus", "sonnet", "haiku"] {
        if let Some(idx) = lower.find(family) {
            let after = &lower[idx + family.len()..];
            let capitalized = format!("{}{}", &family[..1].to_uppercase(), &family[1..]);

            let mut major = None;
            let mut minor = None;
            let mut num_iter = after.chars().peekable();
            while num_iter.peek().is_some_and(|c| !c.is_ascii_digit()) {
                num_iter.next();
            }
            let mut buf = String::new();
            while num_iter.peek().is_some_and(|c| c.is_ascii_digit()) {
                buf.push(num_iter.next().unwrap());
            }
            if !buf.is_empty() {
                major = Some(buf.clone());
                buf.clear();
            }
            while num_iter.peek().is_some_and(|c| !c.is_ascii_digit()) {
                num_iter.next();
            }
            while num_iter.peek().is_some_and(|c| c.is_ascii_digit()) {
                buf.push(num_iter.next().unwrap());
            }
            if !buf.is_empty() && buf.len() <= 2 {
                minor = Some(buf);
            }

            return match (major, minor) {
                (Some(maj), Some(min)) => format!("{capitalized} {maj}.{min}"),
                (Some(maj), None) => format!("{capitalized} {maj}"),
                _ => capitalized,
            };
        }
    }
    model
        .strip_prefix("claude-")
        .unwrap_or(model)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pricing_defaults_to_sonnet() {
        let p = get_model_pricing(None);
        assert_eq!(p.input, 3e-06);
        assert_eq!(p.output, 1.5e-05);
    }

    #[test]
    fn test_pricing_opus_new() {
        let p = get_model_pricing(Some("claude-opus-4-6-20260101"));
        assert_eq!(p.input, 5e-06);
    }

    #[test]
    fn test_pricing_opus_old() {
        let p = get_model_pricing(Some("claude-3-opus-20240229"));
        assert_eq!(p.input, 1.5e-05);
    }

    #[test]
    fn test_pricing_haiku_45() {
        let p = get_model_pricing(Some("claude-haiku-4-5-20251001"));
        assert_eq!(p.input, 1e-06);
    }

    #[test]
    fn test_pricing_haiku_35() {
        let p = get_model_pricing(Some("claude-3-5-haiku-20241022"));
        assert_eq!(p.input, 8e-07);
    }

    #[test]
    fn test_pricing_sonnet_fallback() {
        let p = get_model_pricing(Some("claude-sonnet-4-20250514"));
        assert_eq!(p.input, 3e-06);
    }

    #[test]
    fn test_estimate_cost_zero_tokens() {
        let cost = estimate_cost(None, 0, 0, 0, 0);
        assert_eq!(cost, 0.0);
    }

    #[test]
    fn test_estimate_cost_sonnet() {
        let cost = estimate_cost(Some("claude-sonnet-4-20250514"), 1000, 500, 0, 0);
        assert!((cost - 0.0105).abs() < 1e-10);
    }

    #[test]
    fn test_estimate_cost_with_cache() {
        let cost = estimate_cost(None, 0, 0, 1000, 500);
        assert!((cost - 0.002175).abs() < 1e-10);
    }

    #[test]
    fn test_display_name_sonnet() {
        assert_eq!(model_display_name("claude-sonnet-4-20250514"), "Sonnet 4");
    }

    #[test]
    fn test_display_name_opus_with_minor() {
        assert_eq!(model_display_name("claude-opus-4-6-20260101"), "Opus 4.6");
    }

    #[test]
    fn test_display_name_haiku_45() {
        assert_eq!(model_display_name("claude-haiku-4-5-20251001"), "Haiku 4.5");
    }

    #[test]
    fn test_display_name_unknown_model() {
        assert_eq!(model_display_name("gpt-4o"), "gpt-4o");
    }

    #[test]
    fn test_display_name_claude_prefix_stripped() {
        assert_eq!(model_display_name("claude-unknown-model"), "unknown-model");
    }
}
