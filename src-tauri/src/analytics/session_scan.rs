// Fast JSONL scan — extracts only analytics-relevant fields.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::Deserialize;

/// Minimal data extracted from a session file for analytics purposes.
/// Avoids full message parsing (content blocks, tool calls, etc.).
pub struct SessionSummary {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub duration_ms: f64,
    pub model: Option<String>,
    pub first_timestamp_ms: Option<f64>,
    pub last_timestamp_ms: Option<f64>,
    pub first_user_text: Option<String>,
    pub custom_title: Option<String>,
    /// Total tool_use blocks encountered in the session.
    pub tool_call_count: u64,
    /// tool_result blocks marked `is_error`.
    pub tool_error_count: u64,
    /// Number of `role: assistant` message entries.
    pub assistant_message_count: u64,
    /// Gap-adjusted active milliseconds — consecutive timestamp deltas capped
    /// at `ACTIVE_GAP_CAP_MS`. Idle stretches (e.g. the user walks away) stop
    /// counting once the cap is exceeded.
    pub active_ms: f64,
}

/// Cap applied to consecutive timestamp gaps when computing active time.
/// Anything longer than this counts as idle.
pub const ACTIVE_GAP_CAP_MS: f64 = 5.0 * 60.0 * 1000.0;
pub const LIGHT_SCAN_MAX_RECORD_BYTES: usize = 1024 * 1024;
const LIGHT_TEXT_MAX_CHARS: usize = 500;
const LIGHT_METADATA_MAX_CHARS: usize = 500;
const LIGHT_DIAGNOSTIC_MAX_CHARS: usize = 200;
#[cfg(test)]
static LIGHT_SCAN_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(crate) fn reset_light_scan_count() {
    LIGHT_SCAN_COUNT.store(0, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(test)]
pub(crate) fn light_scan_count() -> usize {
    LIGHT_SCAN_COUNT.load(std::sync::atomic::Ordering::Relaxed)
}

#[derive(Debug)]
pub struct LightSessionSummary {
    pub model: Option<String>,
    pub first_timestamp: Option<String>,
    pub first_user_text: Option<String>,
    pub custom_title: Option<String>,
    pub agent_name: Option<String>,
    pub message_count: u32,
    pub cost_usd: Option<f64>,
    pub cost_diagnostic: Option<String>,
    pub(crate) assistant_usage: Vec<DeduplicatedAssistantUsage>,
}

#[derive(Debug, Clone)]
pub(crate) struct DeduplicatedAssistantUsage {
    pub(crate) event_timestamp_ms: Option<f64>,
    pub(crate) priced_usage_usd: Option<f64>,
}

#[derive(Deserialize)]
struct QuickEntry {
    #[serde(rename = "type")]
    entry_type: Option<String>,
    role: Option<String>,
    model: Option<String>,
    timestamp: Option<String>,
    usage: Option<QuickUsage>,
    message: Option<QuickMessage>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    #[serde(rename = "customTitle")]
    custom_title: Option<String>,
}

#[derive(Deserialize)]
struct QuickUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct QuickMessage {
    role: Option<String>,
    model: Option<String>,
    usage: Option<QuickUsage>,
    content: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LightEntry {
    #[serde(rename = "type")]
    entry_type: Option<String>,
    timestamp: Option<String>,
    request_id: Option<String>,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_meta: bool,
    #[serde(default)]
    is_compact_summary: bool,
    custom_title: Option<String>,
    agent_name: Option<String>,
    message: Option<LightMessage>,
}

#[derive(Deserialize)]
struct LightMessage {
    role: Option<String>,
    model: Option<String>,
    usage: Option<LightUsage>,
    content: Option<LightContent>,
}

#[derive(Clone, Default, Deserialize)]
struct LightUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum LightContent {
    Text(String),
    Blocks(Vec<LightContentBlock>),
    Other(serde::de::IgnoredAny),
}

#[derive(Deserialize)]
struct LightContentBlock {
    #[serde(rename = "type")]
    block_type: Option<String>,
    text: Option<String>,
}

#[derive(Clone)]
struct RetainedAssistantUsage {
    model: Option<String>,
    timestamp_ms: Option<f64>,
    usage: LightUsage,
    is_visible: bool,
    arrival_index: usize,
}

fn usage_token_total(usage: &LightUsage) -> u128 {
    u128::from(usage.input_tokens)
        + u128::from(usage.output_tokens)
        + u128::from(usage.cache_read_input_tokens)
        + u128::from(usage.cache_creation_input_tokens)
}

/// Select one streaming record deterministically: valid event timestamps win over missing
/// timestamps, then later event timestamps, larger retained usage, visible content, model name,
/// and finally later file arrival. This keeps month assignment independent of JSONL arrival order
/// when records carry different event timestamps or usage totals.
fn should_replace_duplicate(
    previous: &RetainedAssistantUsage,
    candidate: &RetainedAssistantUsage,
) -> bool {
    match (previous.timestamp_ms, candidate.timestamp_ms) {
        (Some(previous), Some(candidate)) => match candidate.total_cmp(&previous) {
            std::cmp::Ordering::Greater => return true,
            std::cmp::Ordering::Less => return false,
            std::cmp::Ordering::Equal => {}
        },
        (None, Some(_)) => return true,
        (Some(_), None) => return false,
        (None, None) => {}
    }

    match usage_token_total(&candidate.usage).cmp(&usage_token_total(&previous.usage)) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }

    match candidate.is_visible.cmp(&previous.is_visible) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }

    match candidate.model.as_deref().cmp(&previous.model.as_deref()) {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => candidate.arrival_index > previous.arrival_index,
    }
}

