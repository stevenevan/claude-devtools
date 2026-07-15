// secret_export.go adds the two exported secret-stripping helpers config
// export needs. internal/configbackup cannot reach the package-private
// maskJSONValue / secretValuePattern / claudeJSONMask primitives, so these
// wrappers surface them: MaskSettingsSecrets strips a whole settings.json (key
// name AND value shape, recursively) and RedactSecretLine strips token-shaped
// secrets from one line of a plaintext instruction/agent/memory/skill file.
// Both reuse the exact shapes the ~/.claude.json inspector masks.
package files

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// secretTokenSplit carves a text line into the delimiter-bounded tokens a
// pasted credential typically appears as (splitting on whitespace and the
// characters that commonly wrap a value: quotes, =, :, parens, comma), so each
// token can be tested whole against secretValuePattern the same way a JSON
// string value is — and the WHOLE matched token is replaced, not just its
// recognizable prefix.
var secretTokenSplit = regexp.MustCompile(`[^\s"'=:(),]+`)

// MaskSettingsSecrets parses raw as JSON and returns it re-marshaled with every
// credential-shaped key or value replaced by the mask placeholder (recursively,
// via maskJSONValue). Used by config export to strip settings.json.env values
// and token-shaped strings from a default (secrets-excluded) archive.
func MaskSettingsSecrets(raw []byte) ([]byte, error) {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, fmt.Errorf("files: parse settings for masking: %w", err)
	}
	out, err := json.MarshalIndent(maskJSONValue("", root), "", "  ")
	if err != nil {
		return nil, fmt.Errorf("files: marshal masked settings: %w", err)
	}
	return out, nil
}

// RedactSecretLine scans line for a token-shaped secret and, if it finds one,
// returns the line with each matched token replaced by the mask placeholder
// plus true; otherwise it returns the line unchanged plus false. Each
// delimiter-bounded token is tested whole against secretValuePattern (the same
// value-shape check maskJSONValue applies to a JSON value). Used by config
// export to redact secrets pasted into plaintext files.
func RedactSecretLine(line string) (string, bool) {
	redacted := false
	out := secretTokenSplit.ReplaceAllStringFunc(line, func(tok string) string {
		if secretValuePattern.MatchString(tok) {
			redacted = true
			return claudeJSONMask
		}
		return tok
	})
	return out, redacted
}
