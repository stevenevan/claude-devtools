package error_hotspots

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
)

type errorAccumulator struct {
	occurrences uint32
	sessions    map[string]struct{}
	lastSeenMs  float64
}

func scanSessionHotspots(
	path, sessionID string,
	accumulator map[[2]string]*errorAccumulator,
) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	inFlight := make(map[string]toolCall)
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		var entry rawEntry
		if json.Unmarshal([]byte(line), &entry) != nil {
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
		if json.Unmarshal(*entry.Message.Content, &blocks) != nil {
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
				if block.ID == "" {
					continue
				}
				name := block.Name
				if name == "" {
					name = "unknown"
				}
				inFlight[block.ID] = toolCall{toolName: name}
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

				if block.IsError == nil || !*block.IsError {
					continue
				}
				resultText := ""
				if block.Content != nil {
					resultText = toolResultText(*block.Content)
				}
				prefix := normalizeErrorPrefix(resultText)
				if prefix == "" {
					continue
				}
				key := [2]string{call.toolName, prefix}
				acc := accumulator[key]
				if acc == nil {
					acc = &errorAccumulator{sessions: make(map[string]struct{})}
					accumulator[key] = acc
				}
				acc.occurrences++
				acc.sessions[sessionID] = struct{}{}
				if tsMs > acc.lastSeenMs {
					acc.lastSeenMs = tsMs
				}
			}
		}
	}
}

// ComputeErrorHotspots scans sessions and returns repeated tool errors.
// Mirrors hotspots.rs::compute_error_hotspots.
func ComputeErrorHotspots(projectID string, days, minOccurrences uint32) (*ErrorHotspotsResponse, error) {
	projectDir, err := resolveProjectDir(projectID)
	if err != nil {
		return nil, err
	}
	if days < 1 {
		days = 1
	}
	if days > 90 {
		days = 90
	}
	if minOccurrences < 2 {
		minOccurrences = 2
	}

	nowMs := float64(time.Now().UnixMilli())
	cutoffMs := nowMs - float64(days)*86_400_000.0

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}

	accumulator := make(map[[2]string]*errorAccumulator)
	var scannedSessions uint32

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if float64(info.ModTime().UnixMilli()) < cutoffMs {
			continue
		}
		sessionID := strings.TrimSuffix(entry.Name(), ".jsonl")
		scannedSessions++
		scanSessionHotspots(projectDir+"/"+entry.Name(), sessionID, accumulator)
	}

	var hotspots []RepeatedToolError
	for key, acc := range accumulator {
		if acc.occurrences < minOccurrences {
			continue
		}
		sessionIDs := make([]string, 0, len(acc.sessions))
		for sid := range acc.sessions {
			sessionIDs = append(sessionIDs, sid)
		}
		sort.Strings(sessionIDs)
		hotspots = append(hotspots, RepeatedToolError{
			ToolName:     key[0],
			ErrorPrefix:  key[1],
			Occurrences:  acc.occurrences,
			SessionCount: uint32(len(sessionIDs)),
			SessionIDs:   sessionIDs,
			LastSeenMs:   acc.lastSeenMs,
		})
	}
	sort.Slice(hotspots, func(i, j int) bool {
		return hotspots[i].Occurrences > hotspots[j].Occurrences
	})
	if hotspots == nil {
		hotspots = []RepeatedToolError{}
	}

	return &ErrorHotspotsResponse{
		RepeatedErrors:  hotspots,
		ScannedSessions: scannedSessions,
	}, nil
}
