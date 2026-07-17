//! Parity canon helper — the Rust side of the parity harness (Strategy §2).
//!
//! Mirrors Go's `internal/domain/marshal_test.go:canon`: normalize JSON so that
//! byte-for-byte comparison ignores map-key order and integer-vs-float spelling.
//! `serde_json`'s default `Map` is a `BTreeMap`, so re-serialization already sorts
//! keys; `coerce` additionally maps every number to `f64` so Go's `0` and
//! `serde_json`'s `0.0` normalize to the same token.
//!
//! INVARIANT: both operands of a parity comparison must pass through THIS canon.
//! Never compare a Go-canon string against a Rust-canon string.

use serde::Serialize;
use serde_json::Value;

/// Canonicalize a serializable value.
pub fn canon<T: Serialize>(v: &T) -> String {
    let value = serde_json::to_value(v).expect("canon: to_value");
    serde_json::to_string(&coerce(value)).expect("canon: to_string")
}

/// Canonicalize a JSON string (e.g. a Go-produced golden), through the same path.
pub fn canon_str(s: &str) -> String {
    let value: Value = serde_json::from_str(s).expect("canon_str: parse");
    serde_json::to_string(&coerce(value)).expect("canon_str: to_string")
}

fn coerce(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::from(n.as_f64().unwrap_or(0.0)),
        Value::Array(a) => Value::Array(a.into_iter().map(coerce).collect()),
        Value::Object(m) => Value::Object(m.into_iter().map(|(k, v)| (k, coerce(v))).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coerces_int_and_float_alike() {
        // Go emits `0`, serde emits `0.0`; canon collapses both.
        assert_eq!(canon_str("0"), canon_str("0.0"));
        assert_eq!(canon_str(r#"{"a":1,"b":2.0}"#), canon_str(r#"{"b":2,"a":1.0}"#));
    }

    #[test]
    fn sorts_map_keys() {
        // serde_json Map = BTreeMap (no preserve_order) → sorted on re-serialize.
        assert_eq!(canon_str(r#"{"b":1,"a":2}"#), r#"{"a":2.0,"b":1.0}"#);
    }
}
