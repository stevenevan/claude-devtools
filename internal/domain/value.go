package domain

import "encoding/json"

// RawValue is the Go stand-in for serde_json::Value: a verbatim JSON passthrough.
// The parity harness key-sorts both sides recursively before diffing, so object
// key order inside a RawValue does not affect the gate.
type RawValue = json.RawMessage
