package discovery

// Paginated session listing — mirrors src-tauri/src/discovery/session_lister.rs.

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"claude-devtools/internal/domain"
)

// SessionsPaginationOptions mirrors types/domain::SessionsPaginationOptions.
type SessionsPaginationOptions struct {
	// PrefilterAll skips sessions that contain only noise messages.
	PrefilterAll bool
}

// sessionFile is an internal record for a discovered JSONL file.
type sessionFile struct {
	id    string
	mtime float64 // ms since epoch
	size  int64
}

// ListSessionsPaginated returns a page of sessions for a project.
// Mirrors session_lister::list_sessions_paginated.
func ListSessionsPaginated(
	projectsDir, claudeDir, projectID string,
	cursor *string,
	limit int,
	options SessionsPaginationOptions,
	registry *SubprojectRegistry,
) (domain.PaginatedSessionsResult, error) {
	baseDir := ExtractBaseDir(projectID)
	projectDir := filepath.Join(projectsDir, baseDir)

	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		return domain.PaginatedSessionsResult{
			Sessions:   []domain.Session{},
			NextCursor: nil,
			HasMore:    false,
			TotalCount: 0,
		}, nil
	}

	// Get session filter for composite IDs.
	sessionFilter := registry.GetSessionFilter(projectID)

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return domain.PaginatedSessionsResult{}, fmt.Errorf("failed to read %s: %w", projectDir, err)
	}

	var sessionFiles []sessionFile

	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".jsonl") || strings.HasPrefix(name, "agent_") {
			continue
		}

		sessionID := strings.TrimSuffix(name, ".jsonl")

		// Apply subproject filter.
		if sessionFilter != nil {
			if _, ok := sessionFilter[sessionID]; !ok {
				continue
			}
		}

		info, err := e.Info()
		if err != nil {
			continue
		}
		mtime := float64(info.ModTime().UnixMilli())
		size := info.Size()

		// Skip noise-only sessions when requested.
		if options.PrefilterAll && size > 0 {
			if !HasNonNoiseMessages(filepath.Join(projectDir, name)) {
				continue
			}
		}

		sessionFiles = append(sessionFiles, sessionFile{id: sessionID, mtime: mtime, size: size})
	}

	// Sort by mtime descending.
	sortSessionsByMtimeDesc(sessionFiles)

	totalCount := uint32(len(sessionFiles))

	// Apply cursor.
	startIndex := 0
	if cursor != nil {
		startIndex = parseCursor(*cursor, sessionFiles)
	}

	// Paginate.
	end := startIndex + limit
	if end > len(sessionFiles) {
		end = len(sessionFiles)
	}
	page := sessionFiles[startIndex:end]

	hasMore := startIndex+limit < len(sessionFiles)
	var nextCursor *string
	if hasMore {
		sf := sessionFiles[startIndex+limit]
		nc := encodeCursor(sf.mtime, sf.id)
		nextCursor = &nc
	}

	// Build session metadata.
	decodedPath := DecodePath(baseDir)
	sessions := make([]domain.Session, 0, len(page))

	for _, sf := range page {
		todoData := loadTodoData(claudeDir, sf.id)
		hasSubs := HasSubagents(projectsDir, projectID, sf.id)
		filePath := filepath.Join(projectDir, sf.id+".jsonl")
		preview := extractSessionPreview(filePath)
		isOngoing := DetectOngoing(filePath)

		sessions = append(sessions, domain.Session{
			ID:               sf.id,
			ProjectID:        projectID,
			ProjectPath:      decodedPath,
			TodoData:         todoData,
			CreatedAt:        sf.mtime,
			FirstMessage:     preview.firstMessage,
			MessageTimestamp: preview.messageTimestamp,
			HasSubagents:     hasSubs,
			MessageCount:     0,
			IsOngoing:        isOngoing,
			MetadataLevel:    strPtr("light"),
			CustomTitle:      preview.customTitle,
			AgentName:        preview.agentName,
		})
	}

	return domain.PaginatedSessionsResult{
		Sessions:   sessions,
		NextCursor: nextCursor,
		HasMore:    hasMore,
		TotalCount: totalCount,
	}, nil
}

// sortSessionsByMtimeDesc sorts in place, descending mtime.
func sortSessionsByMtimeDesc(files []sessionFile) {
	for i := 1; i < len(files); i++ {
		for j := i; j > 0 && files[j].mtime > files[j-1].mtime; j-- {
			files[j], files[j-1] = files[j-1], files[j]
		}
	}
}

// --- Session preview ---

type sessionPreview struct {
	firstMessage     *string
	messageTimestamp *string
	customTitle      *string
	agentName        *string
}

var noisePrefixes = []string{
	"<local-command-stdout>",
	"<local-command-stderr>",
	"<local-command-caveat>",
	"<system-reminder>",
	"[Request interrupted by user",
}

var commandNameRe = regexp.MustCompile(`<command-name>/([^<]+)</command-name>`)
var stripTagsRe = regexp.MustCompile(`<[^>]+>`)

