// Package domain holds the shared DTOs ported from src-tauri/src/types/.
// It is a pure leaf: it imports only the stdlib (encoding/json), never any
// other internal package, so the parsing/analysis packages can depend on it
// without forming an import cycle.
//
// JSON encoding mirrors serde exactly (the parity gate diffs byte-for-byte):
//   - Rust `rename_all = "camelCase"` → explicit camelCase `json:` tags.
//   - `Option<T>` + `skip_serializing_if="Option::is_none"` → `*T` + `,omitempty`
//     (omits the key when nil, matching serde).
//   - `Option<T>` WITHOUT skip → `*T` and NO `,omitempty` (serde emits `null`).
//   - frontend-iterated slices are constructed as `[]T{}`, never left nil.
package domain

// Project — a project folder under ~/.claude/projects.
type Project struct {
	ID                string   `json:"id"`
	Path              string   `json:"path"`
	Name              string   `json:"name"`
	Sessions          []string `json:"sessions"`
	CreatedAt         float64  `json:"createdAt"`
	MostRecentSession *float64 `json:"mostRecentSession,omitempty"`
}

// PhaseTokenBreakdown — per-compaction-phase token contribution.
type PhaseTokenBreakdown struct {
	PhaseNumber    uint32  `json:"phaseNumber"`
	Contribution   uint64  `json:"contribution"`
	PeakTokens     uint64  `json:"peakTokens"`
	PostCompaction *uint64 `json:"postCompaction,omitempty"`
}

// Session — session-level metadata.
type Session struct {
	ID               string                 `json:"id"`
	ProjectID        string                 `json:"projectId"`
	ProjectPath      string                 `json:"projectPath"`
	TodoData         RawValue               `json:"todoData,omitempty"`
	CreatedAt        float64                `json:"createdAt"`
	FirstMessage     *string                `json:"firstMessage,omitempty"`
	MessageTimestamp *string                `json:"messageTimestamp,omitempty"`
	HasSubagents     bool                   `json:"hasSubagents"`
	MessageCount     uint32                 `json:"messageCount"`
	IsOngoing        *bool                  `json:"isOngoing,omitempty"`
	GitBranch        *string                `json:"gitBranch,omitempty"`
	MetadataLevel    *string                `json:"metadataLevel,omitempty"`
	ContextConsumption *uint64              `json:"contextConsumption,omitempty"`
	CompactionCount  *uint32                `json:"compactionCount,omitempty"`
	PhaseBreakdown   *[]PhaseTokenBreakdown `json:"phaseBreakdown,omitempty"`
	CustomTitle      *string                `json:"customTitle,omitempty"`
	AgentName        *string                `json:"agentName,omitempty"`
}

// SessionMetrics — token/cost/duration aggregation. Default-derivable.
type SessionMetrics struct {
	DurationMs          float64 `json:"durationMs"`
	TotalTokens         uint64  `json:"totalTokens"`
	InputTokens         uint64  `json:"inputTokens"`
	OutputTokens        uint64  `json:"outputTokens"`
	CacheReadTokens     uint64  `json:"cacheReadTokens"`
	CacheCreationTokens uint64  `json:"cacheCreationTokens"`
	MessageCount        uint32  `json:"messageCount"`
	CostUsd             *float64 `json:"costUsd,omitempty"`
	Model               *string  `json:"model,omitempty"`
}

// ParsedSession — result of a full parse (process_messages output).
type ParsedSession struct {
	Messages         []ParsedMessage `json:"messages"`
	Metrics          SessionMetrics  `json:"metrics"`
	TaskCalls        []ToolCall      `json:"taskCalls"`
	ByType           MessagesByType  `json:"byType"`
	SidechainMessages []ParsedMessage `json:"sidechainMessages"`
	MainMessages     []ParsedMessage `json:"mainMessages"`
	// custom_title / agent_name have NO skip_serializing_if → emit null when absent.
	CustomTitle *string `json:"customTitle"`
	AgentName   *string `json:"agentName"`
}

// MessagesByType — messages bucketed by role/category.
type MessagesByType struct {
	User         []ParsedMessage `json:"user"`
	RealUser     []ParsedMessage `json:"realUser"`
	InternalUser []ParsedMessage `json:"internalUser"`
	Assistant    []ParsedMessage `json:"assistant"`
	System       []ParsedMessage `json:"system"`
	Other        []ParsedMessage `json:"other"`
}

// PaginatedSessionsResult — a page of sessions.
type PaginatedSessionsResult struct {
	Sessions   []Session `json:"sessions"`
	NextCursor *string   `json:"nextCursor"` // no skip → null when absent
	HasMore    bool      `json:"hasMore"`
	TotalCount uint32    `json:"totalCount"`
}
