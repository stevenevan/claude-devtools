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
            if let Some(m) = model {
                if !m.is_empty() && m != "<synthetic>" {
                    *model_counts.entry(m.to_string()).or_insert(0) += 1;
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

    let primary_model = model_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(m, _)| m);

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
    })
}
