// Package config — validation ports src-tauri/src/config/validation/ to Go.
// Entry point: ValidateConfigUpdate(section, data) → (section, data, error).
package config

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

const maxSnoozeMinutes = 24 * 60

// ValidateConfigUpdate is the port of validation::validate_config_update.
// Returns the validated (section, canonicalised JSON value) or an error.
func ValidateConfigUpdate(section string, data json.RawMessage) (string, json.RawMessage, error) {
	switch section {
	case "notifications":
		v, err := validateNotifications(data)
		return section, v, err
	case "general":
		v, err := validateGeneral(data)
		return section, v, err
	case "display":
		v, err := validateDisplay(data)
		return section, v, err
	case "httpServer":
		v, err := validateHTTPServer(data)
		return section, v, err
	case "ssh":
		v, err := validateSSH(data)
		return section, v, err
	case "dashboard":
		v, err := validateDashboard(data)
		return section, v, err
	case "shortcuts":
		v, err := validateShortcuts(data)
		return section, v, err
	case "themes":
		v, err := validateThemes(data)
		return section, v, err
	case "plugins":
		v, err := validatePlugins(data)
		return section, v, err
	case "notificationRules":
		v, err := validateNotificationRules(data)
		return section, v, err
	case "webhookEndpoints":
		v, err := validateWebhookEndpoints(data)
		return section, v, err
	case "onboarding":
		v, err := validateOnboarding(data)
		return section, v, err
	case "retention":
		v, err := validateRetention(data)
		return section, v, err
	default:
		return "", nil, fmt.Errorf(
			"Section must be one of: notifications, general, display, httpServer, ssh, dashboard, shortcuts, themes, plugins, notificationRules, webhookEndpoints, onboarding, retention",
		)
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func parseObj(data json.RawMessage, context string) (map[string]json.RawMessage, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("%s update must be an object", context)
	}
	return m, nil
}

func isBool(raw json.RawMessage) bool {
	var b bool
	return json.Unmarshal(raw, &b) == nil && (string(raw) == "true" || string(raw) == "false")
}

func isNull(raw json.RawMessage) bool {
	return string(raw) == "null"
}

func isStringArray(raw json.RawMessage) bool {
	var arr []interface{}
	if err := json.Unmarshal(raw, &arr); err != nil {
		return false
	}
	for _, v := range arr {
		if _, ok := v.(string); !ok {
			return false
		}
	}
	return true
}

func isFiniteNumber(raw json.RawMessage) bool {
	var f float64
	if err := json.Unmarshal(raw, &f); err != nil {
		return false
	}
	return !isInf(f) && !isNaN(f)
}

func isInf(f float64) bool { return f > 1e308 || f < -1e308 }
func isNaN(f float64) bool { return f != f }

func asUint64(raw json.RawMessage) (uint64, bool) {
	var n json.Number
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, false
	}
	i, err := n.Int64()
	if err != nil || i < 0 {
		return 0, false
	}
	return uint64(i), true
}

func asString(raw json.RawMessage) (string, bool) {
	var s string
	err := json.Unmarshal(raw, &s)
	return s, err == nil
}

func isString(raw json.RawMessage) bool {
	_, ok := asString(raw)
	return ok
}

func isObject(raw json.RawMessage) bool {
	var m map[string]json.RawMessage
	return json.Unmarshal(raw, &m) == nil
}

func isArray(raw json.RawMessage) bool {
	var arr []json.RawMessage
	return json.Unmarshal(raw, &arr) == nil
}

func rawTrue() json.RawMessage { return json.RawMessage("true") }
func rawNull() json.RawMessage { return json.RawMessage("null") }

func buildObj(m map[string]json.RawMessage) json.RawMessage {
	b, _ := json.Marshal(m)
	return b
}

// ─── general ─────────────────────────────────────────────────────────────────

var allowedGeneralKeys = map[string]bool{
	"launchAtLogin":      true,
	"theme":              true,
	"defaultTab":         true,
	"claudeRootPath":     true,
	"autoExpandAIGroups": true,
	"useNativeTitleBar":  true,
}

var validThemes = map[string]bool{"dark": true, "light": true, "system": true}
var validDefaultTabs = map[string]bool{"dashboard": true, "last-session": true}

var boolGeneralKeys = map[string]bool{
	"launchAtLogin":      true,
	"autoExpandAIGroups": true,
	"useNativeTitleBar":  true,
}

