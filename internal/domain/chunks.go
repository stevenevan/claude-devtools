package domain

import (
	"encoding/json"
	"fmt"
)

// Process — a subagent execution linked to a parent chunk.
type Process struct {
	ID                string             `json:"id"`
	FilePath          string             `json:"filePath"`
	Messages          []ParsedMessage    `json:"messages"`
	StartTime         string             `json:"startTime"`
	EndTime           string             `json:"endTime"`
	DurationMs        float64            `json:"durationMs"`
	Metrics           SessionMetrics     `json:"metrics"`
	Description       *string            `json:"description,omitempty"`
	SubagentType      *string            `json:"subagentType,omitempty"`
	IsParallel        bool               `json:"isParallel"`
	ParentTaskID      *string            `json:"parentTaskId,omitempty"`
	IsOngoing         *bool              `json:"isOngoing,omitempty"`
	MainSessionImpact *MainSessionImpact `json:"mainSessionImpact,omitempty"`
	Team              *TeamMetadata      `json:"team,omitempty"`
}

// MainSessionImpact — tokens a subagent cost the main session.
type MainSessionImpact struct {
	CallTokens   uint64 `json:"callTokens"`
	ResultTokens uint64 `json:"resultTokens"`
	TotalTokens  uint64 `json:"totalTokens"`
}

// TeamMetadata — agent-team enrichment for a subagent.
type TeamMetadata struct {
	TeamName    string `json:"teamName"`
	MemberName  string `json:"memberName"`
	MemberColor string `json:"memberColor"`
}

// ToolExecution — a tool_use linked to its tool_result.
type ToolExecution struct {
	ToolCall   ToolCall    `json:"toolCall"`
	Result     *ToolResult `json:"result,omitempty"`
	StartTime  string      `json:"startTime"`
	EndTime    *string     `json:"endTime,omitempty"`
	DurationMs *float64    `json:"durationMs,omitempty"`
}

// EnhancedChunk mirrors the Rust internally-tagged enum
// `#[serde(tag = "chunkType", rename_all = "camelCase")]`. Marshal emits the
// active variant's struct fields plus a "chunkType" discriminator.
type EnhancedChunk struct {
	Type    string
	User    *EnhancedUserChunk
	Ai      *EnhancedAIChunk
	System  *EnhancedSystemChunk
	Compact *EnhancedCompactChunk
	Event   *EnhancedEventChunk
}

func (c EnhancedChunk) inner() (any, error) {
	switch c.Type {
	case "user":
		return c.User, nil
	case "ai":
		return c.Ai, nil
	case "system":
		return c.System, nil
	case "compact":
		return c.Compact, nil
	case "event":
		return c.Event, nil
	default:
		return nil, fmt.Errorf("domain: unknown EnhancedChunk type %q", c.Type)
	}
}

func (c EnhancedChunk) MarshalJSON() ([]byte, error) {
	inner, err := c.inner()
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(inner)
	if err != nil {
		return nil, err
	}
	// Splice the discriminator into the object. The parity harness key-sorts
	// recursively, so the injected-key position does not affect the gate.
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	tag, _ := json.Marshal(c.Type)
	m["chunkType"] = tag
	return json.Marshal(m)
}

func (c *EnhancedChunk) UnmarshalJSON(b []byte) error {
	var head struct {
		ChunkType string `json:"chunkType"`
	}
	if err := json.Unmarshal(b, &head); err != nil {
		return err
	}
	c.Type = head.ChunkType
	switch head.ChunkType {
	case "user":
		c.User = &EnhancedUserChunk{}
		return json.Unmarshal(b, c.User)
	case "ai":
		c.Ai = &EnhancedAIChunk{}
		return json.Unmarshal(b, c.Ai)
	case "system":
		c.System = &EnhancedSystemChunk{}
		return json.Unmarshal(b, c.System)
	case "compact":
		c.Compact = &EnhancedCompactChunk{}
		return json.Unmarshal(b, c.Compact)
	case "event":
		c.Event = &EnhancedEventChunk{}
		return json.Unmarshal(b, c.Event)
	default:
		return fmt.Errorf("domain: unknown chunkType %q", head.ChunkType)
	}
}

type EnhancedUserChunk struct {
	ID          string          `json:"id"`
	StartTime   string          `json:"startTime"`
	EndTime     string          `json:"endTime"`
	DurationMs  float64         `json:"durationMs"`
	Metrics     SessionMetrics  `json:"metrics"`
	UserMessage ParsedMessage   `json:"userMessage"`
	RawMessages []ParsedMessage `json:"rawMessages"`
}

type EnhancedAIChunk struct {
	ID                string               `json:"id"`
	StartTime         string               `json:"startTime"`
	EndTime           string               `json:"endTime"`
	DurationMs        float64              `json:"durationMs"`
	Metrics           SessionMetrics       `json:"metrics"`
	Responses         []ParsedMessage      `json:"responses"`
	Processes         []Process            `json:"processes"`
	SidechainMessages []ParsedMessage      `json:"sidechainMessages"`
	ToolExecutions    []ToolExecution      `json:"toolExecutions"`
	SemanticSteps     []SemanticStep       `json:"semanticSteps"`
	SemanticStepGroups *[]SemanticStepGroup `json:"semanticStepGroups,omitempty"`
	RawMessages       []ParsedMessage      `json:"rawMessages"`
	ProgressCount     *uint32              `json:"progressCount,omitempty"`
	ProgressTexts     *[]string            `json:"progressTexts,omitempty"`
}

