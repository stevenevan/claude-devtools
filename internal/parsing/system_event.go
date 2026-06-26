package parsing

import (
	"encoding/json"

	"claude-devtools/internal/domain"
)

// buildSystemEventData mirrors system_event::build_system_event_data — typed
// payloads for the four displayable system subtypes (others → nil).
func buildSystemEventData(e *domain.RawJsonlEntry) *domain.SystemEventData {
	if e.Subtype == nil {
		return nil
	}
	subtype := *e.Subtype
	switch subtype {
	case "api_error":
		var errorStatus *uint16
		var errorType, errorMessage *string
		if len(e.Error) > 0 {
			var em map[string]json.RawMessage
			if json.Unmarshal(e.Error, &em) == nil {
				if v := asU64opt(em["status"]); v != nil {
					s := uint16(*v)
					errorStatus = &s
				}
				if inner, ok := em["error"]; ok {
					var im map[string]json.RawMessage
					if json.Unmarshal(inner, &im) == nil {
						if t, ok := decodeString(im["type"]); ok {
							errorType = &t
						}
						if msg, ok := decodeString(im["message"]); ok {
							errorMessage = &msg
						}
					}
				}
			}
		}
		if errorType == nil && len(e.Cause) > 0 {
			var cm map[string]json.RawMessage
			if json.Unmarshal(e.Cause, &cm) == nil {
				if code, ok := decodeString(cm["code"]); ok {
					errorType = &code
				}
			}
		}
		return &domain.SystemEventData{
			Subtype:      subtype,
			ErrorStatus:  errorStatus,
			ErrorType:    errorType,
			ErrorMessage: errorMessage,
			RetryAttempt: e.RetryAttempt,
			MaxRetries:   e.MaxRetries,
			RetryInMs:    e.RetryInMs,
		}
	case "bridge_status":
		return &domain.SystemEventData{Subtype: subtype, BridgeContent: e.Content, BridgeURL: e.URL}
	case "memory_saved":
		return &domain.SystemEventData{Subtype: subtype, WrittenPaths: e.WrittenPaths, MemoryVerb: e.Verb}
	case "turn_duration":
		return &domain.SystemEventData{Subtype: subtype, DurationMs: e.DurationMs}
	default:
		return nil
	}
}
