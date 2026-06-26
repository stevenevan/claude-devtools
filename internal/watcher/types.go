// Package watcher provides pure filesystem-watching logic for ~/.claude/projects
// and ~/.claude/todos. No Wails import: the caller injects an emitFn closure.
package watcher

// FileChangeEvent mirrors the Rust FileChangeEvent (serde rename_all=camelCase,
// serde rename="type"). Matches TypeScript FileChangeEvent in chunks.ts.
type FileChangeEvent struct {
	// Type is "add" | "change" | "unlink" (serialized as "type", not "changeType").
	Type       string  `json:"type"`
	Path       string  `json:"path"`
	ProjectID  *string `json:"projectId,omitempty"`
	SessionID  *string `json:"sessionId,omitempty"`
	IsSubagent bool    `json:"isSubagent"`
}
