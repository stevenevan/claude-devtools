package parsing

import "claude-devtools/internal/domain"

// deduplicateByRequestID keeps only the last entry per requestId (Claude Code
// writes one streaming entry per token increment, same requestId). Messages
// without a requestId pass through. Mirrors deduplication::deduplicate_by_request_id.
func deduplicateByRequestID(messages []domain.ParsedMessage) []domain.ParsedMessage {
	lastIndex := map[string]int{}
	for i, m := range messages {
		if m.RequestID != nil {
			lastIndex[*m.RequestID] = i
		}
	}
	if len(lastIndex) == 0 {
		return messages
	}
	out := []domain.ParsedMessage{}
	for i, m := range messages {
		if m.RequestID != nil {
			if lastIndex[*m.RequestID] == i {
				out = append(out, m)
			}
		} else {
			out = append(out, m)
		}
	}
	return out
}
