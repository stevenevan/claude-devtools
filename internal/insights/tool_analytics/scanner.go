package tool_analytics

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"time"

	"claude-devtools/internal/tokenizer"
)

// scanSession scans a single JSONL session file and folds tool_use/tool_result
// pairs into stats. Mirrors scanner.rs::scan_session.
func scanSession(path string, stats map[string]*toolStats) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	inFlight := make(map[string]toolCallStart)

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if len(strings.TrimSpace(line)) == 0 {
			continue
		}

		var entry rawEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}

		tsMs := 0.0
		if entry.Timestamp != nil {
			if ms, ok := parseTimestampMs(*entry.Timestamp); ok {
				tsMs = ms
			}
		}

		if entry.Message == nil || entry.Message.Content == nil {
			continue
		}

		role := ""
		if entry.Message.Role != nil {
			role = *entry.Message.Role
		}

		var blocks []json.RawMessage
		if err := json.Unmarshal(*entry.Message.Content, &blocks); err != nil {
			continue
		}

		switch role {
		case "assistant":
			for _, b := range blocks {
				var block struct {
					Type string `json:"type"`
					ID   string `json:"id"`
					Name string `json:"name"`
				}
				if json.Unmarshal(b, &block) != nil || block.Type != "tool_use" {
					continue
				}
				id := block.ID
				if id == "" {
					continue
				}
				name := block.Name
				if name == "" {
					name = "unknown"
				}
				inFlight[id] = toolCallStart{toolName: name, startMs: tsMs}
			}

		case "user":
			for _, b := range blocks {
				var block struct {
					Type      string           `json:"type"`
					ToolUseID string           `json:"tool_use_id"`
					IsError   *bool            `json:"is_error"`
					Content   *json.RawMessage `json:"content"`
				}
				if json.Unmarshal(b, &block) != nil || block.Type != "tool_result" {
					continue
				}
				call, ok := inFlight[block.ToolUseID]
				if !ok {
					continue
				}
				delete(inFlight, block.ToolUseID)

				isError := block.IsError != nil && *block.IsError
				resultText := ""
				if block.Content != nil {
					resultText = toolResultText(*block.Content)
				}
				tokenCount := uint64(tokenizer.CountTokens(resultText))
				duration := tsMs - call.startMs
				if duration < 0 {
					duration = 0
				}

				st := stats[call.toolName]
				if st == nil {
					st = &toolStats{}
					stats[call.toolName] = st
				}
				st.callCount++
				if isError {
					st.errorCount++
				} else {
					st.successCount++
				}
				if duration > 0 {
					st.durationSamples = append(st.durationSamples, duration)
				}
				st.tokenSamples = append(st.tokenSamples, tokenCount)
			}
		}
	}
}

// bucketLocal converts a millisecond UTC timestamp to (weekday, hour) in local
// time. Mirrors scanner.rs::bucket_local.
// weekday: 0=Monday … 6=Sunday (matches chrono num_days_from_monday).
func bucketLocal(tsMs float64) (day, hour uint8, ok bool) {
	secs := int64(tsMs / 1000.0)
	t := time.Unix(secs, 0).Local()
	// Go Weekday: Sunday=0, Monday=1, …, Saturday=6.
	// Chrono num_days_from_monday: Monday=0, …, Sunday=6.
	goWd := int(t.Weekday()) // 0=Sun…6=Sat
	chromoDay := (goWd + 6) % 7 // convert: Mon=0,…,Sun=6
	return uint8(chromoDay), uint8(t.Hour()), true
}

// scanSessionHeatmap walks a session's assistant tool_use blocks, bucketing by
// local (weekday, hour). If toolFilter is non-empty, only matching tool names
// count. Mirrors scanner.rs::scan_session_heatmap.
func scanSessionHeatmap(path string, buckets map[heatmapKey]*heatmapCellAcc, toolFilter string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if len(strings.TrimSpace(line)) == 0 {
			continue
		}

		var entry rawEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		if entry.Timestamp == nil {
			continue
		}
		tsMs, ok := parseTimestampMs(*entry.Timestamp)
		if !ok {
			continue
		}

		if entry.Message == nil || entry.Message.Content == nil {
			continue
		}
		if entry.Message.Role == nil || *entry.Message.Role != "assistant" {
			continue
		}

		var blocks []json.RawMessage
		if json.Unmarshal(*entry.Message.Content, &blocks) != nil {
			continue
		}

		day, hour, _ := bucketLocal(tsMs)

		for _, b := range blocks {
			var block struct {
				Type string `json:"type"`
				Name string `json:"name"`
			}
			if json.Unmarshal(b, &block) != nil || block.Type != "tool_use" {
				continue
			}
			name := block.Name
			if name == "" {
				name = "unknown"
			}
			if toolFilter != "" && name != toolFilter {
				continue
			}
			key := makeHeatmapKey(day, hour)
			cell := buckets[key]
			if cell == nil {
				cell = &heatmapCellAcc{perTool: make(map[string]uint32)}
				buckets[key] = cell
			}
			cell.total++
			cell.perTool[name]++
		}
	}
}