func sanitizeDisplayContent(text string) string {
	result := text
	result = strings.ReplaceAll(result, "<command-name>", "")
	result = strings.ReplaceAll(result, "</command-name>", "")
	result = strings.ReplaceAll(result, "<command-args>", "")
	result = strings.ReplaceAll(result, "</command-args>", "")
	if !strings.Contains(result, "<") {
		return strings.TrimSpace(result)
	}
	return strings.TrimSpace(stripTagsRe.ReplaceAllString(result, ""))
}

// extractSessionPreview reads up to 200 lines to find the first real user
// message, custom title, and agent name.
func extractSessionPreview(filePath string) sessionPreview {
	f, err := os.Open(filePath)
	if err != nil {
		return sessionPreview{}
	}
	defer f.Close()

	type msgPair struct{ text, timestamp string }
	var commandFallback *msgPair
	var firstMsg *msgPair
	var customTitle, agentName *string
	linesRead := 0

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 10*1024*1024), 10*1024*1024)

	for scanner.Scan() {
		if linesRead >= 200 {
			break
		}
		linesRead++

		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var entry domain.RawJsonlEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}

		// Pick up metadata entries.
		switch entry.EntryType {
		case "custom-title":
			if entry.CustomTitle != nil {
				customTitle = entry.CustomTitle
			}
			continue
		case "agent-name":
			if entry.AgentName != nil {
				agentName = entry.AgentName
			}
			continue
		}

		if firstMsg != nil {
			continue
		}

		if entry.EntryType != "user" || (entry.IsMeta != nil && *entry.IsMeta) {
			continue
		}

		ts := ""
		if entry.Timestamp != nil {
			ts = *entry.Timestamp
		}

		if len(entry.Message) == 0 {
			continue
		}
		var msg map[string]json.RawMessage
		if err := json.Unmarshal(entry.Message, &msg); err != nil {
			continue
		}
		rawContent, ok := msg["content"]
		if !ok {
			continue
		}

		text := extractTextFromContent(rawContent)
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			continue
		}

		isNoise := false
		for _, p := range noisePrefixes {
			if strings.HasPrefix(trimmed, p) {
				isNoise = true
				break
			}
		}
		if isNoise {
			continue
		}

		if strings.HasPrefix(trimmed, "<command-name>") {
			if commandFallback == nil {
				cmdText := "/command"
				if c := commandNameRe.FindStringSubmatch(trimmed); c != nil {
					cmdText = "/" + c[1]
				}
				commandFallback = &msgPair{text: cmdText, timestamp: ts}
			}
			continue
		}

		sanitized := sanitizeDisplayContent(trimmed)
		if sanitized == "" {
			continue
		}

		// Truncate at 500 UTF-8 bytes on a char boundary.
		previewText := sanitized
		if len(previewText) > 500 {
			end := 500
			for end > 0 && !isUTF8Start(previewText[end]) {
				end--
			}
			previewText = previewText[:end]
		}

		firstMsg = &msgPair{text: previewText, timestamp: ts}
	}

	var preview sessionPreview
	if firstMsg != nil {
		preview.firstMessage = &firstMsg.text
		preview.messageTimestamp = &firstMsg.timestamp
	} else if commandFallback != nil {
		preview.firstMessage = &commandFallback.text
		preview.messageTimestamp = &commandFallback.timestamp
	}
	preview.customTitle = customTitle
	preview.agentName = agentName
	return preview
}

// isUTF8Start reports whether b is the first byte of a UTF-8 code point.
func isUTF8Start(b byte) bool {
	return b < 0x80 || b >= 0xC0
}

// extractTextFromContent pulls text out of a JSON content value (string or blocks).
func extractTextFromContent(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var blocks []json.RawMessage
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		var block map[string]json.RawMessage
		if json.Unmarshal(b, &block) != nil {
			continue
		}
		rawType, ok := block["type"]
		if !ok {
			continue
		}
		var btype string
		if json.Unmarshal(rawType, &btype) != nil || btype != "text" {
			continue
		}
		rawText, ok := block["text"]
		if !ok {
			continue
		}
		var t string
		if json.Unmarshal(rawText, &t) == nil {
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, " ")
}

// --- Todo loading ---

func loadTodoData(claudeDir, sessionID string) json.RawMessage {
	path := BuildTodoPath(claudeDir, sessionID)
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return json.RawMessage(b)
}

// --- Cursor encoding ---

func encodeCursor(timestamp float64, sessionID string) string {
	raw := fmt.Sprintf("%v:%s", timestamp, sessionID)
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func parseCursor(cursor string, sessions []sessionFile) int {
	decoded, err := base64.StdEncoding.DecodeString(cursor)
	if err != nil {
		return 0
	}
	raw := string(decoded)
	i := strings.Index(raw, ":")
	if i < 0 {
		return 0
	}
	var cursorTS float64
	if _, err := fmt.Sscanf(raw[:i], "%f", &cursorTS); err != nil {
		return 0
	}
	cursorID := raw[i+1:]

	for idx, sf := range sessions {
		if math.Abs(sf.mtime-cursorTS) < 1.0 && sf.id == cursorID {
			return idx
		}
		if sf.mtime < cursorTS {
			return idx
		}
	}
	return len(sessions)
}
