// Package notifications ports src-tauri/src/notifications/ to Go.
// Types, rule DSL, and factory helpers live here.
// JSON tags match serde rename_all="camelCase" exactly.
// Option<T> + skip_serializing_if → *T + omitempty.
// Option<T> without skip             → *T (no omitempty).
package notifications

import (
	"fmt"

	"github.com/google/uuid"
)

// ── DetectedError ──────────────────────────────────────────────────────────────

// DetectedError mirrors notifications/types.rs DetectedError.
type DetectedError struct {
	ID          string       `json:"id"`
	Timestamp   float64      `json:"timestamp"`
	SessionID   string       `json:"sessionId"`
	ProjectID   string       `json:"projectId"`
	FilePath    string       `json:"filePath"`
	Source      string       `json:"source"`
	Message     string       `json:"message"`
	LineNumber  *uint32      `json:"lineNumber,omitempty"`
	ToolUseID   *string      `json:"toolUseId,omitempty"`
	SubagentID  *string      `json:"subagentId,omitempty"`
	TriggerColor *string     `json:"triggerColor,omitempty"`
	TriggerID   *string      `json:"triggerId,omitempty"`
	TriggerName *string      `json:"triggerName,omitempty"`
	Context     ErrorContext `json:"context"`
}

// ErrorContext mirrors notifications/types.rs ErrorContext.
type ErrorContext struct {
	ProjectName string  `json:"projectName"`
	Cwd         *string `json:"cwd,omitempty"`
}

// ── StoredNotification ─────────────────────────────────────────────────────────

// StoredNotification mirrors notifications/types.rs StoredNotification.
// Rust uses #[serde(flatten)] for the error field so all DetectedError fields
// appear at the top level alongside isRead and createdAt.
type StoredNotification struct {
	DetectedError
	IsRead    bool    `json:"isRead"`
	CreatedAt float64 `json:"createdAt"`
}

// ── Result types ───────────────────────────────────────────────────────────────

// GetNotificationsResult mirrors notifications/types.rs GetNotificationsResult.
type GetNotificationsResult struct {
	Notifications []StoredNotification `json:"notifications"`
	Total         int                  `json:"total"`
	TotalCount    int                  `json:"totalCount"`
	UnreadCount   int                  `json:"unreadCount"`
	HasMore       bool                 `json:"hasMore"`
}

// GetNotificationsOptions mirrors notifications/types.rs GetNotificationsOptions.
type GetNotificationsOptions struct {
	Limit  *int `json:"limit"`
	Offset *int `json:"offset"`
}

// TriggerTestResult mirrors notifications/types.rs TriggerTestResult.
type TriggerTestResult struct {
	TotalCount int             `json:"totalCount"`
	Errors     []DetectedError `json:"errors"`
	Truncated  *bool           `json:"truncated,omitempty"`
}

// NotificationUpdatedPayload mirrors notifications/types.rs NotificationUpdatedPayload.
type NotificationUpdatedPayload struct {
	Total       int `json:"total"`
	UnreadCount int `json:"unreadCount"`
}

// ── CreateDetectedErrorParams ─────────────────────────────────────────────────

// CreateDetectedErrorParams mirrors notifications/types.rs CreateDetectedErrorParams.
// Not serialized — internal factory input only.
type CreateDetectedErrorParams struct {
	SessionID    string
	ProjectID    string
	FilePath     string
	ProjectName  string
	LineNumber   uint32
	Source       string
	Message      string
	TimestampMS  float64
	Cwd          *string
	ToolUseID    *string
	SubagentID   *string
	TriggerColor *string
	TriggerID    *string
	TriggerName  *string
}

const maxMessageLen = 500

func truncateMessage(msg string, maxLen int) string {
	if len(msg) <= maxLen {
		return msg
	}
	return fmt.Sprintf("%s...", msg[:maxLen])
}

// CreateDetectedError builds a DetectedError with a fresh UUID.
// Mirrors notifications/types.rs create_detected_error.
func CreateDetectedError(p CreateDetectedErrorParams) DetectedError {
	ln := p.LineNumber
	return DetectedError{
		ID:           uuid.New().String(),
		Timestamp:    p.TimestampMS,
		SessionID:    p.SessionID,
		ProjectID:    p.ProjectID,
		FilePath:     p.FilePath,
		Source:       p.Source,
		Message:      truncateMessage(p.Message, maxMessageLen),
		LineNumber:   &ln,
		ToolUseID:    p.ToolUseID,
		SubagentID:   p.SubagentID,
		TriggerColor: p.TriggerColor,
		TriggerID:    p.TriggerID,
		TriggerName:  p.TriggerName,
		Context: ErrorContext{
			ProjectName: p.ProjectName,
			Cwd:         p.Cwd,
		},
	}
}

// ── Rule DSL ──────────────────────────────────────────────────────────────────
// Mirrors notifications/types.rs — RulePredicate, RuleNode, RuleAction,
// NotificationRule. All use serde tag="kind" + rename_all="camelCase".

// RulePredicate is a discriminated union; Kind drives which fields are set.
// Rust: #[serde(tag = "kind", rename_all = "camelCase")]
type RulePredicate struct {
	Kind    string  `json:"kind"`
	Equals  string  `json:"equals,omitempty"`  // toolName
	Ms      float64 `json:"ms,omitempty"`      // durationGt
	IsError *bool   `json:"isError,omitempty"` // error
	Usd     float64 `json:"usd,omitempty"`     // costGt
	Pattern string  `json:"pattern,omitempty"` // regexMatch
}

// RuleNode is a discriminated union on Kind.
// Rust: #[serde(tag = "kind", rename_all = "camelCase")]
type RuleNode struct {
	Kind      string        `json:"kind"`
	Children  []RuleNode    `json:"children,omitempty"`
	Predicate *RulePredicate `json:"predicate,omitempty"`
}

// RuleAction is a discriminated union on Kind.
// Rust: #[serde(tag = "kind", rename_all = "camelCase")]
type RuleAction struct {
	Kind     string `json:"kind"`
	URL      string `json:"url,omitempty"`
	Template string `json:"template,omitempty"`
}

// NotificationRule mirrors notifications/types.rs NotificationRule.
type NotificationRule struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Enabled   bool      `json:"enabled"`
	Condition RuleNode  `json:"condition"`
	Action    RuleAction `json:"action"`
}

// RuleEvalContext mirrors notifications/types.rs RuleEvalContext.
// Pure data bag; no JSON serialization needed.
type RuleEvalContext struct {
	ToolName   *string
	DurationMS *float64
	IsError    bool
	CostUSD    *float64
	Message    *string
}