/// Scan a JSONL file extracting only metrics-relevant fields.
/// Much faster than full parse — skips content block parsing, tool linking, etc.
pub fn scan_session_fast(file_path: &Path) -> Option<SessionSummary> {
    let file = std::fs::File::open(file_path).ok()?;
    let reader = BufReader::with_capacity(64 * 1024, file);

    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_read: u64 = 0;
    let mut cache_create: u64 = 0;
    let mut model_counts: HashMap<String, u32> = HashMap::new();
    let mut first_ts: Option<f64> = None;
    let mut last_ts: Option<f64> = None;
    let mut prev_ts: Option<f64> = None;
    let mut active_ms: f64 = 0.0;
    let mut tool_call_count: u64 = 0;
    let mut tool_error_count: u64 = 0;
    let mut assistant_message_count: u64 = 0;
    let mut first_user_text: Option<String> = None;
    let mut custom_title: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let entry: QuickEntry = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(_) => continue,
        };

        if custom_title.is_none() {
            if let Some(t) = entry.custom_title {
                custom_title = Some(t);
            }
        }

        if let Some(ref ts_str) = entry.timestamp {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts_str) {
                let ms = dt.timestamp_millis() as f64;
                if first_ts.is_none() {
                    first_ts = Some(ms);
                }
                last_ts = Some(ms);
                if let Some(prev) = prev_ts {
                    let diff = ms - prev;
                    if diff > 0.0 {
                        active_ms += diff.min(ACTIVE_GAP_CAP_MS);
                    }
                }
                prev_ts = Some(ms);
            }
        }

        let (role, model, usage) = if let Some(ref msg) = entry.message {
            (
                msg.role.as_deref(),
                msg.model.as_deref(),
                msg.usage.as_ref(),
            )
        } else {
            (
                entry.role.as_deref(),
                entry.model.as_deref(),
                entry.usage.as_ref(),
            )
        };

        if let Some(u) = usage {
            input_tokens += u.input_tokens.unwrap_or(0);
            output_tokens += u.output_tokens.unwrap_or(0);
            cache_read += u.cache_read_input_tokens.unwrap_or(0);
            cache_create += u.cache_creation_input_tokens.unwrap_or(0);
        }

        if role == Some("assistant") {
            assistant_message_count += 1;
            if let Some(m) = model {
                if !m.is_empty() && m != "<synthetic>" {
                    *model_counts.entry(m.to_string()).or_insert(0) += 1;
                }
            }
        }

        // Count tool_use / tool_result blocks in any content array.
        if let Some(ref msg) = entry.message {
            if let Some(content) = msg.content.as_ref() {
                if let Some(arr) = content.as_array() {
                    for block in arr {
                        let ty = block.get("type").and_then(|v| v.as_str());
                        if ty == Some("tool_use") {
                            tool_call_count += 1;
                        } else if ty == Some("tool_result")
                            && block.get("is_error").and_then(|v| v.as_bool()) == Some(true)
                        {
                            tool_error_count += 1;
                        }
                    }
                }
            }
        }

        if first_user_text.is_none()
            && role == Some("user")
            && entry.is_meta != Some(true)
            && entry.entry_type.as_deref() == Some("user")
        {
            if let Some(ref msg) = entry.message {
                if let Some(ref content) = msg.content {
                    let text = match content {
                        serde_json::Value::String(s) => Some(s.clone()),
                        serde_json::Value::Array(arr) => arr.iter().find_map(|block| {
                            if block.get("type")?.as_str()? == "text" {
                                block.get("text")?.as_str().map(|s| s.to_string())
                            } else {
                                None
                            }
                        }),
                        _ => None,
                    };
                    if let Some(t) = text {
                        let trimmed = t.trim();
                        if !trimmed.is_empty() && !trimmed.starts_with("<local-command") {
                            let preview = if trimmed.len() > 100 {
                                let mut end = 100;
                                while !trimmed.is_char_boundary(end) {
                                    end -= 1;
                                }
                                format!("{}...", &trimmed[..end])
                            } else {
                                trimmed.to_string()
                            };
                            first_user_text = Some(preview);
                        }
                    }
                }
            }
        }
    }

    let total = input_tokens + output_tokens + cache_read + cache_create;
    if total == 0 {
        return None;
    }

    // Match Go: highest count wins; ties broken by the alphabetically-smallest
    // name so the result is deterministic despite HashMap iteration order.
    let mut primary_model: Option<String> = None;
    let mut best_count: u32 = 0;
    for (m, c) in &model_counts {
        let better = match primary_model.as_ref() {
            None => true,
            Some(best) => *c > best_count || (*c == best_count && m < best),
        };
        if better {
            best_count = *c;
            primary_model = Some(m.clone());
        }
    }

    let duration_ms = match (first_ts, last_ts) {
        (Some(first), Some(last)) if last > first => last - first,
        _ => 0.0,
    };

    Some(SessionSummary {
        input_tokens,
        output_tokens,
        cache_read_tokens: cache_read,
        cache_creation_tokens: cache_create,
        duration_ms,
        model: primary_model,
        first_timestamp_ms: first_ts,
        last_timestamp_ms: last_ts,
        first_user_text,
        custom_title,
        tool_call_count,
        tool_error_count,
        assistant_message_count,
        active_ms,
    })
}

