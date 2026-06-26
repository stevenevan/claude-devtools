// Package searchservice is a thin Wails service wrapper over internal/search
// and internal/discovery. Exposes 5 commands: SearchSessions, SearchAllProjects,
// SearchSessionsFiltered, SearchSessionContent, ParseNlQuery.
// Layering: imports search/discovery/analysis/parsing/cache/domain; no application.
package searchservice

import (
	"fmt"
	"os"
	"path/filepath"

	"claude-devtools/internal/analysis"
	"claude-devtools/internal/cache"
	"claude-devtools/internal/discovery"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
	"claude-devtools/internal/search"
)

// SearchService exposes session-level and content search.
type SearchService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

func New(c *cache.SessionCache) *SearchService { return &SearchService{cache: c} }

func (s *SearchService) Ready() (bool, error) { return true, nil }

// ---------------------------------------------------------------------------
// Internal path helpers (mirrors sessionservice pattern)
// ---------------------------------------------------------------------------

func claudeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude"), nil
}

func projectsDir() (string, error) {
	cd, err := claudeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cd, "projects"), nil
}

// ---------------------------------------------------------------------------
// SearchResult — shared lightweight result type
// ---------------------------------------------------------------------------

// SessionSearchResult mirrors the Rust JSON shape from search_sessions.
type SessionSearchResult struct {
	Results []SessionSearchItem `json:"results"`
	Total   int                 `json:"total"`
	Query   string              `json:"query"`
}

// SessionSearchItem is one entry in a search result.
type SessionSearchItem struct {
	SessionID          string   `json:"sessionId"`
	ProjectID          string   `json:"projectId"`
	ProjectPath        *string  `json:"projectPath,omitempty"`
	Preview            *string  `json:"preview"`
	CustomTitle        *string  `json:"customTitle,omitempty"`
	AgentName          *string  `json:"agentName,omitempty"`
	Timestamp          float64  `json:"timestamp"`
	MessageCount       *uint32  `json:"messageCount,omitempty"`
	IsOngoing          *bool    `json:"isOngoing,omitempty"`
	HasSubagents       *bool    `json:"hasSubagents,omitempty"`
	ContextConsumption *uint64 `json:"contextConsumption,omitempty"`
}

// ---------------------------------------------------------------------------
// SearchSessions (agents_search/sessions.rs::search_sessions)
// ---------------------------------------------------------------------------

// SearchSessions searches sessions within a single project by first_message text.
func (s *SearchService) SearchSessions(
	projectID, query string,
	maxResults *int,
	registry *discovery.SubprojectRegistry,
) (SessionSearchResult, error) {
	pd, err := projectsDir()
	if err != nil {
		return SessionSearchResult{}, err
	}
	cd, err := claudeDir()
	if err != nil {
		return SessionSearchResult{}, err
	}

	limit := 50
	if maxResults != nil {
		limit = *maxResults
	}
	queryLower := lowerStr(query)

	opts := discovery.SessionsPaginationOptions{}
	all, err := discovery.ListSessionsPaginated(pd, cd, projectID, nil, 10000, opts, registry)
	if err != nil {
		return SessionSearchResult{}, err
	}

	var results []SessionSearchItem
	for _, sess := range all.Sessions {
		if len(results) >= limit {
			break
		}
		fm := sess.FirstMessage
		if fm == nil || !containsCI(*fm, queryLower) {
			continue
		}
		results = append(results, SessionSearchItem{
			SessionID: sess.ID,
			ProjectID: sess.ProjectID,
			Preview:   sess.FirstMessage,
			Timestamp: sess.CreatedAt,
		})
	}
	if results == nil {
		results = []SessionSearchItem{}
	}

	return SessionSearchResult{Results: results, Total: len(results), Query: query}, nil
}

// ---------------------------------------------------------------------------
// SearchAllProjects (agents_search/sessions.rs::search_all_projects)
// ---------------------------------------------------------------------------

// SearchAllProjects searches across all projects by first_message text.
func (s *SearchService) SearchAllProjects(
	query string,
	maxResults *int,
	registry *discovery.SubprojectRegistry,
) (SessionSearchResult, error) {
	pd, err := projectsDir()
	if err != nil {
		return SessionSearchResult{}, err
	}
	cd, err := claudeDir()
	if err != nil {
		return SessionSearchResult{}, err
	}

	limit := 50
	if maxResults != nil {
		limit = *maxResults
	}
	queryLower := lowerStr(query)

	projects, err := discovery.ScanProjects(pd, registry)
	if err != nil {
		return SessionSearchResult{}, err
	}

	var results []SessionSearchItem
	for _, project := range projects {
		if len(results) >= limit {
			break
		}
		opts := discovery.SessionsPaginationOptions{}
		all, err := discovery.ListSessionsPaginated(pd, cd, project.ID, nil, 1000, opts, registry)
		if err != nil {
			continue
		}
		for _, sess := range all.Sessions {
			if len(results) >= limit {
				break
			}
			fm := sess.FirstMessage
			if fm == nil || !containsCI(*fm, queryLower) {
				continue
			}
			results = append(results, SessionSearchItem{
				SessionID: sess.ID,
				ProjectID: sess.ProjectID,
				Preview:   sess.FirstMessage,
				Timestamp: sess.CreatedAt,
			})
		}
	}
	if results == nil {
		results = []SessionSearchItem{}
	}

	return SessionSearchResult{Results: results, Total: len(results), Query: query}, nil
}

// ---------------------------------------------------------------------------
// SearchSessionsFiltered (agents_search/sessions.rs::search_sessions_filtered)
// ---------------------------------------------------------------------------

