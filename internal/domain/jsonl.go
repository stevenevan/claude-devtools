package domain

import (
	"encoding/json"
	"fmt"
)

// ImageSource — base64 image payload. No rename_all in Rust, so fields keep
// their Rust names; only source_type is renamed to "type".
type ImageSource struct {
	SourceType string `json:"type"`
	MediaType  string `json:"media_type"`
	Data       string `json:"data"`
}

// ToolResultContentValue mirrors the Rust untagged enum
// `Text(String) | Blocks(Vec<ContentBlock>)`: a tool_result's content is either
// a bare string or an array of content blocks.
type ToolResultContentValue struct {
	Text   *string
	Blocks []ContentBlock
}

func (v ToolResultContentValue) MarshalJSON() ([]byte, error) {
	if v.Text != nil {
		return json.Marshal(*v.Text)
	}
	return json.Marshal(v.Blocks)
}

func (v *ToolResultContentValue) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		v.Text = &s
		return nil
	}
	return json.Unmarshal(b, &v.Blocks)
}

// ContentBlock mirrors the Rust internally-tagged enum
// `#[serde(tag = "type", rename_all = "snake_case")]`. Go has no native tagged
// union, so we hold all variant fields and dispatch in MarshalJSON/UnmarshalJSON.
// Marshal emits ONLY the active variant's fields (matching serde exactly).
type ContentBlock struct {
	Type string

	// text
	Text *string
	// thinking
	Thinking  *string
	Signature *string
	// tool_use
	ID    *string
	Name  *string
	Input RawValue
	// tool_result
	ToolUseID *string
	Content   *ToolResultContentValue
	IsError   *bool
	// image
	Source *ImageSource
}

func (c ContentBlock) MarshalJSON() ([]byte, error) {
	switch c.Type {
	case "text":
		return json.Marshal(struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}{"text", derefStr(c.Text)})
	case "thinking":
		return json.Marshal(struct {
			Type      string `json:"type"`
			Thinking  string `json:"thinking"`
			Signature string `json:"signature"`
		}{"thinking", derefStr(c.Thinking), derefStr(c.Signature)})
	case "tool_use":
		return json.Marshal(struct {
			Type  string   `json:"type"`
			ID    string   `json:"id"`
			Name  string   `json:"name"`
			Input RawValue `json:"input"`
		}{"tool_use", derefStr(c.ID), derefStr(c.Name), c.Input})
	case "tool_result":
		// is_error has no skip_serializing_if → always present (null when None).
		return json.Marshal(struct {
			Type      string                  `json:"type"`
			ToolUseID string                  `json:"tool_use_id"`
			Content   *ToolResultContentValue `json:"content"`
			IsError   *bool                   `json:"is_error"`
		}{"tool_result", derefStr(c.ToolUseID), c.Content, c.IsError})
	case "image":
		return json.Marshal(struct {
			Type   string       `json:"type"`
			Source *ImageSource `json:"source"`
		}{"image", c.Source})
	default:
		return nil, fmt.Errorf("domain: unknown ContentBlock type %q", c.Type)
	}
}

func (c *ContentBlock) UnmarshalJSON(b []byte) error {
	var raw struct {
		Type      string                  `json:"type"`
		Text      *string                 `json:"text"`
		Thinking  *string                 `json:"thinking"`
		Signature *string                 `json:"signature"`
		ID        *string                 `json:"id"`
		Name      *string                 `json:"name"`
		Input     RawValue                `json:"input"`
		ToolUseID *string                 `json:"tool_use_id"`
		Content   *ToolResultContentValue `json:"content"`
		IsError   *bool                   `json:"is_error"`
		Source    *ImageSource            `json:"source"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	c.Type = raw.Type
	c.Text, c.Thinking, c.Signature = raw.Text, raw.Thinking, raw.Signature
	c.ID, c.Name, c.Input = raw.ID, raw.Name, raw.Input
	c.ToolUseID, c.Content, c.IsError = raw.ToolUseID, raw.Content, raw.IsError
	c.Source = raw.Source
	return nil
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// RawJsonlEntry — a raw JSONL line, deserialized loosely (single struct with
// optional fields rather than a tagged enum). Deserialize-only on the Rust side.
type RawJsonlEntry struct {
	EntryType string  `json:"type"`
	Timestamp *string `json:"timestamp"`
	UUID      *string `json:"uuid"`

	ParentUUID  *string `json:"parentUuid"`
	IsSidechain bool    `json:"isSidechain"`
	UserType    *string `json:"userType"`
	Cwd         *string `json:"cwd"`
	GitBranch   *string `json:"gitBranch"`

	Message                RawValue `json:"message"`
	IsMeta                 *bool    `json:"isMeta"`
	AgentID                *string  `json:"agentId"`
	ToolUseResult          RawValue `json:"toolUseResult"`
	SourceToolUseID        *string  `json:"sourceToolUseId"`
	SourceToolAssistantUUID *string `json:"sourceToolAssistantUUID"`

	RequestID *string `json:"requestId"`

	IsCompactSummary *bool `json:"isCompactSummary"`

	Subtype *string `json:"subtype"`
	Level   *string `json:"level"`
	URL     *string `json:"url"`
	Content *string `json:"content"`

	Error       RawValue `json:"error"`
	RetryInMs    *float64 `json:"retryInMs"`
	RetryAttempt *uint32  `json:"retryAttempt"`
	MaxRetries   *uint32  `json:"maxRetries"`
	Cause        RawValue `json:"cause"`

	WrittenPaths *[]string `json:"writtenPaths"`
	Verb         *string   `json:"verb"`

	DurationMs *float64 `json:"durationMs"`

	Operation *string `json:"operation"`

	Data            RawValue `json:"data"`
	ToolUseIDRef    *string  `json:"toolUseID"`
	ParentToolUseID *string  `json:"parentToolUseID"`

	CustomTitle *string `json:"customTitle"`
	AgentName   *string `json:"agentName"`
}
