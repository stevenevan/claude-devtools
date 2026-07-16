// Fast JSONL scan.
// Extracts only analytics-relevant fields without full message parsing.
package analytics

import (
	"bufio"
	"encoding/json"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"claude-devtools/internal/ptr"
)

// ActiveGapCapMs is the maximum gap that counts as active time (5 minutes).
// Mirrors session_scan::ACTIVE_GAP_CAP_MS.
const ActiveGapCapMs = 5.0 * 60.0 * 1000.0

// SessionSummary holds the minimal data extracted from a session for analytics.
// Mirrors session_scan::SessionSummary.
type SessionSummary struct {
	InputTokens           uint64
	OutputTokens          uint64
	CacheReadTokens       uint64
	CacheCreationTokens   uint64
	DurationMs            float64
	Model                 *string
	FirstTimestampMs      *float64
	LastTimestampMs       *float64
	FirstUserText         *string
	CustomTitle           *string
	ToolCallCount         uint64
	ToolErrorCount        uint64
	AssistantMessageCount uint64
	ActiveMs              float64
}

// quickEntry is the minimal JSONL shape needed for analytics scanning.
type quickEntry struct {
	Type        *string     `json:"type"`
	Role        *string     `json:"role"`
	Model       *string     `json:"model"`
	Timestamp   *string     `json:"timestamp"`
	Usage       *quickUsage `json:"usage"`
	Message     *quickMsg   `json:"message"`
	IsMeta      *bool       `json:"isMeta"`
	CustomTitle *string     `json:"customTitle"`
}

type quickUsage struct {
	InputTokens              *uint64 `json:"input_tokens"`
	OutputTokens             *uint64 `json:"output_tokens"`
	CacheReadInputTokens     *uint64 `json:"cache_read_input_tokens"`
	CacheCreationInputTokens *uint64 `json:"cache_creation_input_tokens"`
}

type quickMsg struct {
	Role    *string          `json:"role"`
	Model   *string          `json:"model"`
	Usage   *quickUsage      `json:"usage"`
	Content *json.RawMessage `json:"content"`
}