enum BoundedRecord {
    End,
    Valid,
    Oversized,
}

fn read_bounded_record(
    reader: &mut impl BufRead,
    record: &mut Vec<u8>,
) -> std::io::Result<BoundedRecord> {
    record.clear();
    let mut is_oversized = false;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return if is_oversized {
                Ok(BoundedRecord::Oversized)
            } else if record.is_empty() {
                Ok(BoundedRecord::End)
            } else {
                Ok(BoundedRecord::Valid)
            };
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(buffer.len(), |index| index + 1);
        let content_len = newline.unwrap_or(buffer.len());
        if !is_oversized {
            if record.len().saturating_add(content_len) <= LIGHT_SCAN_MAX_RECORD_BYTES {
                record.extend_from_slice(&buffer[..content_len]);
            } else {
                is_oversized = true;
                record.clear();
            }
        }
        reader.consume(consumed);
        if newline.is_some() {
            return if is_oversized {
                Ok(BoundedRecord::Oversized)
            } else {
                Ok(BoundedRecord::Valid)
            };
        }
    }
}

fn bounded_text(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn visible_text(content: Option<&LightContent>) -> Option<&str> {
    match content {
        Some(LightContent::Text(text)) => Some(text),
        Some(LightContent::Blocks(blocks)) => blocks.iter().find_map(|block| {
            (block.block_type.as_deref() == Some("text"))
                .then_some(block.text.as_deref())
                .flatten()
        }),
        Some(LightContent::Other(_)) | None => None,
    }
}

fn has_visible_text(content: Option<&LightContent>) -> bool {
    visible_text(content).is_some_and(|text| !text.trim().is_empty())
}

fn is_visible_user_text(content: Option<&LightContent>) -> bool {
    visible_text(content).is_some_and(|text| {
        let text = text.trim();
        !text.is_empty()
            && !text.starts_with("<local-command")
            && !text.starts_with("<system-reminder>")
            && !text.starts_with("<command-name>")
            && !text.starts_with("[Request interrupted by user")
    })
}

fn set_cost_failure(diagnostic: &mut Option<String>, message: &str) {
    if diagnostic.is_none() {
        *diagnostic = Some(bounded_text(message, LIGHT_DIAGNOSTIC_MAX_CHARS));
    }
}

fn checked_message_count(message_count: &mut u32, diagnostic: &mut Option<String>) {
    if let Some(next) = message_count.checked_add(1) {
        *message_count = next;
    } else {
        set_cost_failure(diagnostic, "visible message count overflowed");
    }
}

fn checked_usage_add(total: &mut LightUsage, usage: &LightUsage) -> bool {
    let Some(input_tokens) = total.input_tokens.checked_add(usage.input_tokens) else {
        return false;
    };
    let Some(output_tokens) = total.output_tokens.checked_add(usage.output_tokens) else {
        return false;
    };
    let Some(cache_read_input_tokens) = total
        .cache_read_input_tokens
        .checked_add(usage.cache_read_input_tokens)
    else {
        return false;
    };
    let Some(cache_creation_input_tokens) = total
        .cache_creation_input_tokens
        .checked_add(usage.cache_creation_input_tokens)
    else {
        return false;
    };
    total.input_tokens = input_tokens;
    total.output_tokens = output_tokens;
    total.cache_read_input_tokens = cache_read_input_tokens;
    total.cache_creation_input_tokens = cache_creation_input_tokens;
    true
}

pub fn scan_session_light(file_path: &Path) -> Option<LightSessionSummary> {
    #[cfg(test)]
    LIGHT_SCAN_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let file = std::fs::File::open(file_path).ok()?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut assistant_by_request = HashMap::new();
    let mut independent_assistants = Vec::new();
    let mut model_counts: HashMap<String, u32> = HashMap::new();
    let mut first_timestamp = None;
    let mut first_assistant_timestamp = None;
    let mut first_user_text = None;
    let mut custom_title = None;
    let mut agent_name = None;
    let mut user_message_count = 0;
    let mut cost_diagnostic = None;
    let mut record = Vec::new();
    let mut arrival_index = 0;

    loop {
        match read_bounded_record(&mut reader, &mut record) {
            Ok(BoundedRecord::End) => break,
            Ok(BoundedRecord::Oversized) => {
                set_cost_failure(&mut cost_diagnostic, "oversized JSONL record skipped");
                continue;
            }
            Ok(BoundedRecord::Valid) => {}
            Err(error) => {
                set_cost_failure(
                    &mut cost_diagnostic,
                    &format!("failed reading JSONL record: {error}"),
                );
                break;
            }
        }
        if record.is_empty() {
            continue;
        }
        let entry = match serde_json::from_slice::<LightEntry>(&record) {
            Ok(entry) => entry,
            Err(_) => {
                set_cost_failure(&mut cost_diagnostic, "malformed JSONL record skipped");
                continue;
            }
        };

        if custom_title.is_none() {
            custom_title = entry
                .custom_title
                .as_deref()
                .map(|title| bounded_text(title, LIGHT_METADATA_MAX_CHARS));
        }
        if agent_name.is_none() {
            agent_name = entry
                .agent_name
                .as_deref()
                .map(|name| bounded_text(name, LIGHT_METADATA_MAX_CHARS));
        }
        if entry.is_sidechain || entry.is_compact_summary {
            continue;
        }

        let Some(message) = entry.message.as_ref() else {
            continue;
        };
        let role = message.role.as_deref();
        if role == Some("user")
            && entry.entry_type.as_deref() == Some("user")
            && !entry.is_meta
            && is_visible_user_text(message.content.as_ref())
        {
            checked_message_count(&mut user_message_count, &mut cost_diagnostic);
            if first_user_text.is_none() {
                first_user_text = visible_text(message.content.as_ref())
                    .map(str::trim)
                    .map(|text| bounded_text(text, LIGHT_TEXT_MAX_CHARS));
                first_timestamp = entry
                    .timestamp
                    .as_deref()
                    .filter(|timestamp| chrono::DateTime::parse_from_rfc3339(timestamp).is_ok())
                    .map(|timestamp| bounded_text(timestamp, LIGHT_METADATA_MAX_CHARS));
            }
            continue;
        }
        if role != Some("assistant") || entry.entry_type.as_deref() != Some("assistant") {
            continue;
        }

        let timestamp_ms = entry.timestamp.as_deref().and_then(|timestamp| {
            chrono::DateTime::parse_from_rfc3339(timestamp)
                .ok()
                .map(|parsed| parsed.timestamp_millis() as f64)
        });
        let is_visible = has_visible_text(message.content.as_ref());
        if is_visible && first_assistant_timestamp.is_none() {
            first_assistant_timestamp = entry
                .timestamp
                .as_deref()
                .filter(|timestamp| chrono::DateTime::parse_from_rfc3339(timestamp).is_ok())
                .map(|timestamp| bounded_text(timestamp, LIGHT_METADATA_MAX_CHARS));
        }
        arrival_index += 1;
        let retained = RetainedAssistantUsage {
            model: message.model.clone(),
            timestamp_ms,
            usage: message.usage.clone().unwrap_or_default(),
            is_visible,
            arrival_index,
        };
        if let Some(request_id) = entry.request_id.filter(|request_id| !request_id.is_empty()) {
            if let Some(previous) = assistant_by_request.get(&request_id) {
                if should_replace_duplicate(previous, &retained) {
                    let was_visible = previous.is_visible;
                    assistant_by_request.insert(
                        request_id,
                        RetainedAssistantUsage {
                            is_visible: was_visible || is_visible,
                            ..retained
                        },
                    );
                } else if is_visible && !previous.is_visible {
                    let mut retained_previous = previous.clone();
                    retained_previous.is_visible = true;
                    assistant_by_request.insert(request_id, retained_previous);
                }
            } else {
                assistant_by_request.insert(request_id, retained);
            }
        } else if is_visible {
            independent_assistants.push(retained);
        }
    }

    let retained_assistants: Vec<_> = assistant_by_request
        .into_values()
        .filter(|assistant| assistant.is_visible)
        .chain(independent_assistants)
        .collect();
    let message_count = usize::try_from(user_message_count)
        .ok()
        .and_then(|users| users.checked_add(retained_assistants.len()))
        .and_then(|count| u32::try_from(count).ok())
        .unwrap_or_else(|| {
            set_cost_failure(&mut cost_diagnostic, "visible message count overflowed");
            u32::MAX
        });

    let mut cost_buckets: HashMap<(Option<String>, bool), (LightUsage, Option<f64>)> =
        HashMap::new();
    let mut assistant_usage = Vec::with_capacity(retained_assistants.len());
    for assistant in retained_assistants {
        if let Some(model) = assistant
            .model
            .as_ref()
            .filter(|model| !model.is_empty() && model.as_str() != "<synthetic>")
        {
            *model_counts.entry(model.clone()).or_insert(0) += 1;
        }
        let is_sonnet_5_promo = assistant
            .model
            .as_deref()
            .is_some_and(|model| model.to_ascii_lowercase().contains("sonnet-5"))
            && assistant
                .timestamp_ms
                .is_some_and(|timestamp| timestamp < 1_788_220_800_000.0);
        let key = (assistant.model.clone(), is_sonnet_5_promo);
        let bucket = cost_buckets
            .entry(key)
            .or_insert_with(|| (LightUsage::default(), assistant.timestamp_ms));
        if !checked_usage_add(&mut bucket.0, &assistant.usage) {
            set_cost_failure(&mut cost_diagnostic, "assistant token usage overflowed");
        }

        let priced_usage_usd = if usage_token_total(&assistant.usage) == 0 {
            None
        } else {
            let cost = super::cost::estimate_cost_at(
                assistant.model.as_deref(),
                assistant.usage.input_tokens,
                assistant.usage.output_tokens,
                assistant.usage.cache_read_input_tokens,
                assistant.usage.cache_creation_input_tokens,
                assistant.timestamp_ms,
            );
            if cost.is_finite() {
                Some(cost)
            } else {
                set_cost_failure(
                    &mut cost_diagnostic,
                    "estimated assistant cost was non-finite",
                );
                None
            }
        };
        assistant_usage.push(DeduplicatedAssistantUsage {
            event_timestamp_ms: assistant.timestamp_ms,
            priced_usage_usd,
        });
    }

    let model = model_counts
        .into_iter()
        .max_by(|(left_model, left_count), (right_model, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| right_model.cmp(left_model))
        })
        .map(|(model, _)| model);
    let has_tokens = cost_buckets.values().any(|(usage, _)| {
        usage.input_tokens > 0
            || usage.output_tokens > 0
            || usage.cache_read_input_tokens > 0
            || usage.cache_creation_input_tokens > 0
    });
    let cost_usd = if cost_diagnostic.is_some() || !has_tokens {
        None
    } else {
        let cost = cost_buckets
            .into_iter()
            .map(|((model, _), (usage, timestamp_ms))| {
                super::cost::estimate_cost_at(
                    model.as_deref(),
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.cache_read_input_tokens,
                    usage.cache_creation_input_tokens,
                    timestamp_ms,
                )
            })
            .sum::<f64>();
        if cost.is_finite() {
            Some(cost)
        } else {
            set_cost_failure(
                &mut cost_diagnostic,
                "estimated session cost was non-finite",
            );
            None
        }
    };

    Some(LightSessionSummary {
        model,
        first_timestamp: first_timestamp.or(first_assistant_timestamp),
        first_user_text,
        custom_title,
        agent_name,
        message_count,
        cost_usd,
        cost_diagnostic,
        assistant_usage,
    })
}

