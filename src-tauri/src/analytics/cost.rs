// Cost estimation using first-party public list prices per token.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelPricing {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

const SONNET_STANDARD: ModelPricing = ModelPricing {
    input: 3e-06,
    output: 1.5e-05,
    cache_read: 3e-07,
    cache_write: 3.75e-06,
};
const SONNET_5_PROMO: ModelPricing = ModelPricing {
    input: 2e-06,
    output: 1e-05,
    cache_read: 2e-07,
    cache_write: 2.5e-06,
};
const SONNET_5_PROMO_CUTOFF_MS: f64 = 1_788_220_800_000.0;

/// Resolve per-token pricing for a model string. Falls back to Sonnet pricing.
pub fn get_model_pricing(model: Option<&str>) -> ModelPricing {
    get_model_pricing_at(model, None)
}

pub fn get_model_pricing_at(model: Option<&str>, timestamp_ms: Option<f64>) -> ModelPricing {
    let Some(model) = model else {
        return SONNET_STANDARD;
    };
    let model = model.to_ascii_lowercase();

    if (model.contains("fable") || model.contains("mythos")) && contains_version(&model, &["5"]) {
        return ModelPricing {
            input: 1e-05,
            output: 5e-05,
            cache_read: 1e-06,
            cache_write: 1.25e-05,
        };
    }
    if model.contains("opus") {
        if contains_version(
            &model,
            &["4-5", "4.5", "4-6", "4.6", "4-7", "4.7", "4-8", "4.8", "5"],
        ) {
            return ModelPricing {
                input: 5e-06,
                output: 2.5e-05,
                cache_read: 5e-07,
                cache_write: 6.25e-06,
            };
        }
        return ModelPricing {
            input: 1.5e-05,
            output: 7.5e-05,
            cache_read: 1.5e-06,
            cache_write: 1.875e-05,
        };
    }
    if model.contains("sonnet") {
        if contains_version(&model, &["5"]) {
            return match timestamp_ms {
                Some(timestamp)
                    if timestamp.is_finite() && timestamp < SONNET_5_PROMO_CUTOFF_MS =>
                {
                    SONNET_5_PROMO
                }
                _ => SONNET_STANDARD,
            };
        }
        return SONNET_STANDARD;
    }
    if model.contains("haiku") {
        if contains_version(&model, &["4-5", "4.5"]) {
            return ModelPricing {
                input: 1e-06,
                output: 5e-06,
                cache_read: 1e-07,
                cache_write: 1.25e-06,
            };
        }
        if contains_version(&model, &["3-5", "3.5"])
            || model.contains("3-5-haiku")
            || model.contains("3.5-haiku")
        {
            return ModelPricing {
                input: 8e-07,
                output: 4e-06,
                cache_read: 8e-08,
                cache_write: 1e-06,
            };
        }
    }
    SONNET_STANDARD
}

fn contains_version(model: &str, versions: &[&str]) -> bool {
    let family = ["fable", "mythos", "opus", "sonnet", "haiku"]
        .into_iter()
        .find_map(|family| model.find(family).map(|index| (family, index)));
    let Some((family, index)) = family else {
        return false;
    };
    let version = model[index + family.len()..].trim_start_matches(['-', '_', ' ']);
    versions.iter().any(|candidate| {
        version == *candidate
            || version.starts_with(&format!("{candidate}-"))
            || version.starts_with(&format!("{candidate}."))
    })
}

pub fn estimate_cost(
    model: Option<&str>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
) -> f64 {
    estimate_with_pricing(
        get_model_pricing(model),
        input,
        output,
        cache_read,
        cache_creation,
    )
}

pub fn estimate_cost_at(
    model: Option<&str>,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
    timestamp_ms: Option<f64>,
) -> f64 {
    estimate_with_pricing(
        get_model_pricing_at(model, timestamp_ms),
        input,
        output,
        cache_read,
        cache_creation,
    )
}

