//! Go-compatible JSON serialization for the write spine.
//!
//! Go's `encoding/json` escapes `<`, `>`, `&` to `<`, `>`, `&`
//! and the line/paragraph separators U+2028/U+2029 by default (HTML-safe
//! encoding); `serde_json` does not. Settings/hook writes must byte-match the
//! Go reference (hook commands routinely contain `&&`, `>`, `<`), so we apply
//! Go's escaping after serializing. These bytes only ever appear inside JSON
//! string values — never as structural tokens — so a byte-level substitution on
//! the finished document reproduces Go's encoder exactly.

use serde::Serialize;

/// `json.MarshalIndent(v, "", "  ")` — 2-space indent + Go HTML escaping.
pub(crate) fn to_go_json_pretty<T: Serialize>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec_pretty(value).map(|b| escape_html_go(&b))
}

/// `to_go_json_pretty` as a `String` (masked-read display path). The escaped
/// output is always valid UTF-8.
pub(crate) fn to_go_json_pretty_string<T: Serialize>(
    value: &T,
) -> Result<String, serde_json::Error> {
    to_go_json_pretty(value).map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Applies Go's default HTML escaping to already-serialized JSON bytes:
/// `<`→`<`, `>`→`>`, `&`→`&`, U+2028→` `, U+2029→` `.
pub(crate) fn escape_html_go(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        match input[i] {
            b'<' => out.extend_from_slice(b"\\u003c"),
            b'>' => out.extend_from_slice(b"\\u003e"),
            b'&' => out.extend_from_slice(b"\\u0026"),
            // U+2028 = E2 80 A8, U+2029 = E2 80 A9
            0xE2 if input.get(i + 1) == Some(&0x80)
                && matches!(input.get(i + 2), Some(0xA8) | Some(0xA9)) =>
            {
                out.extend_from_slice(if input[i + 2] == 0xA8 {
                    b"\\u2028"
                } else {
                    b"\\u2029"
                });
                i += 3;
                continue;
            }
            b => out.push(b),
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_html_chars_like_go() {
        let v = serde_json::json!({ "cmd": "grep <x> && echo >f" });
        let got = String::from_utf8(escape_html_go(&serde_json::to_vec(&v).unwrap())).unwrap();
        assert_eq!(got, r#"{"cmd":"grep \u003cx\u003e \u0026\u0026 echo \u003ef"}"#);
    }

    #[test]
    fn escapes_line_separators() {
        let v = serde_json::json!({ "a": "x\u{2028}y\u{2029}z" });
        let got = String::from_utf8(escape_html_go(&serde_json::to_vec(&v).unwrap())).unwrap();
        assert_eq!(got, r#"{"a":"x\u2028y\u2029z"}"#);
    }

    #[test]
    fn pretty_indent_is_two_spaces() {
        let v = serde_json::json!({ "a": 1 });
        let got = String::from_utf8(to_go_json_pretty(&v).unwrap()).unwrap();
        assert_eq!(got, "{\n  \"a\": 1\n}");
    }
}