// FilteredSearchResult mirrors the Rust JSON shape for search_sessions_filtered.
type FilteredSearchResult struct {
	Results []SessionSearchItem `json:"results"`
	Total   int                 `json:"total"`
	Query   *string             `json:"query"`
}

// SearchSessionsFiltered searches across all projects with optional filters.
func (s *SearchService) SearchSessionsFiltered(
	query *string,
	maxResults *int,
	statusFilter *string,
	minCreatedAt *float64,
	maxCreatedAt *float64,
	registry *discovery.SubprojectRegistry,
) (FilteredSearchResult, error) {
	pd, err := projectsDir()
	if err != nil {
		return FilteredSearchResult{}, err
	}
	cd, err := claudeDir()
	if err != nil {
		return FilteredSearchResult{}, err
	}

	limit := 50
	if maxResults != nil {
		limit = *maxResults
	}

	var queryLower *string
	if query != nil {
		ql := lowerStr(*query)
		queryLower = &ql
	}

	projects, err := discovery.ScanProjects(pd, registry)
	if err != nil {
		return FilteredSearchResult{}, err
	}

	var results []SessionSearchItem
	for _, project := range projects {
		if len(results) >= limit {
			break
		}
		opts := discovery.SessionsPaginationOptions{}
		all, err := discovery.ListSessionsPaginated(pd, cd, project.ID, nil, 1000, opts, registry)
		if err != nil {
			continue
		}
		for _, sess := range all.Sessions {
			if len(results) >= limit {
				break
			}
			// Timestamp range filter.
			if minCreatedAt != nil && sess.CreatedAt < *minCreatedAt {
				continue
			}
			if maxCreatedAt != nil && sess.CreatedAt > *maxCreatedAt {
				continue
			}
			// Status filter.
			if statusFilter != nil {
				isOngoing := sess.IsOngoing != nil && *sess.IsOngoing
				switch *statusFilter {
				case "ongoing":
					if !isOngoing {
						continue
					}
				case "completed":
					if isOngoing {
						continue
					}
				}
			}
			// Text filter.
			if queryLower != nil && *queryLower != "" {
				ql := *queryLower
				matched := (sess.FirstMessage != nil && containsCI(*sess.FirstMessage, ql)) ||
					(sess.CustomTitle != nil && containsCI(*sess.CustomTitle, ql)) ||
					(sess.AgentName != nil && containsCI(*sess.AgentName, ql)) ||
					containsCI(sess.ID, ql)
				if !matched {
					continue
				}
			}

			pp := &sess.ProjectPath
			results = append(results, SessionSearchItem{
				SessionID:          sess.ID,
				ProjectID:          sess.ProjectID,
				ProjectPath:        pp,
				Preview:            sess.FirstMessage,
				CustomTitle:        sess.CustomTitle,
				AgentName:          sess.AgentName,
				Timestamp:          sess.CreatedAt,
				MessageCount:       &sess.MessageCount,
				IsOngoing:          sess.IsOngoing,
				HasSubagents:       boolPtr(sess.HasSubagents),
				ContextConsumption: sess.ContextConsumption,
			})
		}
	}
	if results == nil {
		results = []SessionSearchItem{}
	}

	return FilteredSearchResult{Results: results, Total: len(results), Query: query}, nil
}

// ---------------------------------------------------------------------------
// SearchSessionContent (agents_search/sessions.rs::search_session_content)
// ---------------------------------------------------------------------------

// SearchSessionContent runs full-text / regex search within one parsed session.
func (s *SearchService) SearchSessionContent(
	projectID, sessionID, query string,
	isRegex, caseSensitive *bool,
	cursor, pageSize *int,
) (search.ContentSearchResult, error) {
	if !discovery.IsValidProjectID(projectID) {
		return search.ContentSearchResult{}, fmt.Errorf("invalid project ID")
	}
	if !discovery.IsValidSessionID(sessionID) {
		return search.ContentSearchResult{}, fmt.Errorf("invalid session ID")
	}

	pd, err := projectsDir()
	if err != nil {
		return search.ContentSearchResult{}, err
	}
	base := discovery.ExtractBaseDir(projectID)
	filePath := filepath.Join(pd, base, sessionID+".jsonl")

	cacheKey := projectID + "/" + sessionID
	var parsed domain.ParsedSession
	if cached, ok := s.cache.Get(cacheKey); ok {
		parsed = cached
	} else {
		parsed, err = parsing.ParseSessionFile(filePath)
		if err != nil {
			return search.ContentSearchResult{}, err
		}
		s.cache.Insert(cacheKey, parsed)
	}

	chunks := analysis.BuildChunks(parsed.Messages, []domain.Process{})

	ir := false
	if isRegex != nil {
		ir = *isRegex
	}
	cs := false
	if caseSensitive != nil {
		cs = *caseSensitive
	}

	return search.SearchChunks(chunks, query, ir, cs, cursor, pageSize)
}

// ---------------------------------------------------------------------------
// ParseNlQuery (nl_query.rs::parse_nl_query)
// ---------------------------------------------------------------------------

// ParseNlQuery parses a natural-language query string into a filter struct.
func (s *SearchService) ParseNlQuery(query string) (search.ParsedFilter, error) {
	return search.ParseNLQueryNow(query), nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func lowerStr(s string) string {
	// inline to avoid extra import — mirrors Rust .to_lowercase()
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}

func containsCI(s, subLower string) bool {
	return len(lowerStr(s)) >= len(subLower) && containsStr(lowerStr(s), subLower)
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func boolPtr(b bool) *bool { return &b }
