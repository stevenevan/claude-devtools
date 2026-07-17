//! Unit tests for the config-export secret strippers (no Go sibling test exists;
//! these pin the documented masking contract they share with the claudejson
//! inspector).

use super::*;
use crate::files::claudejson::CLAUDE_JSON_MASK;

// W12 "masked reads identical" gate: loads the shared golden the Go paritytest
// generates (internal/paritytest/testdata/mask_settings.golden.json) and asserts
// mask_settings_secrets(input) is byte-identical to Go's MaskSettingsSecrets —
// including Go's HTML escaping of `<`, `>`, `&`.
#[test]
fn mask_settings_matches_go_golden() {
    #[derive(serde::Deserialize)]
    struct Case {
        input: String,
        masked: String,
    }
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../internal/paritytest/testdata/mask_settings.golden.json"
    );
    let raw = std::fs::read_to_string(path).unwrap_or_else(|e| {
        panic!("read {path} (run: GEN_GOLDENS=1 go test ./internal/paritytest -run TestMaskSettingsGolden): {e}")
    });
    let cases: Vec<Case> = serde_json::from_str(&raw).expect("parse mask_settings.golden.json");
    assert!(!cases.is_empty(), "no mask cases");
    for c in &cases {
        let got = String::from_utf8(mask_settings_secrets(c.input.as_bytes()).unwrap()).unwrap();
        assert_eq!(got, c.masked, "mask mismatch for input {:?}", c.input);
    }
}

#[test]
fn mask_settings_secrets_strips_key_and_value() {
    let input = br#"{"env":{"API_KEY":"secretval"},"model":"claude-3","token":"sk-abc123"}"#;
    let out = mask_settings_secrets(input).unwrap();
    let s = String::from_utf8(out).unwrap();

    assert!(s.contains(CLAUDE_JSON_MASK), "expected masked output");
    assert!(!s.contains("secretval"), "secret-key value leaked: {s}");
    assert!(!s.contains("sk-abc123"), "token-shaped value leaked: {s}");
    assert!(s.contains("claude-3"), "non-secret value dropped: {s}");
    // 2-space pretty output (matches json.MarshalIndent).
    assert!(s.contains("\n  \""), "output is not 2-space pretty-printed: {s}");
}

#[test]
fn mask_settings_secrets_rejects_bad_json() {
    assert!(mask_settings_secrets(b"{not json").is_err());
}

#[test]
fn redact_secret_line_masks_token_shaped() {
    let (out, redacted) = redact_secret_line("export TOKEN=\"sk-live-secret\"");
    assert!(redacted, "expected redaction");
    assert!(out.contains(CLAUDE_JSON_MASK));
    assert!(!out.contains("sk-live-secret"), "token leaked: {out}");
    assert!(out.contains("export"), "surrounding text dropped: {out}");
}

#[test]
fn redact_secret_line_leaves_plain_untouched() {
    let (out, redacted) = redact_secret_line("just a normal config line");
    assert!(!redacted);
    assert_eq!(out, "just a normal config line");
}

#[test]
fn redact_secret_line_replaces_whole_token() {
    let (out, redacted) = redact_secret_line("key=github_pat_abc123def");
    assert!(redacted);
    assert_eq!(out, format!("key={CLAUDE_JSON_MASK}"), "must replace the WHOLE token");
}