func validateGeneral(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "general")
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(obj))

	for k, v := range obj {
		if !allowedGeneralKeys[k] {
			return nil, fmt.Errorf("general.%s is not a valid setting", k)
		}
		switch {
		case boolGeneralKeys[k]:
			if !isBool(v) {
				return nil, fmt.Errorf("general.%s must be a boolean", k)
			}
			result[k] = v
		case k == "theme":
			s, ok := asString(v)
			if !ok || !validThemes[s] {
				return nil, fmt.Errorf("general.theme must be one of: dark, light, system")
			}
			result[k] = v
		case k == "defaultTab":
			s, ok := asString(v)
			if !ok || !validDefaultTabs[s] {
				return nil, fmt.Errorf("general.defaultTab must be one of: dashboard, last-session")
			}
			result[k] = v
		case k == "claudeRootPath":
			if isNull(v) {
				result[k] = rawNull()
			} else if s, ok := asString(v); ok {
				trimmed := strings.TrimSpace(s)
				if trimmed == "" {
					result[k] = rawNull()
				} else if !filepath.IsAbs(trimmed) {
					return nil, fmt.Errorf("general.claudeRootPath must be an absolute path")
				} else {
					// Canonicalize without requiring path to exist (best-effort).
					resolved := trimmed
					if canon, err2 := filepath.EvalSymlinks(trimmed); err2 == nil {
						resolved = canon
					}
					b, _ := json.Marshal(resolved)
					result[k] = b
				}
			} else {
				return nil, fmt.Errorf("general.claudeRootPath must be an absolute path string or null")
			}
		}
	}
	return buildObj(result), nil
}

// ─── display ─────────────────────────────────────────────────────────────────

// ponytail: empty — the showTimestamps/compactMode/syntaxHighlighting bools were dead and removed.
// codeBlockTheme/showLineNumbers/wordWrap were never wired into validation (pre-existing); wire them
// here if the code-block settings are made functional.
var allowedDisplayKeys = map[string]bool{}

func validateDisplay(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "display")
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(obj))
	for k, v := range obj {
		if !allowedDisplayKeys[k] {
			return nil, fmt.Errorf("display.%s is not a valid setting", k)
		}
		if !isBool(v) {
			return nil, fmt.Errorf("display.%s must be a boolean", k)
		}
		result[k] = v
	}
	return buildObj(result), nil
}

// ─── notifications ────────────────────────────────────────────────────────────

var allowedNotifKeys = map[string]bool{
	"enabled":               true,
	"soundEnabled":          true,
	"includeSubagentErrors": true,
	"ignoredRegex":          true,
	"ignoredRepositories":   true,
	"snoozedUntil":          true,
	"snoozeMinutes":         true,
	"triggers":              true,
}

var boolNotifKeys = map[string]bool{
	"enabled":               true,
	"soundEnabled":          true,
	"includeSubagentErrors": true,
}

func validateNotifications(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "notifications")
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(obj))

	for k, v := range obj {
		if !allowedNotifKeys[k] {
			return nil, fmt.Errorf("notifications.%s is not supported via config:update", k)
		}
		switch {
		case boolNotifKeys[k]:
			if !isBool(v) {
				return nil, fmt.Errorf("notifications.%s must be a boolean", k)
			}
			result[k] = v
		case k == "ignoredRegex" || k == "ignoredRepositories":
			if !isStringArray(v) {
				return nil, fmt.Errorf("notifications.%s must be a string[]", k)
			}
			result[k] = v
		case k == "snoozedUntil":
			if !isNull(v) && !isFiniteNumber(v) {
				return nil, fmt.Errorf("notifications.snoozedUntil must be a number or null")
			}
			if isFiniteNumber(v) {
				var f float64
				_ = json.Unmarshal(v, &f)
				if f < 0 {
					return nil, fmt.Errorf("notifications.snoozedUntil must be >= 0")
				}
			}
			result[k] = v
		case k == "snoozeMinutes":
			n, ok := asUint64(v)
			if !ok {
				return nil, fmt.Errorf("notifications.snoozeMinutes must be an integer")
			}
			if n == 0 || n > uint64(maxSnoozeMinutes) {
				return nil, fmt.Errorf("notifications.snoozeMinutes must be between 1 and %d", maxSnoozeMinutes)
			}
			result[k] = v
		case k == "triggers":
			var arr []json.RawMessage
			if err2 := json.Unmarshal(v, &arr); err2 != nil {
				return nil, fmt.Errorf("notifications.triggers must be a valid trigger[]")
			}
			for _, tv := range arr {
				var t NotificationTrigger
				if err2 := json.Unmarshal(tv, &t); err2 != nil {
					return nil, fmt.Errorf("notifications.triggers must be a valid trigger[]")
				}
				if strings.TrimSpace(t.ID) == "" || strings.TrimSpace(t.Name) == "" ||
					t.ContentType == "" || t.Mode == "" {
					return nil, fmt.Errorf("notifications.triggers must be a valid trigger[]")
				}
			}
			result[k] = v
		}
	}
	return buildObj(result), nil
}

