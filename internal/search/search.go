// Package search ports analysis/content_search.rs and nl_query.rs.
// Layering: imports domain only — no services, no application.
package search

import (
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"claude-devtools/internal/domain"
)

// ---------------------------------------------------------------------------
// Types — mirrors types/search.rs
// ---------------------------------------------------------------------------

// ContentMatchSource mirrors the Rust enum (camelCase via JSON tags).
type ContentMatchSource string

const (
	SourceUserMessage      ContentMatchSource = "userMessage"
	SourceAiText           ContentMatchSource = "aiText"
	SourceAiThinking       ContentMatchSource = "aiThinking"
	SourceToolCallName     ContentMatchSource = "toolCallName"
	SourceToolCallInput    ContentMatchSource = "toolCallInput"
	SourceToolResultContent ContentMatchSource = "toolResultContent"
	SourceSystemText       ContentMatchSource = "systemText"
)

// ContentSearchMatch mirrors types/search.rs::ContentSearchMatch.
type ContentSearchMatch struct {
	ChunkIndex        int                `json:"chunkIndex"`
	ChunkID           string             `json:"chunkId"`
	ChunkType         string             `json:"chunkType"`
	Source            ContentMatchSource `json:"source"`
	ContentBlockIndex int                `json:"contentBlockIndex"`
	CharOffset        int                `json:"charOffset"`
	MatchLength       int                `json:"matchLength"`
	ContextSnippet    string             `json:"contextSnippet"`
	MatchedText       string             `json:"matchedText"`
}

// ContentSearchResult mirrors types/search.rs::ContentSearchResult.
type ContentSearchResult struct {
	Matches        []ContentSearchMatch `json:"matches"`
	TotalMatches   int                  `json:"totalMatches"`
	NextCursor     *int                 `json:"nextCursor"`
	HasMore        bool                 `json:"hasMore"`
	Query          string               `json:"query"`
	IsRegex        bool                 `json:"isRegex"`
	ChunksSearched int                  `json:"chunksSearched"`
}

// ---------------------------------------------------------------------------
// Matcher — mirrors content_search.rs SearchMatcher
// ---------------------------------------------------------------------------

type searchMatcher struct {
	plain         bool
	queryLower    string
	caseSensitive bool
	original      string
	re            *regexp.Regexp
}

func newMatcher(query string, isRegex, caseSensitive bool) (*searchMatcher, error) {
	if isRegex {
		flags := "(?i)"
		if caseSensitive {
			flags = ""
		}
		re, err := regexp.Compile(flags + query)
		if err != nil {
			return nil, err
		}
		return &searchMatcher{re: re}, nil
	}
	return &searchMatcher{
		plain:         true,
		queryLower:    strings.ToLower(query),
		caseSensitive: caseSensitive,
		original:      query,
	}, nil
}

// findAll returns (charOffset, charLen) pairs for all matches in text.
// Mirrors content_search.rs SearchMatcher::find_all.
func (m *searchMatcher) findAll(text string) [][2]int {
	if m.re != nil {
		var out [][2]int
		for _, loc := range m.re.FindAllStringIndex(text, -1) {
			charOff := utf8.RuneCountInString(text[:loc[0]])
			charLen := utf8.RuneCountInString(text[loc[0]:loc[1]])
			out = append(out, [2]int{charOff, charLen})
		}
		return out
	}
	// Plain search.
	if m.caseSensitive {
		return plainFindAll(text, m.original)
	}
	lower := strings.ToLower(text)
	byteMatches := plainFindAll(lower, m.queryLower)
	runes := []rune(text)
	qLen := utf8.RuneCountInString(m.original)
	out := make([][2]int, 0, len(byteMatches))
	for _, bm := range byteMatches {
		charOff := utf8.RuneCountInString(text[:bm[0]])
		_ = runes // ensure runes slice exists for len reference
		out = append(out, [2]int{charOff, qLen})
	}
	return out
}

// plainFindAll mirrors content_search.rs::plain_find_all.
func plainFindAll(haystack, needle string) [][2]int {
	if len(needle) == 0 {
		return nil
	}
	var out [][2]int
	start := 0
	for {
		idx := strings.Index(haystack[start:], needle)
		if idx < 0 {
			break
		}
		abs := start + idx
		out = append(out, [2]int{abs, len(needle)})
		start = abs + len(needle)
	}
	return out
}