/// Compute gap-adjusted active milliseconds across a sorted timestamp list.
/// Consecutive gaps longer than `ACTIVE_GAP_CAP_MS` are treated as idle.
pub fn active_ms_from_sorted(timestamps_ms: &[f64]) -> f64 {
    let mut total = 0.0;
    for pair in timestamps_ms.windows(2) {
        let diff = pair[1] - pair[0];
        if diff > 0.0 {
            total += diff.min(ACTIVE_GAP_CAP_MS);
        }
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_ms_empty_and_single() {
        assert_eq!(active_ms_from_sorted(&[]), 0.0);
        assert_eq!(active_ms_from_sorted(&[100.0]), 0.0);
    }

    #[test]
    fn active_ms_sum_uncapped() {
        // Gaps 1000, 2000 → 3000ms active
        let stamps = [0.0, 1000.0, 3000.0];
        assert_eq!(active_ms_from_sorted(&stamps), 3000.0);
    }

    #[test]
    fn active_ms_caps_long_idle_gap() {
        // Gap 1hr is capped at ACTIVE_GAP_CAP_MS (5min), small gap counts fully.
        let stamps = [0.0, 1000.0, 1000.0 + 3_600_000.0];
        let got = active_ms_from_sorted(&stamps);
        assert!((got - (1000.0 + ACTIVE_GAP_CAP_MS)).abs() < 1e-9);
    }
}

#[cfg(test)]
#[path = "session_scan_light_tests.rs"]
mod light_tests;
