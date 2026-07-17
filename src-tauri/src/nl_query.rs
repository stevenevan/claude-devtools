/// Natural language → ParsedFilter (sprint 43, lexical only).
///
/// Supports a small intent vocabulary:
///   - `last N (day[s]|week[s]|month[s])`     → date_min
///   - `using <tool>`                          → agent_name
///   - `over $X` / `over $X.YY`                → min_cost
///   - `with errors`                           → has_errors
///   - `containing "text"` / `containing X`    → text_query
///   - `by <author>`                           → author
///
/// Unsupported phrases yield a default-filled ParsedFilter; the
/// frontend renders chips for any populated field.

use serde::{Deserialize, Serialize};

const MS_PER_DAY: f64 = 86_400_000.0;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_cost: Option<f64>,
    #[serde(default)]
    pub has_errors: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
}

fn parse_relative_window(query: &str, now_ms: f64) -> Option<f64> {
    let lower = query.to_lowercase();
    let bytes = lower.as_bytes();
    let last_idx = lower.find("last ")?;
    let after = &lower[last_idx + 5..];
    let num_end = after
        .char_indices()
        .find(|(_, ch)| !ch.is_ascii_digit())
        .map(|(i, _)| i)
        .unwrap_or(after.len());
    if num_end == 0 {
        return None;
    }
    let n: u64 = after[..num_end].parse().ok()?;
    let rest = after[num_end..].trim_start();
    let multiplier_days = if rest.starts_with("month") {
        30u64
    } else if rest.starts_with("week") {
        7u64
    } else if rest.starts_with("day") {
        1u64
    } else {
        return None;
    };
    let _ = bytes; // silence unused warning under all features
    Some(now_ms - (n as f64) * (multiplier_days as f64) * MS_PER_DAY)
}

fn parse_keyword_value<'a>(query: &'a str, prefix: &str) -> Option<&'a str> {
    let lower = query.to_ascii_lowercase();
    let idx = lower.find(prefix)?;
    let start = idx + prefix.len();
    let rest = &query[start..];
    let token_end = rest
        .find(|c: char| c.is_whitespace() && !rest.starts_with('"'))
        .unwrap_or(rest.len());
    let token = rest[..token_end].trim().trim_matches('"');
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

fn parse_dollar_amount(query: &str) -> Option<f64> {
    let lower = query.to_lowercase();
    let idx = lower.find("over $")?;
    let after = &query[idx + 6..];
    let mut end = 0;
    let mut seen_dot = false;
    for (i, ch) in after.char_indices() {
        if ch.is_ascii_digit() {
            end = i + ch.len_utf8();
        } else if ch == '.' && !seen_dot {
            seen_dot = true;
            end = i + ch.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        return None;
    }
    after[..end].parse().ok()
}

fn parse_quoted_or_word_after<'a>(query: &'a str, prefix: &str) -> Option<&'a str> {
    let lower = query.to_ascii_lowercase();
    let idx = lower.find(prefix)?;
    let after = &query[idx + prefix.len()..];
    let trimmed = after.trim_start();
    if trimmed.starts_with('"') {
        let rest = &trimmed[1..];
        let close = rest.find('"')?;
        let value = &rest[..close];
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    } else {
        let end = trimmed
            .find(|c: char| c.is_whitespace())
            .unwrap_or(trimmed.len());
        let value = &trimmed[..end];
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }
}

pub fn parse_query(query: &str, now_ms: f64) -> ParsedFilter {
    let mut filter = ParsedFilter::default();

    if let Some(date_min) = parse_relative_window(query, now_ms) {
        filter.date_min = Some(date_min);
    }
    if let Some(tool) = parse_keyword_value(query, "using ") {
        filter.agent_name = Some(tool.to_string());
    }
    if let Some(cost) = parse_dollar_amount(query) {
        filter.min_cost = Some(cost);
    }
    if query.to_lowercase().contains("with errors") {
        filter.has_errors = true;
    }
    if let Some(text) = parse_quoted_or_word_after(query, "containing ") {
        filter.text_query = Some(text.to_string());
    }
    if let Some(author) = parse_keyword_value(query, "by ") {
        filter.author = Some(author.to_string());
    }

    filter
}

#[tauri::command]
pub fn parse_nl_query(query: String) -> Result<ParsedFilter, String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Ok(parse_query(&query, now_ms))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: f64 = 1_000_000_000_000.0;

    fn approx_eq(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.5
    }

    #[test]
    fn last_week_sets_date_min() {
        let f = parse_query("show me last 1 week", NOW);
        assert!(f.date_min.is_some());
        assert!(approx_eq(f.date_min.unwrap(), NOW - 7.0 * MS_PER_DAY));
    }

    #[test]
    fn last_n_days_handles_plural_and_singular() {
        let f1 = parse_query("last 3 days", NOW);
        assert!(approx_eq(f1.date_min.unwrap(), NOW - 3.0 * MS_PER_DAY));
        let f2 = parse_query("last 1 day", NOW);
        assert!(approx_eq(f2.date_min.unwrap(), NOW - MS_PER_DAY));
    }

    #[test]
    fn last_months_uses_30_day_approximation() {
        let f = parse_query("last 2 months", NOW);
        assert!(approx_eq(f.date_min.unwrap(), NOW - 60.0 * MS_PER_DAY));
    }

    #[test]
    fn using_tool_sets_agent_name() {
        let f = parse_query("sessions using Bash", NOW);
        assert_eq!(f.agent_name.as_deref(), Some("Bash"));
    }

    #[test]
    fn over_dollar_sets_min_cost() {
        let f = parse_query("over $0.5 in cost", NOW);
        assert_eq!(f.min_cost, Some(0.5));
    }

    #[test]
    fn with_errors_flags_has_errors() {
        let f = parse_query("sessions with errors yesterday", NOW);
        assert!(f.has_errors);
    }

    #[test]
    fn containing_quoted_text_extracts_value() {
        let f = parse_query("containing \"timeout error\"", NOW);
        assert_eq!(f.text_query.as_deref(), Some("timeout error"));
    }

    #[test]
    fn containing_unquoted_word() {
        let f = parse_query("containing TODO others", NOW);
        assert_eq!(f.text_query.as_deref(), Some("TODO"));
    }

    #[test]
    fn by_author_sets_author() {
        let f = parse_query("by alice", NOW);
        assert_eq!(f.author.as_deref(), Some("alice"));
    }

    #[test]
    fn unsupported_phrase_returns_default() {
        let f = parse_query("hello world", NOW);
        assert_eq!(f, ParsedFilter::default());
    }

    #[test]
    fn combined_phrase_populates_multiple_fields() {
        let f = parse_query(
            "last 7 days using Bash with errors containing \"oom\" by alice over $1",
            NOW,
        );
        assert!(approx_eq(f.date_min.unwrap(), NOW - 7.0 * MS_PER_DAY));
        assert_eq!(f.agent_name.as_deref(), Some("Bash"));
        assert!(f.has_errors);
        assert_eq!(f.text_query.as_deref(), Some("oom"));
        assert_eq!(f.author.as_deref(), Some("alice"));
        assert_eq!(f.min_cost, Some(1.0));
    }
}