fn estimate_with_pricing(
    pricing: ModelPricing,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
) -> f64 {
    (input as f64) * pricing.input
        + (output as f64) * pricing.output
        + (cache_read as f64) * pricing.cache_read
        + (cache_creation as f64) * pricing.cache_write
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
                if let Some(character) = num_iter.next() {
                    buf.push(character);
                }
            }
            if !buf.is_empty() {
                major = Some(buf.clone());
                buf.clear();
            }
            while num_iter.peek().is_some_and(|c| !c.is_ascii_digit()) {
                num_iter.next();
            }
            while num_iter.peek().is_some_and(|c| c.is_ascii_digit()) {
                if let Some(character) = num_iter.next() {
                    buf.push(character);
                }
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
    model.strip_prefix("claude-").unwrap_or(model).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_pricing(model: &str, expected: ModelPricing) {
        assert_eq!(get_model_pricing(Some(model)), expected);
    }

    #[test]
    fn resolves_current_model_families() {
        let premium = ModelPricing {
            input: 1e-05,
            output: 5e-05,
            cache_read: 1e-06,
            cache_write: 1.25e-05,
        };
        assert_pricing("claude-fable-5", premium);
        assert_pricing("claude-mythos-5", premium);

        let current_opus = ModelPricing {
            input: 5e-06,
            output: 2.5e-05,
            cache_read: 5e-07,
            cache_write: 6.25e-06,
        };
        for version in ["4-5", "4-6", "4-7", "4-8", "5"] {
            assert_pricing(&format!("claude-opus-{version}"), current_opus);
        }

        assert_pricing(
            "claude-3-opus-20240229",
            ModelPricing {
                input: 1.5e-05,
                output: 7.5e-05,
                cache_read: 1.5e-06,
                cache_write: 1.875e-05,
            },
        );
        assert_pricing(
            "claude-haiku-4-5-20251001",
            ModelPricing {
                input: 1e-06,
                output: 5e-06,
                cache_read: 1e-07,
                cache_write: 1.25e-06,
            },
        );
        assert_pricing(
            "claude-3-5-haiku-20241022",
            ModelPricing {
                input: 8e-07,
                output: 4e-06,
                cache_read: 8e-08,
                cache_write: 1e-06,
            },
        );
    }

    #[test]
    fn applies_sonnet_5_promo_cutoff() {
        assert_eq!(
            get_model_pricing_at(
                Some("claude-sonnet-5"),
                Some(SONNET_5_PROMO_CUTOFF_MS - 1.0)
            ),
            SONNET_5_PROMO
        );
        assert_eq!(
            get_model_pricing_at(Some("claude-sonnet-5"), Some(SONNET_5_PROMO_CUTOFF_MS)),
            SONNET_STANDARD
        );
        assert_eq!(get_model_pricing(Some("claude-sonnet-5")), SONNET_STANDARD);
    }

    #[test]
    fn unknown_and_missing_models_fall_back_to_sonnet() {
        assert_eq!(get_model_pricing(None), SONNET_STANDARD);
        assert_eq!(get_model_pricing(Some("unknown")), SONNET_STANDARD);
    }

    #[test]
    fn estimates_five_minute_cache_creation() {
        let cost = estimate_cost(None, 0, 0, 1000, 500);
        assert!((cost - 0.002175).abs() < 1e-10);
    }

    #[test]
    fn display_names_remain_stable() {
        assert_eq!(model_display_name("claude-sonnet-4-20250514"), "Sonnet 4");
        assert_eq!(model_display_name("claude-opus-4-6-20260101"), "Opus 4.6");
        assert_eq!(model_display_name("claude-haiku-4-5-20251001"), "Haiku 4.5");
        assert_eq!(model_display_name("gpt-4o"), "gpt-4o");
        assert_eq!(model_display_name("claude-unknown-model"), "unknown-model");
    }
}