type EnhancedSystemChunk struct {
	ID            string          `json:"id"`
	StartTime     string          `json:"startTime"`
	EndTime       string          `json:"endTime"`
	DurationMs    float64         `json:"durationMs"`
	Metrics       SessionMetrics  `json:"metrics"`
	Message       ParsedMessage   `json:"message"`
	CommandOutput string          `json:"commandOutput"`
	RawMessages   []ParsedMessage `json:"rawMessages"`
}

type EnhancedCompactChunk struct {
	ID          string          `json:"id"`
	StartTime   string          `json:"startTime"`
	EndTime     string          `json:"endTime"`
	DurationMs  float64         `json:"durationMs"`
	Metrics     SessionMetrics  `json:"metrics"`
	Message     ParsedMessage   `json:"message"`
	RawMessages []ParsedMessage `json:"rawMessages"`
}

type EnhancedEventChunk struct {
	ID          string          `json:"id"`
	StartTime   string          `json:"startTime"`
	EndTime     string          `json:"endTime"`
	DurationMs  float64         `json:"durationMs"`
	Metrics     SessionMetrics  `json:"metrics"`
	Message     ParsedMessage   `json:"message"`
	EventData   SystemEventData `json:"eventData"`
	RawMessages []ParsedMessage `json:"rawMessages"`
}

// SemanticStep — an extracted reasoning/tool step in an AI response.
type SemanticStep struct {
	ID                  string              `json:"id"`
	StepType            string              `json:"type"`
	StartTime           string              `json:"startTime"`
	EndTime             *string             `json:"endTime,omitempty"`
	DurationMs          float64             `json:"durationMs"`
	Content             SemanticStepContent `json:"content"`
	Tokens              *SemanticStepTokens `json:"tokens,omitempty"`
	IsParallel          *bool               `json:"isParallel,omitempty"`
	GroupID             *string             `json:"groupId,omitempty"`
	Context             string              `json:"context"`
	AgentID             *string             `json:"agentId,omitempty"`
	SourceMessageID     *string             `json:"sourceMessageId,omitempty"`
	EffectiveEndTime    *string             `json:"effectiveEndTime,omitempty"`
	EffectiveDurationMs *float64            `json:"effectiveDurationMs,omitempty"`
	IsGapFilled         *bool               `json:"isGapFilled,omitempty"`
	ContextTokens       *uint64             `json:"contextTokens,omitempty"`
	AccumulatedContext  *uint64             `json:"accumulatedContext,omitempty"`
	TokenBreakdown      *TokenBreakdown     `json:"tokenBreakdown,omitempty"`
}

type SemanticStepContent struct {
	ThinkingText      *string  `json:"thinkingText,omitempty"`
	ToolName          *string  `json:"toolName,omitempty"`
	ToolInput         RawValue `json:"toolInput,omitempty"`
	ToolResultContent *string  `json:"toolResultContent,omitempty"`
	IsError           *bool    `json:"isError,omitempty"`
	ToolUseResult     RawValue `json:"toolUseResult,omitempty"`
	TokenCount        *uint64  `json:"tokenCount,omitempty"`
	SubagentID        *string  `json:"subagentId,omitempty"`
	SubagentDescription *string `json:"subagentDescription,omitempty"`
	OutputText        *string  `json:"outputText,omitempty"`
	SourceModel       *string  `json:"sourceModel,omitempty"`
	InterruptionText  *string  `json:"interruptionText,omitempty"`
}

type SemanticStepTokens struct {
	Input  uint64  `json:"input"`
	Output uint64  `json:"output"`
	Cached *uint64 `json:"cached,omitempty"`
}

type TokenBreakdown struct {
	Input         uint64 `json:"input"`
	Output        uint64 `json:"output"`
	CacheRead     uint64 `json:"cacheRead"`
	CacheCreation uint64 `json:"cacheCreation"`
}

// SemanticStepGroup — a labeled group of related steps.
type SemanticStepGroup struct {
	ID              string         `json:"id"`
	Label           string         `json:"label"`
	Steps           []SemanticStep `json:"steps"`
	IsGrouped       bool           `json:"isGrouped"`
	SourceMessageID *string        `json:"sourceMessageId,omitempty"`
	StartTime       string         `json:"startTime"`
	EndTime         string         `json:"endTime"`
	TotalDuration   float64        `json:"totalDuration"`
}

// SessionDetail — the complete parsed + chunked session (the parity-gate output).
type SessionDetail struct {
	Session  Session         `json:"session"`
	Messages []ParsedMessage `json:"messages"`
	Chunks   []EnhancedChunk `json:"chunks"`
	Processes []Process      `json:"processes"`
	Metrics  SessionMetrics  `json:"metrics"`
}