// ─── httpServer ───────────────────────────────────────────────────────────────

var allowedHTTPKeys = map[string]bool{"enabled": true, "port": true}

func validateHTTPServer(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "httpServer")
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(obj))
	for k, v := range obj {
		if !allowedHTTPKeys[k] {
			return nil, fmt.Errorf("httpServer.%s is not a valid setting", k)
		}
		switch k {
		case "enabled":
			if !isBool(v) {
				return nil, fmt.Errorf("httpServer.enabled must be a boolean")
			}
			result[k] = v
		case "port":
			n, ok := asUint64(v)
			if !ok || n < 1024 || n > 65535 {
				return nil, fmt.Errorf("httpServer.port must be an integer between 1024 and 65535")
			}
			result[k] = v
		}
	}
	return buildObj(result), nil
}

// ─── ssh ──────────────────────────────────────────────────────────────────────

var allowedSSHKeys = map[string]bool{
	"lastConnection":      true,
	"autoReconnect":       true,
	"profiles":            true,
	"lastActiveContextId": true,
}

var validAuthMethods = map[string]bool{
	"password":   true,
	"privateKey": true,
	"agent":      true,
	"auto":       true,
}

func isValidSSHProfile(raw json.RawMessage) bool {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	nonEmpty := func(key string) bool {
		v, ok := m[key]
		if !ok {
			return false
		}
		s, ok2 := asString(v)
		return ok2 && strings.TrimSpace(s) != ""
	}
	if !nonEmpty("id") {
		return false
	}
	for _, req := range []string{"name", "host", "username"} {
		if _, ok := asString(m[req]); !ok {
			return false
		}
	}
	if _, ok := asUint64(m["port"]); !ok {
		return false
	}
	method, ok := asString(m["authMethod"])
	return ok && validAuthMethods[method]
}

func validateSSH(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "ssh")
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(obj))
	for k, v := range obj {
		if !allowedSSHKeys[k] {
			return nil, fmt.Errorf("ssh.%s is not a valid setting", k)
		}
		switch k {
		case "autoReconnect":
			if !isBool(v) {
				return nil, fmt.Errorf("ssh.autoReconnect must be a boolean")
			}
			result[k] = v
		case "lastActiveContextId":
			if !isString(v) {
				return nil, fmt.Errorf("ssh.lastActiveContextId must be a string")
			}
			result[k] = v
		case "lastConnection":
			if !isNull(v) && !isObject(v) {
				return nil, fmt.Errorf("ssh.lastConnection must be an object or null")
			}
			result[k] = v
		case "profiles":
			var arr []json.RawMessage
			if err2 := json.Unmarshal(v, &arr); err2 != nil {
				return nil, fmt.Errorf("ssh.profiles must be a valid profile array")
			}
			for _, p := range arr {
				if !isValidSSHProfile(p) {
					return nil, fmt.Errorf("ssh.profiles must be a valid profile array")
				}
			}
			result[k] = v
		}
	}
	return buildObj(result), nil
}

// ─── dashboard ────────────────────────────────────────────────────────────────

var allowedDashboardKeys = map[string]bool{"widgetOrder": true, "hiddenWidgets": true}

func validateDashboard(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "dashboard")
	if err != nil {
		return nil, err
	}
	for k := range obj {
		if !allowedDashboardKeys[k] {
			return nil, fmt.Errorf("Unknown dashboard field: %s", k)
		}
	}
	for _, key := range []string{"widgetOrder", "hiddenWidgets"} {
		v, ok := obj[key]
		if !ok {
			continue
		}
		if !isStringArray(v) {
			return nil, fmt.Errorf("%s entries must be strings", key)
		}
	}
	return data, nil
}

// ─── shortcuts ────────────────────────────────────────────────────────────────

func validateShortcuts(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "shortcuts")
	if err != nil {
		return nil, err
	}
	for k := range obj {
		if k != "overrides" {
			return nil, fmt.Errorf("Unknown shortcuts field: %s", k)
		}
	}
	if v, ok := obj["overrides"]; ok {
		var m map[string]json.RawMessage
		if err2 := json.Unmarshal(v, &m); err2 != nil {
			return nil, fmt.Errorf("overrides must be an object")
		}
		for k2, v2 := range m {
			if k2 == "" {
				return nil, fmt.Errorf("shortcut override id must not be empty")
			}
			if !isString(v2) {
				return nil, fmt.Errorf("shortcut override combo must be a string")
			}
		}
	}
	return data, nil
}

// ─── themes ───────────────────────────────────────────────────────────────────

