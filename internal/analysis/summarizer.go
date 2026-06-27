package analysis

// summarizer.go ports src-tauri/src/analysis/summarizer.rs.
//
// Produces a 3-bullet TL;DR with no LLM involvement:
//   1. First real user prompt, truncated to 120 chars at word boundary.
//   2. Last AI text response, truncated to 120 chars at word boundary.
//   3. Top-3 tools by invocation count, format "Read×4, Bash×2, Edit×1".

import (
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"claude-devtools/internal/domain"
)

const summaryTruncateChars = 120
const topTools = 3

// SessionTldr mirrors analysis/summarizer.rs::SessionTldr.
type SessionTldr struct {
	FirstUserPrompt *string `json:"firstUserPrompt"`
	LastAiResponse  *string `json:"lastAiResponse"`
	ToolSummary     string  `json:"toolSummary"`
}

// BuildSessionTldr mirrors summarizer::build_session_tldr.
func BuildSessionTldr(messages []domain.ParsedMessage) SessionTldr {
	return SessionTldr{
		FirstUserPrompt: firstUserPrompt(messages),
		LastAiResponse:  lastAiResponse(messages),
		ToolSummary:     toolSummary(messages),
	}
}

func firstUserPrompt(messages []domain.ParsedMessage) *string {
	for _, msg := range messages {
		if !isParsedRealUserMsg(msg) {
			continue
		}
		text := strings.TrimSpace(extractText(msg.Content))
		if text == "" {
			continue
		}
		truncated := truncateAtWordBoundary(text, summaryTruncateChars)
		return &truncated
	}
	return nil
}

func lastAiResponse(messages []domain.ParsedMessage) *string {
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		if msg.MessageType != "assistant" {
			continue
		}
		text := strings.TrimSpace(extractText(msg.Content))
		if text == "" {
			continue
		}
		truncated := truncateAtWordBoundary(text, summaryTruncateChars)
		return &truncated
	}
	return nil
}

func toolSummary(messages []domain.ParsedMessage) string {
	counts := map[string]uint32{}
	for _, msg := range messages {
		for _, tc := range msg.ToolCalls {
			counts[tc.Name]++
		}
	}
	if len(counts) == 0 {
		return "no tool calls"
	}

	type entry struct {
		name  string
		count uint32
	}
	entries := make([]entry, 0, len(counts))
	for name, n := range counts {
		entries = append(entries, entry{name, n})
	}
	// Sort descending by count, tie-break ascending by name (matches Rust's stable sort).
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].count != entries[j].count {
			return entries[i].count > entries[j].count
		}
		return entries[i].name < entries[j].name
	})

	if len(entries) > topTools {
		entries = entries[:topTools]
	}

	parts := make([]string, len(entries))
	for i, e := range entries {
		parts[i] = e.name + "×" + strconv.FormatUint(uint64(e.count), 10)
	}
	return strings.Join(parts, ", ")
}

// extractText pulls text out of a ParsedMessageContent — mirrors summarizer::extract_text.
func extractText(content domain.ParsedMessageContent) string {
	if content.Text != nil {
		return *content.Text
	}
	var parts []string
	for _, b := range content.Blocks {
		if b.Type == "text" && b.Text != nil {
			parts = append(parts, *b.Text)
		}
	}
	return strings.Join(parts, " ")
}

// truncateAtWordBoundary mirrors summarizer::truncate_at_word_boundary.
// Counts Unicode code points (runes), not bytes, matching Rust's chars().count().
func truncateAtWordBoundary(input string, maxChars int) string {
	if utf8.RuneCountInString(input) <= maxChars {
		return input
	}
	// Take first maxChars runes.
	runes := []rune(input)
	truncated := string(runes[:maxChars])
	// Find last whitespace in the truncated string.
	idx := strings.LastIndexFunc(truncated, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r'
	})
	if idx > 0 {
		return strings.TrimRight(truncated[:idx], " \t\n\r") + "…"
	}
	return strings.TrimRight(truncated, " \t\n\r") + "…"
}

// isParsedRealUserMsg mirrors content_type::is_parsed_real_user_message for the
// summarizer. Duplicated locally to avoid a circular import; parsing imports domain,
// analysis imports parsing — fine. But summarizer lives in analysis, not parsing.
func isParsedRealUserMsg(m domain.ParsedMessage) bool {
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

