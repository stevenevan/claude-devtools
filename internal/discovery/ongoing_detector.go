package discovery

// Ongoing session detection.
//
// A session is "ongoing" when the file was modified within the last 120 s AND
// the last JSONL entry indicates an incomplete turn.

import (
	"encoding/json"
	"io"
	"os"
	"strings"
	"time"
)

const (
	ongoingMaxAgeSecs = 120
	tailBufferSize    = 8192
)

// DetectOngoing returns *bool: true if ongoing, false if not, nil on failure.
// Mirrors ongoing_detector::detect_ongoing.
func DetectOngoing(filePath string) *bool {
	info, err := os.Stat(filePath)
	if err != nil {
		return nil
	}

	elapsed := time.Since(info.ModTime())
	if elapsed > time.Duration(ongoingMaxAgeSecs)*time.Second {
		v := false
		return &v
	}

	lastLine, ok := readLastJSONLLine(filePath)
	if !ok {
		return nil
	}

	var entry map[string]json.RawMessage
	if err := json.Unmarshal([]byte(lastLine), &entry); err != nil {
		return nil
	}

	result := isEntryOngoing(entry)
	return &result
}

func isEntryOngoing(entry map[string]json.RawMessage) bool {
	rawType, ok := entry["type"]
	if !ok {
		return false
	}
	var entryType string
	if err := json.Unmarshal(rawType, &entryType); err != nil {
		return false
	}

	switch entryType {
	case "assistant":
		// Inspect stop_reason from the nested message object.
		var stopReason string
		if rawMsg, ok := entry["message"]; ok {
			var msg map[string]json.RawMessage
			if json.Unmarshal(rawMsg, &msg) == nil {
				if rawSR, ok := msg["stop_reason"]; ok {
					_ = json.Unmarshal(rawSR, &stopReason)
				}
			}
		}
		switch stopReason {
		case "end_turn":
			return !hasEndTurnWithoutToolUse(entry)
		case "tool_use":
			return true
		case "max_tokens":
			return false
		case "":
			return true // still streaming
		default:
			return false
		}

	case "user":
		return true

	case "progress":
		return true

	case "system":
		var subtype string
		if rawSub, ok := entry["subtype"]; ok {
			_ = json.Unmarshal(rawSub, &subtype)
		}
		return subtype == "api_error" || subtype == "tool_started"

	case "custom-title", "agent-name", "memory_saved", "turn_duration":
		return false

	default:
		return false
	}
}

func hasEndTurnWithoutToolUse(entry map[string]json.RawMessage) bool {
	rawMsg, ok := entry["message"]
	if !ok {
		return true
	}
	var msg map[string]json.RawMessage
	if json.Unmarshal(rawMsg, &msg) != nil {
		return true
	}
	rawContent, ok := msg["content"]
	if !ok {
		return true
	}
	var blocks []map[string]json.RawMessage
	if json.Unmarshal(rawContent, &blocks) != nil {
		return true
	}
	for _, block := range blocks {
		var btype string
		if rawT, ok := block["type"]; ok {
			_ = json.Unmarshal(rawT, &btype)
		}
		if btype == "tool_use" {
			return false
		}
	}
	return true
}

// readLastJSONLLine reads the last non-empty line from a file without reading the whole file.
func readLastJSONLLine(filePath string) (string, bool) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", false
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		return "", false
	}

	fileLen := info.Size()
	readStart := fileLen - tailBufferSize
	if readStart < 0 {
		readStart = 0
	}

	if _, err := f.Seek(readStart, io.SeekStart); err != nil {
		return "", false
	}

	buf := make([]byte, fileLen-readStart)
	n, err := f.Read(buf)
	if err != nil && err != io.EOF {
		return "", false
	}
	buf = buf[:n]

	content := string(buf)
	lines := strings.Split(content, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.TrimSpace(lines[i]) != "" {
			return lines[i], true
		}
	}
	return "", false
}