// ---------------------------------------------------------------------------
// Snippet extraction — mirrors content_search.rs
// ---------------------------------------------------------------------------

func extractSnippet(text string, charOffset, matchLen int) string {
	runes := []rune(text)
	total := len(runes)
	const ctx = 50
	start := charOffset - ctx
	if start < 0 {
		start = 0
	}
	end := charOffset + matchLen + ctx
	if end > total {
		end = total
	}
	return string(runes[start:end])
}

func matchedTextFrom(text string, charOffset, matchLen int) string {
	runes := []rune(text)
	if charOffset >= len(runes) {
		return ""
	}
	end := charOffset + matchLen
	if end > len(runes) {
		end = len(runes)
	}
	return string(runes[charOffset:end])
}

// ---------------------------------------------------------------------------
// Region extraction — mirrors content_search.rs extract_regions
// ---------------------------------------------------------------------------

type searchableRegion struct {
	text              string
	source            ContentMatchSource
	contentBlockIndex int
}

func extractRegions(chunk domain.EnhancedChunk) []searchableRegion {
	var regions []searchableRegion

	switch chunk.Type {
	case "user":
		if chunk.User == nil {
			break
		}
		c := chunk.User.UserMessage.Content
		if c.Text != nil {
			regions = append(regions, searchableRegion{*c.Text, SourceUserMessage, 0})
		} else {
			for i, blk := range c.Blocks {
				if blk.Type == "text" && blk.Text != nil {
					regions = append(regions, searchableRegion{*blk.Text, SourceUserMessage, i})
				}
			}
		}

	case "ai":
		if chunk.Ai == nil {
			break
		}
		for ri, msg := range chunk.Ai.Responses {
			extracted := extractMessageText(msg.Content)
			for _, e := range extracted {
				regions = append(regions, searchableRegion{e.text, e.source, ri*100 + e.blockIndex})
			}
		}
		for ei, exec := range chunk.Ai.ToolExecutions {
			regions = append(regions, searchableRegion{exec.ToolCall.Name, SourceToolCallName, 1000 + ei})
			inputStr, _ := json.Marshal(exec.ToolCall.Input)
			regions = append(regions, searchableRegion{string(inputStr), SourceToolCallInput, 1000 + ei})
			if exec.Result != nil {
				resultStr, _ := json.Marshal(exec.Result.Content)
				if len(resultStr) > 0 {
					regions = append(regions, searchableRegion{string(resultStr), SourceToolResultContent, 1000 + ei})
				}
			}
		}

	case "system":
		if chunk.System == nil {
			break
		}
		regions = append(regions, searchableRegion{chunk.System.CommandOutput, SourceSystemText, 0})

	case "compact":
		if chunk.Compact == nil {
			break
		}
		c := chunk.Compact.Message.Content
		if c.Text != nil {
			regions = append(regions, searchableRegion{*c.Text, SourceSystemText, 0})
		} else {
			for i, blk := range c.Blocks {
				if blk.Type == "text" && blk.Text != nil {
					regions = append(regions, searchableRegion{*blk.Text, SourceSystemText, i})
				}
			}
		}

	case "event":
		// Events rarely contain searchable user content — skip (mirrors Rust).
	}

	return regions
}

type msgTextResult struct {
	text       string
	source     ContentMatchSource
	blockIndex int
}

func extractMessageText(content domain.ParsedMessageContent) []msgTextResult {
	if content.Text != nil {
		return []msgTextResult{{*content.Text, SourceAiText, 0}}
	}
	var out []msgTextResult
	for i, blk := range content.Blocks {
		switch blk.Type {
		case "text":
			if blk.Text != nil {
				out = append(out, msgTextResult{*blk.Text, SourceAiText, i})
			}
		case "thinking":
			if blk.Thinking != nil {
				out = append(out, msgTextResult{*blk.Thinking, SourceAiThinking, i})
			}
		case "tool_use":
			name := ""
			if blk.Name != nil {
				name = *blk.Name
			}
			out = append(out, msgTextResult{name, SourceToolCallName, i})
			inputStr, _ := json.Marshal(blk.Input)
			out = append(out, msgTextResult{string(inputStr), SourceToolCallInput, i})
		case "tool_result":
			if blk.Content != nil {
				text := toolResultText(blk.Content)
				if text != "" {
					out = append(out, msgTextResult{text, SourceToolResultContent, i})
				}
			}
		}
	}
	return out
}

