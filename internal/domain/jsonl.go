package domain

import (
	"encoding/json"
	"fmt"

	"claude-devtools/internal/ptr"
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
		}{"text", ptr.Deref(c.Text)})
	case "thinking":
		return json.Marshal(struct {
			Type      string `json:"type"`
			Thinking  string `json:"thinking"`
			Signature string `json:"signature"`
		}{"thinking", ptr.Deref(c.Thinking), ptr.Deref(c.Signature)})
	case "tool_use":
		return json.Marshal(struct {
			Type  string   `json:"type"`
			ID    string   `json:"id"`
			Name  string   `json:"name"`
			Input RawValue `json:"input"`
		}{"tool_use", ptr.Deref(c.ID), ptr.Deref(c.Name), c.Input})
	case "tool_result":
		// is_error has no skip_serializing_if → always present (null when None).
		return json.Marshal(struct {
			Type      string                  `json:"type"`
			ToolUseID string                  `json:"tool_use_id"`
			Content   *ToolResultContentValue `json:"content"`
			IsError   *bool                   `json:"is_error"`
		}{"tool_result", ptr.Deref(c.ToolUseID), c.Content, c.IsError})
	case "image":
		return json.Marshal(struct {
			Type   string       `json:"type"`
			Source *ImageSource `json:"source"`
		}{"image", c.Source})
	default:
		return nil, fmt.Errorf("domain: unknown ContentBlock type %q", c.Type)
	}
}

// UnmarshalJSON strictly decodes one content block, erroring on an unknown
// `type` or a missing required field — reproducing serde's tagged-enum
// deserialization. Callers skip on error at the top level (serde's filter_map)
// while a nested Vec<ContentBlock> propagates the error (serde Vec semantics).
func (c *ContentBlock) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	typ, err := reqStr(m, "type")
	if err != nil {
		return err
	}
	req := func(k string) (string, error) { return reqStr(m, k) }
	switch typ {
	case "text":
		s, err := req("text")
		if err != nil {
			return err
		}
		*c = ContentBlock{Type: "text", Text: &s}
	case "thinking":
		th, err := req("thinking")
		if err != nil {
			return err
		}
		sig, err := req("signature")
		if err != nil {
			return err
		}
		*c = ContentBlock{Type: "thinking", Thinking: &th, Signature: &sig}
	case "tool_use":
		id, err := req("id")
		if err != nil {
			return err
		}
		name, err := req("name")
		if err != nil {
			return err
		}
		input, ok := m["input"]
		if !ok {
			return fmt.Errorf("tool_use: missing input")
		}
		*c = ContentBlock{Type: "tool_use", ID: &id, Name: &name, Input: input}
	case "tool_result":
		tuid, err := req("tool_use_id")
		if err != nil {
			return err
		}
		content, ok := m["content"]
		if !ok {
			return fmt.Errorf("tool_result: missing content")
		}
		var trcv ToolResultContentValue
		if err := json.Unmarshal(content, &trcv); err != nil {
			return err
		}
		isErr, err := optBool(m, "is_error")
		if err != nil {
			return err
		}
		*c = ContentBlock{Type: "tool_result", ToolUseID: &tuid, Content: &trcv, IsError: isErr}
	case "image":
		src, ok := m["source"]
		if !ok {
			return fmt.Errorf("image: missing source")
		}
		var sm map[string]json.RawMessage
		if err := json.Unmarshal(src, &sm); err != nil {
			return err
		}
		st, err := reqStr(sm, "type")
		if err != nil {
			return err
		}
		mt, err := reqStr(sm, "media_type")
		if err != nil {
			return err
		}
		data, err := reqStr(sm, "data")
		if err != nil {
			return err
		}
		*c = ContentBlock{Type: "image", Source: &ImageSource{SourceType: st, MediaType: mt, Data: data}}
	default:
		return fmt.Errorf("unknown ContentBlock type %q", typ)
	}
	return nil
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

	Message                 RawValue `json:"message"`
	IsMeta                  *bool    `json:"isMeta"`
	AgentID                 *string  `json:"agentId"`
	ToolUseResult           RawValue `json:"toolUseResult"`
	SourceToolUseID         *string  `json:"sourceToolUseId"`
	SourceToolAssistantUUID *string  `json:"sourceToolAssistantUUID"`

	RequestID *string `json:"requestId"`

	IsCompactSummary *bool `json:"isCompactSummary"`

	Subtype *string `json:"subtype"`
	Level   *string `json:"level"`
	URL     *string `json:"url"`
	Content *string `json:"content"`

	Error        RawValue `json:"error"`
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

