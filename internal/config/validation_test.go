// Ports all Rust #[test] from src-tauri/src/config/validation/tests.rs.
package config

import (
	"encoding/json"
	"testing"
)

func mustJSON(v interface{}) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func TestValidGeneralUpdate(t *testing.T) {
	data := mustJSON(map[string]interface{}{"theme": "light", "launchAtLogin": true})
	_, _, err := ValidateConfigUpdate("general", data)
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestRejectInvalidTheme(t *testing.T) {
	data := mustJSON(map[string]interface{}{"theme": "neon"})
	_, _, err := ValidateConfigUpdate("general", data)
	if err == nil {
		t.Fatal("expected error for invalid theme")
	}
}

func TestRejectUnknownSection(t *testing.T) {
	data := mustJSON(map[string]interface{}{})
	_, _, err := ValidateConfigUpdate("unknown", data)
	if err == nil {
		t.Fatal("expected error for unknown section")
	}
}

func TestRejectUnknownNotificationKey(t *testing.T) {
	data := mustJSON(map[string]interface{}{"unknownKey": true})
	_, _, err := ValidateConfigUpdate("notifications", data)
	if err == nil {
		t.Fatal("expected error for unknown notification key")
	}
}

func TestNullClaudeRootPath(t *testing.T) {
	data := mustJSON(map[string]interface{}{"claudeRootPath": nil})
	_, validated, err := ValidateConfigUpdate("general", data)
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(validated, &obj); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	if string(obj["claudeRootPath"]) != "null" {
		t.Fatalf("expected null, got %s", obj["claudeRootPath"])
	}
}

func TestDisplayBooleanValidation(t *testing.T) {
	data := mustJSON(map[string]interface{}{"showTimestamps": "yes"})
	_, _, err := ValidateConfigUpdate("display", data)
	if err == nil {
		t.Fatal("expected error for non-boolean display field")
	}
}

func TestValidDisplayUpdate(t *testing.T) {
	data := mustJSON(map[string]interface{}{"compactMode": true})
	_, _, err := ValidateConfigUpdate("display", data)
	if err != nil {
		t.Fatalf("expected ok, got: %v", err)
	}
}

func TestHTTPServerPortRange(t *testing.T) {
	data := mustJSON(map[string]interface{}{"port": 80})
	_, _, err := ValidateConfigUpdate("httpServer", data)
	if err == nil {
		t.Fatal("expected error for port 80")
	}

	data = mustJSON(map[string]interface{}{"port": 3000})
	_, _, err = ValidateConfigUpdate("httpServer", data)
	if err != nil {
		t.Fatalf("expected ok for port 3000, got: %v", err)
	}
}

func TestSnoozeMinutesRange(t *testing.T) {
	data := mustJSON(map[string]interface{}{"snoozeMinutes": 0})
	_, _, err := ValidateConfigUpdate("notifications", data)
	if err == nil {
		t.Fatal("expected error for snoozeMinutes=0")
	}

	data = mustJSON(map[string]interface{}{"snoozeMinutes": 60})
	_, _, err = ValidateConfigUpdate("notifications", data)
	if err != nil {
		t.Fatalf("expected ok for snoozeMinutes=60, got: %v", err)
	}
}