func validateThemes(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "themes")
	if err != nil {
		return nil, err
	}
	for k := range obj {
		if k != "activeId" && k != "custom" {
			return nil, fmt.Errorf("Unknown themes field: %s", k)
		}
	}
	if v, ok := obj["activeId"]; ok {
		if !isNull(v) && !isString(v) {
			return nil, fmt.Errorf("activeId must be a string or null")
		}
	}
	if v, ok := obj["custom"]; ok {
		var arr []json.RawMessage
		if err2 := json.Unmarshal(v, &arr); err2 != nil {
			return nil, fmt.Errorf("custom must be an array")
		}
		for _, entry := range arr {
			var theme map[string]json.RawMessage
			if err2 := json.Unmarshal(entry, &theme); err2 != nil {
				return nil, fmt.Errorf("theme entry must be an object")
			}
			for _, f := range []string{"id", "name", "basedOn"} {
				fv, exists := theme[f]
				if !exists {
					return nil, fmt.Errorf("theme missing field: %s", f)
				}
				if !isString(fv) {
					return nil, fmt.Errorf("theme.%s must be a string", f)
				}
			}
			basedOn, _ := asString(theme["basedOn"])
			if basedOn != "dark" && basedOn != "light" {
				return nil, fmt.Errorf("theme.basedOn must be 'dark' or 'light'")
			}
			overridesRaw, ok2 := theme["overrides"]
			if !ok2 {
				return nil, fmt.Errorf("theme.overrides must be an object")
			}
			var overrides map[string]json.RawMessage
			if err2 := json.Unmarshal(overridesRaw, &overrides); err2 != nil {
				return nil, fmt.Errorf("theme.overrides must be an object")
			}
			for k2, v2 := range overrides {
				if k2 == "" {
					return nil, fmt.Errorf("theme override key must not be empty")
				}
				if !isString(v2) {
					return nil, fmt.Errorf("theme override value must be a string")
				}
			}
		}
	}
	return data, nil
}

// ─── plugins ──────────────────────────────────────────────────────────────────

func validatePlugins(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "plugins")
	if err != nil {
		return nil, err
	}
	for k := range obj {
		if k != "enabled" {
			return nil, fmt.Errorf("Unknown plugins field: %s", k)
		}
	}
	if v, ok := obj["enabled"]; ok {
		var arr []json.RawMessage
		if err2 := json.Unmarshal(v, &arr); err2 != nil {
			return nil, fmt.Errorf("enabled must be an array")
		}
		for _, entry := range arr {
			if !isString(entry) {
				return nil, fmt.Errorf("enabled entries must be strings")
			}
		}
	}
	return data, nil
}

// ─── notificationRules ────────────────────────────────────────────────────────

func validateNotificationRules(data json.RawMessage) (json.RawMessage, error) {
	if !isArray(data) {
		return nil, fmt.Errorf("notificationRules update must be an array")
	}
	return data, nil
}

// ─── webhookEndpoints ─────────────────────────────────────────────────────────

func validateWebhookEndpoints(data json.RawMessage) (json.RawMessage, error) {
	if !isArray(data) {
		return nil, fmt.Errorf("webhookEndpoints update must be an array")
	}
	return data, nil
}

// ─── retention (W31) ──────────────────────────────────────────────────────────

var allowedRetentionKeys = map[string]bool{"categories": true, "trashExpiryDays": true}

func validateRetention(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "retention")
	if err != nil {
		return nil, err
	}
	result := make(map[string]json.RawMessage, len(obj))
	for k, v := range obj {
		if !allowedRetentionKeys[k] {
			return nil, fmt.Errorf("retention.%s is not a valid setting", k)
		}
		switch k {
		case "categories":
			var cats map[string]RetentionCategory
			if json.Unmarshal(v, &cats) != nil {
				return nil, fmt.Errorf("retention.categories must be a map of {enabled, autoApproved}")
			}
			result[k] = v
		case "trashExpiryDays":
			if !isFiniteNumber(v) {
				return nil, fmt.Errorf("retention.trashExpiryDays must be a number")
			}
			var f float64
			_ = json.Unmarshal(v, &f)
			// Clamp to [1,36500] (Security F5): a 0/negative expiry would
			// EmptyTrash same-pass receipts irreversibly in an unattended run.
			b, _ := json.Marshal(clampCutoffDays(int(f)))
			result[k] = b
		}
	}
	return buildObj(result), nil
}

// ─── onboarding ───────────────────────────────────────────────────────────────

func validateOnboarding(data json.RawMessage) (json.RawMessage, error) {
	obj, err := parseObj(data, "onboarding")
	if err != nil {
		return nil, err
	}
	for k := range obj {
		if k != "completed" {
			return nil, fmt.Errorf("Unknown onboarding field: %s", k)
		}
	}
	if v, ok := obj["completed"]; ok {
		if !isBool(v) {
			return nil, fmt.Errorf("completed must be a boolean")
		}
	}
	return data, nil
}
