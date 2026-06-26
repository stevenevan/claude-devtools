package domain

import "encoding/json"

// ToolCall — an extracted tool_use block.
type ToolCall struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Input            RawValue `json:"input"`
	IsTask           bool     `json:"isTask"`
	TaskDescription  *string  `json:"taskDescription,omitempty"`
	TaskSubagentType *string  `json:"taskSubagentType,omitempty"`
}

// ToolResult — an extracted tool_result block.
type ToolResult struct {
	ToolUseID string   `json:"toolUseId"`
	Content   RawValue `json:"content"`
	IsError   bool     `json:"isError"`
}

// ParsedMessageContent mirrors the Rust untagged enum
// `Text(String) | Blocks(Vec<ContentBlock>)`.
type ParsedMessageContent struct {
	Text   *string
	Blocks []ContentBlock
}

func (c ParsedMessageContent) MarshalJSON() ([]byte, error) {
	if c.Text != nil {
		return json.Marshal(*c.Text)
	}
	return json.Marshal(c.Blocks)
}

func (c *ParsedMessageContent) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		c.Text = &s
		return nil
	}
	return json.Unmarshal(b, &c.Blocks)
}

// ParsedMessage — the internal representation after parsing a JSONL entry.
// parent_uuid has NO skip_serializing_if in Rust → it serializes as null when
// absent (so *string WITHOUT omitempty). Tool slices are always arrays.
type ParsedMessage struct {
	UUID        string               `json:"uuid"`
	ParentUUID  *string              `json:"parentUuid"`
	MessageType string               `json:"type"`
	Timestamp   string               `json:"timestamp"`
	Role        *string              `json:"role,omitempty"`
	Content     ParsedMessageContent `json:"content"`
	Usage       *TokenUsage          `json:"usage,omitempty"`
	Model       *string              `json:"model,omitempty"`

	Cwd       *string `json:"cwd,omitempty"`
	GitBranch *string `json:"gitBranch,omitempty"`
	AgentID   *string `json:"agentId,omitempty"`
	IsSidechain bool  `json:"isSidechain"`
	IsMeta      bool  `json:"isMeta"`
	UserType  *string `json:"userType,omitempty"`

	ToolCalls   []ToolCall `json:"toolCalls"`
	ToolResults []ToolResult `json:"toolResults"`

	SourceToolUseID         *string `json:"sourceToolUseID,omitempty"`
	SourceToolAssistantUUID *string `json:"sourceToolAssistantUUID,omitempty"`
	ToolUseResult           RawValue `json:"toolUseResult,omitempty"`
	IsCompactSummary        *bool   `json:"isCompactSummary,omitempty"`
	RequestID               *string `json:"requestId,omitempty"`
	Subtype                 *string `json:"subtype,omitempty"`
	EventData               *SystemEventData `json:"eventData,omitempty"`
}

// TokenUsage has NO rename_all in Rust → fields keep snake_case names. The
// cache_* fields have no skip_serializing_if, so they emit null when absent.
type TokenUsage struct {
	InputTokens             uint64  `json:"input_tokens"`
	OutputTokens            uint64  `json:"output_tokens"`
	CacheReadInputTokens    *uint64 `json:"cache_read_input_tokens"`
	CacheCreationInputTokens *uint64 `json:"cache_creation_input_tokens"`
}

// SystemEventData — typed payload for system/event messages.
type SystemEventData struct {
	Subtype string `json:"subtype"`

	ErrorStatus  *uint16  `json:"errorStatus,omitempty"`
	ErrorType    *string  `json:"errorType,omitempty"`
	ErrorMessage *string  `json:"errorMessage,omitempty"`
	RetryAttempt *uint32  `json:"retryAttempt,omitempty"`
	MaxRetries   *uint32  `json:"maxRetries,omitempty"`
	RetryInMs    *float64 `json:"retryInMs,omitempty"`

	BridgeContent *string `json:"bridgeContent,omitempty"`
	BridgeURL     *string `json:"bridgeUrl,omitempty"`

	WrittenPaths *[]string `json:"writtenPaths,omitempty"`
	MemoryVerb   *string   `json:"memoryVerb,omitempty"`

	DurationMs *float64 `json:"durationMs,omitempty"`

	Operation     *string `json:"operation,omitempty"`
	QueuedContent *string `json:"queuedContent,omitempty"`
}

// MessageCategory — classification result (serde camelCase). Not part of the
// SessionDetail gate output; used by the W3 classifier.
type MessageCategory string

const (
	CategoryUser      MessageCategory = "user"
	CategorySystem    MessageCategory = "system"
	CategoryHardNoise MessageCategory = "hardNoise"
	CategoryAi        MessageCategory = "ai"
	CategoryCompact   MessageCategory = "compact"
	CategoryEvent     MessageCategory = "event"
)
