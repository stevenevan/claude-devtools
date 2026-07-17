//! Ports `internal/files/secret_export.go` — the two exported secret-stripping
//! helpers config export (W14 configbackup) needs. They reuse the exact masking
//! shapes the `~/.claude.json` inspector applies: `mask_settings_secrets` strips
//! a whole settings.json (key name AND value shape, recursively);
//! `redact_secret_line` strips token-shaped secrets from one plaintext line.
//! Both stay `pub` because configbackup calls them.

use std::sync::LazyLock;

use regex::{Captures, Regex};
use serde_json::Value;

use super::claudejson::{mask_json_value, CLAUDE_JSON_MASK, SECRET_VALUE_PATTERN};

/// Carves a text line into the delimiter-bounded tokens a pasted credential
/// typically appears as (splitting on whitespace and the chars that commonly wrap
/// a value: quotes, `=`, `:`, parens, comma), so each token can be tested whole
/// against `SECRET_VALUE_PATTERN` the same way a JSON string value is — and the
/// WHOLE matched token is replaced, not just its recognizable prefix.
static SECRET_TOKEN_SPLIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[^\s"'=:(),]+"#).unwrap());

/// Parses `raw` as JSON and returns it re-marshaled with every credential-shaped
/// key or value replaced by the mask (recursively). Used by config export to
/// strip settings.json.env values and token-shaped strings from a default
/// (secrets-excluded) archive.
pub fn mask_settings_secrets(raw: &[u8]) -> Result<Vec<u8>, String> {
    let root: Value = serde_json::from_slice(raw)
        .map_err(|e| format!("files: parse settings for masking: {e}"))?;
    crate::files::json_util::to_go_json_pretty(&mask_json_value("", &root))
        .map_err(|e| format!("files: marshal masked settings: {e}"))
}

/// Scans `line` for token-shaped secrets and, if any are found, returns the line
/// with each matched token replaced by the mask plus `true`; otherwise the line
/// unchanged plus `false`. Each delimiter-bounded token is tested whole against
/// `SECRET_VALUE_PATTERN` (the same value-shape check the masker applies).
pub fn redact_secret_line(line: &str) -> (String, bool) {
    let mut redacted = false;
    let out = SECRET_TOKEN_SPLIT.replace_all(line, |caps: &Captures| {
        let tok = &caps[0];
        if SECRET_VALUE_PATTERN.is_match(tok) {
            redacted = true;
            CLAUDE_JSON_MASK.to_string()
        } else {
            tok.to_string()
        }
    });
    (out.into_owned(), redacted)
}

#[cfg(test)]
#[path = "secret_export_tests.rs"]
mod secret_export_tests;