func toolResultText(v *domain.ToolResultContentValue) string {
	if v == nil {
		return ""
	}
	if v.Text != nil {
		return *v.Text
	}
	var parts []string
	for _, blk := range v.Blocks {
		if blk.Type == "text" && blk.Text != nil {
			parts = append(parts, *blk.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func chunkID(chunk domain.EnhancedChunk) string {
	switch chunk.Type {
	case "user":
		if chunk.User != nil {
			return chunk.User.ID
		}
	case "ai":
		if chunk.Ai != nil {
			return chunk.Ai.ID
		}
	case "system":
		if chunk.System != nil {
			return chunk.System.ID
		}
	case "compact":
		if chunk.Compact != nil {
			return chunk.Compact.ID
		}
	case "event":
		if chunk.Event != nil {
			return chunk.Event.ID
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Main search function — mirrors content_search.rs::search_chunks
// ---------------------------------------------------------------------------

const defaultPageSize = 100
const maxPageSize = 1000

// SearchChunks searches chunks for query text/regex with pagination.
// Mirrors content_search.rs::search_chunks.
func SearchChunks(
	chunks []domain.EnhancedChunk,
	query string,
	isRegex, caseSensitive bool,
	cursor *int,
	pageSize *int,
) (ContentSearchResult, error) {
	matcher, err := newMatcher(query, isRegex, caseSensitive)
	if err != nil {
		return ContentSearchResult{}, err
	}

	ps := defaultPageSize
	if pageSize != nil {
		ps = *pageSize
		if ps > maxPageSize {
			ps = maxPageSize
		}
	}
	skip := 0
	if cursor != nil {
		skip = *cursor
	}

	var allMatches []ContentSearchMatch
	for ci, chunk := range chunks {
		regions := extractRegions(chunk)
		cid := chunkID(chunk)
		ctype := chunk.Type

		for _, region := range regions {
			hits := matcher.findAll(region.text)
			for _, hit := range hits {
				charOff, matchLen := hit[0], hit[1]
				allMatches = append(allMatches, ContentSearchMatch{
					ChunkIndex:        ci,
					ChunkID:           cid,
					ChunkType:         ctype,
					Source:            region.source,
					ContentBlockIndex: region.contentBlockIndex,
					CharOffset:        charOff,
					MatchLength:       matchLen,
					ContextSnippet:    extractSnippet(region.text, charOff, matchLen),
					MatchedText:       matchedTextFrom(region.text, charOff, matchLen),
				})
			}
		}
	}

	total := len(allMatches)
	end := skip + ps
	if end > total {
		end = total
	}
	var page []ContentSearchMatch
	if skip < total {
		page = allMatches[skip:end]
	}
	if page == nil {
		page = []ContentSearchMatch{}
	}

	consumed := skip + len(page)
	hasMore := consumed < total
	var nextCursor *int
	if hasMore {
		nextCursor = &consumed
	}

	return ContentSearchResult{
		Matches:        page,
		TotalMatches:   total,
		NextCursor:     nextCursor,
		HasMore:        hasMore,
		Query:          query,
		IsRegex:        isRegex,
		ChunksSearched: len(chunks),
	}, nil
}

// ---------------------------------------------------------------------------
// NL query parser — mirrors nl_query.rs
// ---------------------------------------------------------------------------

const msPerDay = 86_400_000.0

// ParsedFilter mirrors nl_query.rs::ParsedFilter.
type ParsedFilter struct {
	DateMin   *float64 `json:"dateMin,omitempty"`
	AgentName *string  `json:"agentName,omitempty"`
	MinCost   *float64 `json:"minCost,omitempty"`
	HasErrors bool     `json:"hasErrors"`
	TextQuery *string  `json:"textQuery,omitempty"`
	Author    *string  `json:"author,omitempty"`
}

// ParseNLQuery parses a natural-language query string. nowMS is Unix millis.
// Mirrors nl_query.rs::parse_query.
func ParseNLQuery(query string, nowMS float64) ParsedFilter {
	var f ParsedFilter

	if dm := parseRelativeWindow(query, nowMS); dm != nil {
		f.DateMin = dm
	}
	if tool := parseKeywordValue(query, "using "); tool != "" {
		f.AgentName = &tool
	}
	if cost := parseDollarAmount(query); cost != nil {
		f.MinCost = cost
	}
	if strings.Contains(strings.ToLower(query), "with errors") {
		f.HasErrors = true
	}
	if text := parseQuotedOrWordAfter(query, "containing "); text != "" {
		f.TextQuery = &text
	}
	if author := parseKeywordValue(query, "by "); author != "" {
		f.Author = &author
	}

	return f
}

// ParseNLQueryNow is a convenience wrapper that uses the current time.
func ParseNLQueryNow(query string) ParsedFilter {
	nowMS := float64(time.Now().UnixMilli())
	return ParseNLQuery(query, nowMS)
}

func parseRelativeWindow(query string, nowMS float64) *float64 {
	lower := strings.ToLower(query)
	idx := strings.Index(lower, "last ")
	if idx < 0 {
		return nil
	}
	after := lower[idx+5:]
	numEnd := 0
	for numEnd < len(after) && after[numEnd] >= '0' && after[numEnd] <= '9' {
		numEnd++
	}
	if numEnd == 0 {
		return nil
	}
	n := parseUint(after[:numEnd])
	rest := strings.TrimLeft(after[numEnd:], " \t")
	var multiplierDays uint64
	switch {
	case strings.HasPrefix(rest, "month"):
		multiplierDays = 30
	case strings.HasPrefix(rest, "week"):
		multiplierDays = 7
	case strings.HasPrefix(rest, "day"):
		multiplierDays = 1
	default:
		return nil
	}
	result := nowMS - float64(n)*float64(multiplierDays)*msPerDay
	return &result
}

func parseKeywordValue(query, prefix string) string {
	lower := strings.ToLower(query)
	idx := strings.Index(lower, strings.ToLower(prefix))
	if idx < 0 {
		return ""
	}
	start := idx + len(prefix)
	rest := query[start:]
	tokenEnd := strings.IndexFunc(rest, func(r rune) bool { return r == ' ' || r == '\t' })
	if tokenEnd < 0 {
		tokenEnd = len(rest)
	}
	token := strings.Trim(rest[:tokenEnd], `"`)
	return token
}

func parseDollarAmount(query string) *float64 {
	lower := strings.ToLower(query)
	idx := strings.Index(lower, "over $")
	if idx < 0 {
		return nil
	}
	after := query[idx+6:]
	end := 0
	seenDot := false
	for end < len(after) {
		ch := after[end]
		if ch >= '0' && ch <= '9' {
			end++
		} else if ch == '.' && !seenDot {
			seenDot = true
			end++
		} else {
			break
		}
	}
	if end == 0 {
		return nil
	}
	f := parseFloat64(after[:end])
	if f == nil {
		return nil
	}
	return f
}

func parseQuotedOrWordAfter(query, prefix string) string {
	lower := strings.ToLower(query)
	idx := strings.Index(lower, strings.ToLower(prefix))
	if idx < 0 {
		return ""
	}
	after := query[idx+len(prefix):]
	trimmed := strings.TrimLeft(after, " \t")
	if strings.HasPrefix(trimmed, `"`) {
		rest := trimmed[1:]
		close := strings.Index(rest, `"`)
		if close < 0 {
			return ""
		}
		return rest[:close]
	}
	end := strings.IndexFunc(trimmed, func(r rune) bool { return r == ' ' || r == '\t' })
	if end < 0 {
		end = len(trimmed)
	}
	return trimmed[:end]
}

// ---------------------------------------------------------------------------
// Mini numeric parsers (no strconv import needed — keep package lean)
// ---------------------------------------------------------------------------

func parseUint(s string) uint64 {
	var n uint64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			break
		}
		n = n*10 + uint64(ch-'0')
	}
	return n
}

func parseFloat64(s string) *float64 {
	// Use strconv via indirect path. We already import strings/time so one more
	// stdlib import is fine — just done at package level.
	// Actually use inline parsing to avoid adding strconv to import block above.
	// Split on '.'.
	parts := strings.SplitN(s, ".", 2)
	intPart := parseUint(parts[0])
	result := float64(intPart)
	if len(parts) == 2 {
		frac := parts[1]
		div := 1.0
		fracVal := 0.0
		for _, ch := range frac {
			if ch < '0' || ch > '9' {
				break
			}
			div *= 10
			fracVal = fracVal*10 + float64(ch-'0')
		}
		result += fracVal / div
	}
	return &result
}
