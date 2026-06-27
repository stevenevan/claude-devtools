// Package config — triggers ports src-tauri/src/config/triggers.rs.
// Contains: DefaultTriggers, MergeTriggers, ValidateTrigger, ValidateRegexPattern, InferMode.
package config

import (
	"fmt"
	"regexp"

	"claude-devtools/internal/ptr"
)

const maxPatternLength = 100

// DefaultTriggers mirrors triggers::default_triggers() in Rust.
func DefaultTriggers() []NotificationTrigger {
	return []NotificationTrigger{
		{
			ID:           "builtin-bash-command",
			Name:         ".env File Access Alert",
			Enabled:      false,
			ContentType:  "tool_use",
			Mode:         "content_match",
			MatchPattern: ptr.To("/.env"),
			IsBuiltin:    ptr.To(true),
			Color:        ptr.To("red"),
		},
		{
			ID:           "builtin-tool-result-error",
			Name:         "Tool Result Error",
			Enabled:      false,
			ContentType:  "tool_result",
			Mode:         "error_status",
			RequireError: ptr.To(true),
			IgnorePatterns: ptr.To([]string{
				`The user doesn't want to proceed with this tool use\.`,
				`\[Request interrupted by user for tool use\]`,
			}),
			IsBuiltin: ptr.To(true),
			Color:     ptr.To("orange"),
		},
		{
			ID:             "builtin-high-token-usage",
			Name:           "High Token Usage",
			Enabled:        false,
			ContentType:    "tool_result",
			Mode:           "token_threshold",
			TokenThreshold: ptr.To(8000.0),
			TokenType:      ptr.To("total"),
			Color:          ptr.To("yellow"),
			IsBuiltin:      ptr.To(true),
		},
	}
}

// isBuiltin returns true when the trigger's IsBuiltin pointer is set and true.
func isBuiltinTrigger(t *NotificationTrigger) bool {
	return t.IsBuiltin != nil && *t.IsBuiltin
}

// MergeTriggers mirrors triggers::merge_triggers in Rust:
//   - Preserves all existing triggers (including user-modified builtins).
//   - Removes deprecated builtins (builtins in loaded that are not in defaults).
//   - Adds missing builtins from defaults.
func MergeTriggers(loaded, defaults []NotificationTrigger) []NotificationTrigger {
	// Build set of valid builtin IDs from defaults.
	builtinIDs := make(map[string]bool)
	for i := range defaults {
		if isBuiltinTrigger(&defaults[i]) {
			builtinIDs[defaults[i].ID] = true
		}
	}

	// Filter out deprecated builtins.
	merged := make([]NotificationTrigger, 0, len(loaded))
	for i := range loaded {
		t := &loaded[i]
		if isBuiltinTrigger(t) && !builtinIDs[t.ID] {
			continue // deprecated builtin — drop it
		}
		merged = append(merged, *t)
	}

	// Add missing builtins.
	existingIDs := make(map[string]bool, len(merged))
	for i := range merged {
		existingIDs[merged[i].ID] = true
	}
	for i := range defaults {
		d := &defaults[i]
		if isBuiltinTrigger(d) && !existingIDs[d.ID] {
			merged = append(merged, *d)
		}
	}

	return merged
}

// ValidateTrigger mirrors triggers::validate_trigger in Rust.
// Returns a non-nil error slice on validation failure.
func ValidateTrigger(t *NotificationTrigger) []string {
	var errs []string

	if len([]rune(t.ID)) == 0 || len(t.ID) == 0 {
		errs = append(errs, "Trigger ID is required")
	}
	if len(t.Name) == 0 {
		errs = append(errs, "Trigger name is required")
	}
	if t.ContentType == "" {
		errs = append(errs, "Content type is required")
	}
	if t.Mode == "" {
		errs = append(errs, "Trigger mode is required")
	}

	switch t.Mode {
	case "content_match":
		// matchField required unless tool_use with no toolName
		isAnyToolUse := t.ContentType == "tool_use" && t.ToolName == nil
		if t.MatchField == nil && !isAnyToolUse {
			errs = append(errs, "Match field is required for content_match mode")
		}
		if t.MatchPattern != nil {
			if err := ValidateRegexPattern(*t.MatchPattern); err != "" {
				errs = append(errs, err)
			}
		}
	case "token_threshold":
		if t.TokenThreshold == nil || *t.TokenThreshold < 0 {
			errs = append(errs, "Token threshold must be a non-negative number")
		}
		if t.TokenType == nil {
			errs = append(errs, "Token type is required for token_threshold mode")
		}
	}

	if t.IgnorePatterns != nil {
		for _, p := range *t.IgnorePatterns {
			if err := ValidateRegexPattern(p); err != "" {
				errs = append(errs, fmt.Sprintf("Invalid ignore pattern %q: %s", p, err))
			}
		}
	}

	return errs
}

// ValidateRegexPattern mirrors triggers::validate_regex_pattern in Rust.
// Returns empty string on success, error message on failure.
func ValidateRegexPattern(pattern string) string {
	if len(pattern) > maxPatternLength {
		return fmt.Sprintf("Pattern too long (%d chars, max %d)", len(pattern), maxPatternLength)
	}
	if _, err := regexp.Compile(pattern); err != nil {
		return fmt.Sprintf("Invalid regex: %s", err)
	}
	return ""
}

// InferMode mirrors triggers::infer_mode in Rust.
func InferMode(t *NotificationTrigger) string {
	if t.RequireError != nil && *t.RequireError {
		return "error_status"
	}
	if t.MatchPattern != nil || t.MatchField != nil {
		return "content_match"
	}
	if t.TokenThreshold != nil {
		return "token_threshold"
	}
	return "error_status"
}
