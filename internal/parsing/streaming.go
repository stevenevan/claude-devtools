package parsing

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"

	"claude-devtools/internal/domain"
)

// MaxJSONLLineBytes caps a single line before serde/json. Over-cap lines are
// dropped and parsing continues (matches streaming.rs MAX_JSONL_LINE_BYTES).
const MaxJSONLLineBytes = 10 * 1024 * 1024

// SessionFileMetadata — session-level metadata from non-message entries.
type SessionFileMetadata struct {
	CustomTitle *string
	AgentName   *string
}

// parseJSONLLine is the shared per-line parser (streaming.rs::parse_jsonl_line).
func parseJSONLLine(line string, meta *SessionFileMetadata) *domain.ParsedMessage {
	if strings.TrimSpace(line) == "" {
		return nil
	}
	if len(line) > MaxJSONLLineBytes {
		return nil // drop oversized, continue
	}
	var entry domain.RawJsonlEntry
	if json.Unmarshal([]byte(line), &entry) != nil {
		return nil
	}
	switch entry.EntryType {
	case "custom-title":
		if entry.CustomTitle != nil {
			meta.CustomTitle = entry.CustomTitle
		}
	case "agent-name":
		if entry.AgentName != nil {
			meta.AgentName = entry.AgentName
		}
	}
	return parseEntry(&entry)
}

// ParseJSONLFile streams a session file line-by-line (streaming.rs::parse_jsonl_file).
// A missing file yields empty results, matching Rust.
func ParseJSONLFile(path string) ([]domain.ParsedMessage, SessionFileMetadata, error) {
	meta := SessionFileMetadata{}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.ParsedMessage{}, meta, nil
		}
		return nil, meta, err
	}
	defer f.Close()

	messages := []domain.ParsedMessage{}
	r := bufio.NewReader(f)
	for {
		raw, readErr := r.ReadString('\n')
		line := strings.TrimSuffix(strings.TrimRight(raw, "\n"), "\r")
		if line != "" || raw != "" {
			if msg := parseJSONLLine(line, &meta); msg != nil {
				messages = append(messages, *msg)
			}
		}
		if readErr != nil {
			break
		}
	}
	return messages, meta, nil
}
