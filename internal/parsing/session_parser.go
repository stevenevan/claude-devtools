package parsing

// session_parser.go ports src-tauri/src/parsing/session_parser/mod.rs and
// src-tauri/src/parsing/session_parser/incremental.rs to Go.
//
// Exported functions added here (do NOT touch ParseJSONLFile or CalculateMetrics):
//
//   ParseSessionFile(path) (domain.ParsedSession, error)
//   ProcessMessages(messages, meta) domain.ParsedSession
//   ParseJSONLIncremental(path, byteOffset, prevMeta) ([]domain.ParsedMessage, SessionFileMetadata, uint64, error)

import (
	"bufio"
	"io"
	"os"

	"claude-devtools/internal/domain"
)

// isParsedRealUserMessage mirrors parsing/content_type.rs::is_parsed_real_user_message.
// A real user message is type=user, !isMeta, and has at least one text or image block.
func isParsedRealUserMessage(m domain.ParsedMessage) bool {
	if m.MessageType != "user" || m.IsMeta {
		return false
	}
	if m.Content.Text != nil {
		return true
	}
	for _, b := range m.Content.Blocks {
		if b.Type == "text" || b.Type == "image" {
			return true
		}
	}
	return false
}

// getTaskCalls extracts ToolCalls that are marked IsTask from all messages.
// Mirrors session_parser::get_task_calls.
func getTaskCalls(messages []domain.ParsedMessage) []domain.ToolCall {
	var out []domain.ToolCall
	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			if tc.IsTask {
				out = append(out, tc)
			}
		}
	}
	if out == nil {
		return []domain.ToolCall{}
	}
	return out
}

// ProcessMessages mirrors session_parser::process_messages.
// It computes metrics, buckets messages by type, and splits main/sidechain.
func ProcessMessages(messages []domain.ParsedMessage, meta SessionFileMetadata) domain.ParsedSession {
	metrics := CalculateMetrics(messages)
	taskCalls := getTaskCalls(messages)

	byType := domain.MessagesByType{
		User:         []domain.ParsedMessage{},
		RealUser:     []domain.ParsedMessage{},
		InternalUser: []domain.ParsedMessage{},
		Assistant:    []domain.ParsedMessage{},
		System:       []domain.ParsedMessage{},
		Other:        []domain.ParsedMessage{},
	}

	sidechainMessages := []domain.ParsedMessage{}
	mainMessages := []domain.ParsedMessage{}

	for _, msg := range messages {
		switch msg.MessageType {
		case "user":
			byType.User = append(byType.User, msg)
			if isParsedRealUserMessage(msg) {
				byType.RealUser = append(byType.RealUser, msg)
			}
			if msg.IsMeta {
				byType.InternalUser = append(byType.InternalUser, msg)
			}
		case "assistant":
			byType.Assistant = append(byType.Assistant, msg)
		case "system":
			byType.System = append(byType.System, msg)
		default:
			byType.Other = append(byType.Other, msg)
		}

		if msg.IsSidechain {
			sidechainMessages = append(sidechainMessages, msg)
		} else {
			mainMessages = append(mainMessages, msg)
		}
	}

	return domain.ParsedSession{
		Messages:          messages,
		Metrics:           metrics,
		TaskCalls:         taskCalls,
		ByType:            byType,
		SidechainMessages: sidechainMessages,
		MainMessages:      mainMessages,
		CustomTitle:       meta.CustomTitle,
		AgentName:         meta.AgentName,
	}
}

// ParseSessionFile mirrors session_parser::parse_session_file.
// Calls ParseJSONLFile then ProcessMessages.
func ParseSessionFile(path string) (domain.ParsedSession, error) {
	messages, meta, err := ParseJSONLFile(path)
	if err != nil {
		return domain.ParsedSession{}, err
	}
	return ProcessMessages(messages, meta), nil
}

// ParseJSONLIncremental mirrors session_parser::incremental::parse_jsonl_incremental.
// Seeks to byteOffset in the file and reads only newly-appended lines.
// Returns (newMessages, updatedMetadata, newByteOffset, error).
// If the file has not grown, returns empty messages and the original offset.
// A partial trailing line (incomplete write) is skipped — offset stops before it.
func ParseJSONLIncremental(
	path string,
	byteOffset uint64,
	prevMeta SessionFileMetadata,
) ([]domain.ParsedMessage, SessionFileMetadata, uint64, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.ParsedMessage{}, prevMeta, byteOffset, nil
		}
		return nil, prevMeta, byteOffset, err
	}

	fileLen := uint64(info.Size())
	if fileLen <= byteOffset {
		return []domain.ParsedMessage{}, prevMeta, byteOffset, nil
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, prevMeta, byteOffset, err
	}
	defer f.Close()

	if _, err := f.Seek(int64(byteOffset), io.SeekStart); err != nil {
		return nil, prevMeta, byteOffset, err
	}

	meta := prevMeta
	var messages []domain.ParsedMessage
	currentOffset := byteOffset

	reader := bufio.NewReader(f)
	for {
		// ReadString reads until '\n' or EOF.
		// If it returns a line without '\n' at the end, it's a partial write — stop.
		raw, readErr := reader.ReadString('\n')
		if len(raw) == 0 {
			break
		}

		// Check whether the line was newline-terminated.
		hasNewline := len(raw) > 0 && raw[len(raw)-1] == '\n'

		if !hasNewline {
			// Partial line — concurrent write in progress. Stop without advancing.
			// This matches the Rust `Err(_) => break` on the BufRead::lines iterator.
			break
		}

		// Strip the trailing newline (and optional \r\n).
		line := raw
		if len(line) > 0 && line[len(line)-1] == '\n' {
			line = line[:len(line)-1]
		}
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}

		// Advance offset: line content bytes + the newline byte.
		// Rust: current_offset += line.len() as u64 + 1
		// (Rust's BufRead::lines strips the newline, so +1 accounts for it.)
		currentOffset += uint64(len(line)) + 1

		if msg := parseJSONLLine(line, &meta); msg != nil {
			messages = append(messages, *msg)
		}

		if readErr != nil {
			break
		}
	}

	if messages == nil {
		messages = []domain.ParsedMessage{}
	}
	return messages, meta, currentOffset, nil
}