// UnmarshalJSON decodes case-SENSITIVELY by exact key, mirroring serde (Go's
// default json matching is case-insensitive, which would e.g. populate
// SourceToolUseID from the data's "sourceToolUseID" while serde — expecting
// "sourceToolUseId" — leaves it None). A present-but-wrong-type field aborts the
// whole decode so the line is dropped, exactly as serde_json::from_str does.
func (e *RawJsonlEntry) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	var err error
	get := func(k string) json.RawMessage { return m[k] }
	// required string
	if e.EntryType, err = reqStr(m, "type"); err != nil {
		return err
	}
	str := func(dst **string, k string) {
		if err == nil {
			*dst, err = optStr(m, k)
		}
	}
	bl := func(dst **bool, k string) {
		if err == nil {
			*dst, err = optBool(m, k)
		}
	}
	str(&e.Timestamp, "timestamp")
	str(&e.UUID, "uuid")
	str(&e.ParentUUID, "parentUuid")
	if err == nil {
		e.IsSidechain, err = defBool(m, "isSidechain")
	}
	str(&e.UserType, "userType")
	str(&e.Cwd, "cwd")
	str(&e.GitBranch, "gitBranch")
	e.Message = get("message")
	bl(&e.IsMeta, "isMeta")
	str(&e.AgentID, "agentId")
	e.ToolUseResult = get("toolUseResult")
	str(&e.SourceToolUseID, "sourceToolUseId")
	str(&e.SourceToolAssistantUUID, "sourceToolAssistantUUID")
	str(&e.RequestID, "requestId")
	bl(&e.IsCompactSummary, "isCompactSummary")
	str(&e.Subtype, "subtype")
	str(&e.Level, "level")
	str(&e.URL, "url")
	str(&e.Content, "content")
	e.Error = get("error")
	if err == nil {
		e.RetryInMs, err = optF64(m, "retryInMs")
	}
	if err == nil {
		e.RetryAttempt, err = optU32(m, "retryAttempt")
	}
	if err == nil {
		e.MaxRetries, err = optU32(m, "maxRetries")
	}
	e.Cause = get("cause")
	if err == nil {
		e.WrittenPaths, err = optStrSlice(m, "writtenPaths")
	}
	str(&e.Verb, "verb")
	if err == nil {
		e.DurationMs, err = optF64(m, "durationMs")
	}
	str(&e.Operation, "operation")
	e.Data = get("data")
	str(&e.ToolUseIDRef, "toolUseID")
	str(&e.ParentToolUseID, "parentToolUseID")
	str(&e.CustomTitle, "customTitle")
	str(&e.AgentName, "agentName")
	return err
}

func isNull(raw json.RawMessage) bool {
	return len(raw) == 4 && string(raw) == "null"
}

func reqStr(m map[string]json.RawMessage, k string) (string, error) {
	raw, ok := m[k]
	if !ok || isNull(raw) {
		return "", fmt.Errorf("missing required field %q", k)
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", err
	}
	return s, nil
}

func optStr(m map[string]json.RawMessage, k string) (*string, error) {
	raw, ok := m[k]
	if !ok || isNull(raw) {
		return nil, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func optBool(m map[string]json.RawMessage, k string) (*bool, error) {
	raw, ok := m[k]
	if !ok || isNull(raw) {
		return nil, nil
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func defBool(m map[string]json.RawMessage, k string) (bool, error) {
	raw, ok := m[k]
	if !ok || isNull(raw) {
		return false, nil
	}
	var v bool
	if err := json.Unmarshal(raw, &v); err != nil {
		return false, err
	}
	return v, nil
}

func optF64(m map[string]json.RawMessage, k string) (*float64, error) {
	raw, ok := m[k]
	if !ok || isNull(raw) {
		return nil, nil
	}
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func optU32(m map[string]json.RawMessage, k string) (*uint32, error) {
	raw, ok := m[k]
	if !ok || isNull(raw) {
		return nil, nil
	}
	var v uint32
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func optStrSlice(m map[string]json.RawMessage, k string) (*[]string, error) {
	raw, ok := m[k]
	if !ok || isNull(raw) {
		return nil, nil
	}
	var v []string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return &v, nil
}