// ScanSessionFast scans a JSONL file and returns a SessionSummary, or nil when
// the file has no token data. Mirrors session_scan::scan_session_fast.
func ScanSessionFast(filePath string) *SessionSummary {
	f, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer f.Close()

	var (
		inputTokens  uint64
		outputTokens uint64
		cacheRead    uint64
		cacheCreate  uint64
		modelCounts  = map[string]uint32{}
		firstTs      *float64
		lastTs       *float64
		prevTs       *float64
		activeMs     float64
		toolCalls    uint64
		toolErrors   uint64
		assistantMsg uint64
		firstUser    *string
		customTitle  *string
	)

	scanner := bufio.NewReaderSize(f, 64*1024)
	for {
		line, err := scanner.ReadString('\n')
		if err != nil && line == "" {
			break
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		var entry quickEntry
		if jsonErr := json.Unmarshal([]byte(line), &entry); jsonErr != nil {
			continue
		}

		// customTitle: first non-nil value wins.
		if customTitle == nil && entry.CustomTitle != nil {
			customTitle = entry.CustomTitle
		}

		// Timestamp tracking and active-ms accumulation.
		if entry.Timestamp != nil {
			if ms := parseTimestampMs(*entry.Timestamp); ms != nil {
				if firstTs == nil {
					firstTs = ms
				}
				lastTs = ms
				if prevTs != nil {
					diff := *ms - *prevTs
					if diff > 0.0 {
						if diff < ActiveGapCapMs {
							activeMs += diff
						} else {
							activeMs += ActiveGapCapMs
						}
					}
				}
				prevTs = ms
			}
		}

		// Resolve role/model/usage from nested message or top-level fields.
		role, model, usage := resolveFields(&entry)

		if usage != nil {
			inputTokens += u64val(usage.InputTokens)
			outputTokens += u64val(usage.OutputTokens)
			cacheRead += u64val(usage.CacheReadInputTokens)
			cacheCreate += u64val(usage.CacheCreationInputTokens)
		}

		if role == "assistant" {
			assistantMsg++
			if model != "" && model != "<synthetic>" {
				modelCounts[model]++
			}
		}

		// Count tool_use / tool_result blocks in message.content.
		if entry.Message != nil && entry.Message.Content != nil {
			toolCalls, toolErrors = countToolBlocks(*entry.Message.Content, toolCalls, toolErrors)
		}

		// Capture the first real user message text.
		if firstUser == nil &&
			role == "user" &&
			(entry.IsMeta == nil || !*entry.IsMeta) &&
			ptr.Deref(entry.Type) == "user" {
			if entry.Message != nil && entry.Message.Content != nil {
				firstUser = extractFirstUserText(*entry.Message.Content)
			}
		}
	}

	total := inputTokens + outputTokens + cacheRead + cacheCreate
	if total == 0 {
		return nil
	}

	// Extract primary model — max count wins, alphabetical tie-break for determinism.
	var primaryModel *string
	bestCount := uint32(0)
	bestName := ""
	for m, c := range modelCounts {
		if c > bestCount || (c == bestCount && (bestName == "" || m < bestName)) {
			bestCount = c
			bestName = m
			m2 := m
			primaryModel = &m2
		}
	}

	durationMs := 0.0
	if firstTs != nil && lastTs != nil && *lastTs > *firstTs {
		durationMs = *lastTs - *firstTs
	}

	return &SessionSummary{
		InputTokens:           inputTokens,
		OutputTokens:          outputTokens,
		CacheReadTokens:       cacheRead,
		CacheCreationTokens:   cacheCreate,
		DurationMs:            durationMs,
		Model:                 primaryModel,
		FirstTimestampMs:      firstTs,
		LastTimestampMs:       lastTs,
		FirstUserText:         firstUser,
		CustomTitle:           customTitle,
		ToolCallCount:         toolCalls,
		ToolErrorCount:        toolErrors,
		AssistantMessageCount: assistantMsg,
		ActiveMs:              activeMs,
	}
}

// ActiveMsFromSorted computes gap-adjusted active milliseconds from a sorted
// timestamp slice. Mirrors session_scan::active_ms_from_sorted.
func ActiveMsFromSorted(timestampsMs []float64) float64 {
	total := 0.0
	for i := 1; i < len(timestampsMs); i++ {
		diff := timestampsMs[i] - timestampsMs[i-1]
		if diff > 0.0 {
			if diff < ActiveGapCapMs {
				total += diff
			} else {
				total += ActiveGapCapMs
			}
		}
	}
	return total
}

// --- helpers ---

func parseTimestampMs(ts string) *float64 {
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		// Fallback: try without nanoseconds.
		t, err = time.Parse(time.RFC3339, ts)
		if err != nil {
			return nil
		}
	}
	ms := float64(t.UnixMilli())
	return &ms
}

func resolveFields(entry *quickEntry) (role, model string, usage *quickUsage) {
	if entry.Message != nil {
		role = ptr.Deref(entry.Message.Role)
		model = ptr.Deref(entry.Message.Model)
		usage = entry.Message.Usage
	} else {
		role = ptr.Deref(entry.Role)
		model = ptr.Deref(entry.Model)
		usage = entry.Usage
	}
	return
}

func countToolBlocks(raw json.RawMessage, calls, errors uint64) (uint64, uint64) {
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return calls, errors
	}
	for _, block := range arr {
		var b struct {
			Type    string `json:"type"`
			IsError *bool  `json:"is_error"`
		}
		if err := json.Unmarshal(block, &b); err != nil {
			continue
		}
		switch {
		case b.Type == "tool_use":
			calls++
		case b.Type == "tool_result" && b.IsError != nil && *b.IsError:
			errors++
		}
	}
	return calls, errors
}

func extractFirstUserText(raw json.RawMessage) *string {
	// Could be a plain string or an array of content blocks.
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return truncatePreview(s)
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil
	}
	for _, block := range arr {
		var b struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal(block, &b); err != nil {
			continue
		}
		if b.Type == "text" {
			return truncatePreview(b.Text)
		}
	}
	return nil
}

func truncatePreview(text string) *string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || strings.HasPrefix(trimmed, "<local-command") {
		return nil
	}
	const maxLen = 100
	if len(trimmed) > maxLen {
		// Truncate at a valid UTF-8 boundary.
		end := maxLen
		for end > 0 && !utf8.RuneStart(trimmed[end]) {
			end--
		}
		s := trimmed[:end] + "..."
		return &s
	}
	return &trimmed
}

func u64val(p *uint64) uint64 {
	if p == nil {
		return 0
	}
	return *p
}
