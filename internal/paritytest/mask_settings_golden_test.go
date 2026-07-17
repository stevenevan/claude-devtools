package paritytest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/files"
)

// maskSettingsGoldenPath is shared with the Rust cargo test
// (src-tauri/src/files/secret_export.rs::mask_settings_matches_go_golden), which
// loads the same JSON and asserts mask_settings_secrets(input) == masked for
// every case. Proves the Rust secret masker + Go-compatible JSON escaping
// byte-match Go's MaskSettingsSecrets — the W12 "masked reads identical" gate.
const maskSettingsGoldenPath = "testdata/mask_settings.golden.json"

// maskSettingsInputs are synthetic settings.json documents only — never real
// ~/.claude content. Cover: secret-shaped env keys, secret-shaped values,
// non-secret passthrough, nested objects, and HTML-escapable chars (&&, >, <)
// that Go's encoder escapes and the Rust port must reproduce.
var maskSettingsInputs = []string{
	`{"env":{"API_KEY":"sk-live-abc123","EDITOR":"vim"}}`,
	`{"permissions":{"allow":["Bash(grep <x> && echo >f)"]},"env":{"TOKEN":"ghp_secretvalue"}}`,
	`{"env":{"AWS_ACCESS_KEY":"AKIAIOSFODNN7EXAMPLE","REGION":"us-east-1"}}`,
	`{"nested":{"deep":{"PASSWORD":"hunter2","note":"plain & safe"}}}`,
	`{"value":"eyJhbGciOiJ.payload","plain":"no secret here"}`,
}

type maskSettingsCase struct {
	Input  string `json:"input"`
	Masked string `json:"masked"`
}

func TestMaskSettingsGolden(t *testing.T) {
	cases := make([]maskSettingsCase, len(maskSettingsInputs))
	for i, in := range maskSettingsInputs {
		masked, err := files.MaskSettingsSecrets([]byte(in))
		if err != nil {
			t.Fatalf("MaskSettingsSecrets(%q): %v", in, err)
		}
		cases[i] = maskSettingsCase{Input: in, Masked: string(masked)}
	}
	got, err := json.MarshalIndent(cases, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	golden := filepath.Clean(maskSettingsGoldenPath)
	if os.Getenv("GEN_GOLDENS") == "1" {
		if err := os.WriteFile(golden, append(got, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s", golden)
		return
	}
	want, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("read golden (run with GEN_GOLDENS=1 to create): %v", err)
	}
	if string(got)+"\n" != string(want) {
		t.Errorf("mask settings golden mismatch; regenerate with GEN_GOLDENS=1")
	}
}
