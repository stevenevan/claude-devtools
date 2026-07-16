package sessionservice

// service.go wires all session commands as methods on SessionService.
//
// Layering: may import parsing/analysis/discovery/cache/domain. Never imports
// other *service packages (arch H1).

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"claude-devtools/internal/analysis"
	"claude-devtools/internal/cache"
	"claude-devtools/internal/discovery"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
	"claude-devtools/internal/ptr"
)

// SessionService exposes session discovery + detail.
type SessionService struct {
	cache *cache.SessionCache // shared singleton, injected (arch C1)
}

// New injects the shared session cache (one instance for the whole app).
func New(c *cache.SessionCache) *SessionService { return &SessionService{cache: c} }

// GetProjects lists projects under ~/.claude/projects (commands/projects.rs::get_projects).
func (s *SessionService) GetProjects() ([]domain.Project, error) {
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return nil, err
	}
	registry := discovery.NewSubprojectRegistry()
	return discovery.ScanProjects(pd, registry)
}


func validateSessionIDPair(projectID, sessionID string) error {
	if !discovery.IsValidProjectID(projectID) {
		return fmt.Errorf("invalid project ID: %q", projectID)
	}
	if !discovery.IsValidSessionID(sessionID) {
		return fmt.Errorf("invalid session ID: %q", sessionID)
	}
	return nil
}

func resolveSessionPath(pd, projectID, sessionID string) (string, error) {
	base := discovery.ExtractBaseDir(projectID)
	p := filepath.Join(pd, base, sessionID+".jsonl")
	return p, nil
}

func resolveSubagentPath(pd, projectID, sessionID, subagentID string) (string, error) {
	base := discovery.ExtractBaseDir(projectID)
	// New layout: {base}/{sessionID}/subagents/{subagentID}.jsonl
	newPath := filepath.Join(pd, base, sessionID, "subagents", subagentID+".jsonl")
	if _, err := os.Stat(newPath); err == nil {
		return newPath, nil
	}
	// Old layout: {base}/agent_{subagentID}.jsonl
	oldPath := filepath.Join(pd, base, "agent_"+subagentID+".jsonl")
	return oldPath, nil
}

// --------------------------------------------------------------------------
// Core session-detail build (shared by GetSessionDetail and incremental path)
// --------------------------------------------------------------------------

func buildSessionDetail(
	pd, projectID, sessionID, filePath string,
	parsed domain.ParsedSession,
) (domain.SessionDetail, error) {
	subagents := discovery.ResolveSubagents(pd, projectID, sessionID, parsed.TaskCalls, parsed.Messages)

	decodedPath := discovery.DecodePath(discovery.ExtractBaseDir(projectID))
	isOngoing := discovery.DetectOngoing(filePath)

	session := domain.Session{
		ID:            sessionID,
		ProjectID:     projectID,
		ProjectPath:   decodedPath,
		CreatedAt:     0.0,
		HasSubagents:  len(subagents) > 0,
		MessageCount:  uint32(len(parsed.Messages)),
		IsOngoing:     isOngoing,
		MetadataLevel: ptr.To("deep"),
		CustomTitle:   parsed.CustomTitle,
		AgentName:     parsed.AgentName,
	}

	return analysis.BuildSessionDetail(session, parsed.Messages, subagents), nil
}

// --------------------------------------------------------------------------
// GetSessionDetail (sessions.rs:149-213)
// --------------------------------------------------------------------------

// GetSessionDetail is the live (non-incremental) detail command.
func (s *SessionService) GetSessionDetail(projectID, sessionID string) (domain.SessionDetail, error) {
	if err := validateSessionIDPair(projectID, sessionID); err != nil {
		return domain.SessionDetail{}, err
	}
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return domain.SessionDetail{}, err
	}

	cacheKey := projectID + "/" + sessionID
	filePath, err := resolveSessionPath(pd, projectID, sessionID)
	if err != nil {
		return domain.SessionDetail{}, err
	}

	var parsed domain.ParsedSession
	if cached, ok := s.cache.Get(cacheKey); ok {
		parsed = cached
	} else {
		parsed, err = parsing.ParseSessionFile(filePath)
		if err != nil {
			return domain.SessionDetail{}, err
		}
		s.cache.Insert(cacheKey, parsed)
	}

	return buildSessionDetail(pd, projectID, sessionID, filePath, parsed)
}

// --------------------------------------------------------------------------
// GetSessionDetailIncremental (sessions.rs:216-293)
// --------------------------------------------------------------------------

// GetSessionDetailIncremental implements the two-arm cache state machine:
//
// Arm 1 (both inc-state AND full-parse cached): seek to byteOffset, parse
// appended lines only, re-run ProcessMessages, update both caches.
//
// Arm 2 (either missing): full parse, store file-size as initial offset.
func (s *SessionService) GetSessionDetailIncremental(projectID, sessionID string) (domain.SessionDetail, error) {
	if err := validateSessionIDPair(projectID, sessionID); err != nil {
		return domain.SessionDetail{}, err
	}
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return domain.SessionDetail{}, err
	}

	cacheKey := projectID + "/" + sessionID
	filePath, err := resolveSessionPath(pd, projectID, sessionID)
	if err != nil {
		return domain.SessionDetail{}, err
	}

	incState, hasInc := s.cache.GetIncremental(cacheKey)
	existing, hasFull := s.cache.Get(cacheKey)

	var parsed domain.ParsedSession

	if hasInc && hasFull {
		// Arm 1: incremental read from stored byte offset.
		newMsgs, newMeta, newOffset, err := parsing.ParseJSONLIncremental(
			filePath, incState.ByteOffset, incState.Metadata,
		)
		if err != nil {
			return domain.SessionDetail{}, err
		}

		if len(newMsgs) == 0 {
			// Nothing new — reuse existing cached parse.
			parsed = existing
		} else {
			// Append new messages then re-process the whole set.
			existing.Messages = append(existing.Messages, newMsgs...)
			if newMeta.CustomTitle != nil {
				existing.CustomTitle = newMeta.CustomTitle
			}
			if newMeta.AgentName != nil {
				existing.AgentName = newMeta.AgentName
			}

			reprocessed := parsing.ProcessMessages(
				existing.Messages,
				parsing.SessionFileMetadata{
					CustomTitle: existing.CustomTitle,
					AgentName:   existing.AgentName,
				},
			)

			s.cache.SetIncremental(cacheKey, cache.IncrementalState{
				ByteOffset: newOffset,
				Metadata:   newMeta,
			})
			s.cache.Insert(cacheKey, reprocessed)
			parsed = reprocessed
		}
	} else {
		// Arm 2: full parse — populate both caches.
		parsed, err = parsing.ParseSessionFile(filePath)
		if err != nil {
			return domain.SessionDetail{}, err
		}

		fileLen := uint64(0)
		if info, e := os.Stat(filePath); e == nil {
			fileLen = uint64(info.Size())
		}

		s.cache.SetIncremental(cacheKey, cache.IncrementalState{
			ByteOffset: fileLen,
			Metadata: parsing.SessionFileMetadata{
				CustomTitle: parsed.CustomTitle,
				AgentName:   parsed.AgentName,
			},
		})
		s.cache.Insert(cacheKey, parsed)
	}

	return buildSessionDetail(pd, projectID, sessionID, filePath, parsed)
}

// --------------------------------------------------------------------------
// Session listing commands (sessions.rs:85-146)
// --------------------------------------------------------------------------

// GetSessions returns all sessions for a project (no pagination).
func (s *SessionService) GetSessions(projectID string, registry *discovery.SubprojectRegistry) ([]domain.Session, error) {
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return nil, err
	}
	cd, err := discovery.ClaudeDir()
	if err != nil {
		return nil, err
	}
	opts := discovery.SessionsPaginationOptions{}
	result, err := discovery.ListSessionsPaginated(pd, cd, projectID, nil, 10000, opts, registry)
	if err != nil {
		return nil, err
	}
	return result.Sessions, nil
}

// GetSessionsByIds returns sessions filtered to the requested IDs.
func (s *SessionService) GetSessionsByIds(projectID string, sessionIDs []string, registry *discovery.SubprojectRegistry) ([]domain.Session, error) {
	all, err := s.GetSessions(projectID, registry)
	if err != nil {
		return nil, err
	}
	idSet := make(map[string]struct{}, len(sessionIDs))
	for _, id := range sessionIDs {
		idSet[id] = struct{}{}
	}
	var out []domain.Session
	for _, sess := range all {
		if _, ok := idSet[sess.ID]; ok {
			out = append(out, sess)
		}
	}
	if out == nil {
		out = []domain.Session{}
	}
	return out, nil
}

// GetSessionsPaginated returns a paginated page of sessions.
func (s *SessionService) GetSessionsPaginated(
	projectID string,
	cursor *string,
	limit *int,
	options *discovery.SessionsPaginationOptions,
	registry *discovery.SubprojectRegistry,
) (domain.PaginatedSessionsResult, error) {
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return domain.PaginatedSessionsResult{}, err
	}
	cd, err := discovery.ClaudeDir()
	if err != nil {
		return domain.PaginatedSessionsResult{}, err
	}

	pageLimit := 20
	if limit != nil {
		pageLimit = *limit
		if pageLimit > 100 {
			pageLimit = 100
		}
	}
	opts := discovery.SessionsPaginationOptions{}
	if options != nil {
		opts = *options
	}

	return discovery.ListSessionsPaginated(pd, cd, projectID, cursor, pageLimit, opts, registry)
}

// --------------------------------------------------------------------------
// ParseSession / ParseSessionMetrics (thin parse+cache commands)
// --------------------------------------------------------------------------

// ParseSession parses the session JSONL file, populates the cache, and returns
// a lightweight Session record (metadataLevel="deep", has_subagents=false).
func (s *SessionService) ParseSession(projectID, sessionID string) (domain.Session, error) {
	if err := validateSessionIDPair(projectID, sessionID); err != nil {
		return domain.Session{}, err
	}
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return domain.Session{}, err
	}
	filePath, err := resolveSessionPath(pd, projectID, sessionID)
	if err != nil {
		return domain.Session{}, err
	}

	cacheKey := projectID + "/" + sessionID
	var parsed domain.ParsedSession
	if cached, ok := s.cache.Get(cacheKey); ok {
		parsed = cached
	} else {
		parsed, err = parsing.ParseSessionFile(filePath)
		if err != nil {
			return domain.Session{}, err
		}
		s.cache.Insert(cacheKey, parsed)
	}

	isOngoing := discovery.DetectOngoing(filePath)
	return domain.Session{
		ID:            sessionID,
		ProjectID:     projectID,
		ProjectPath:   discovery.DecodePath(discovery.ExtractBaseDir(projectID)),
		CreatedAt:     0.0,
		HasSubagents:  false,
		MessageCount:  uint32(len(parsed.Messages)),
		IsOngoing:     isOngoing,
		MetadataLevel: ptr.To("deep"),
		CustomTitle:   parsed.CustomTitle,
		AgentName:     parsed.AgentName,
	}, nil
}

// ParseSessionMetrics returns only the SessionMetrics from a parsed session.
func (s *SessionService) ParseSessionMetrics(projectID, sessionID string) (domain.SessionMetrics, error) {
	if err := validateSessionIDPair(projectID, sessionID); err != nil {
		return domain.SessionMetrics{}, err
	}
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return domain.SessionMetrics{}, err
	}
	filePath, err := resolveSessionPath(pd, projectID, sessionID)
	if err != nil {
		return domain.SessionMetrics{}, err
	}

	cacheKey := projectID + "/" + sessionID
	var parsed domain.ParsedSession
	if cached, ok := s.cache.Get(cacheKey); ok {
		parsed = cached
	} else {
		parsed, err = parsing.ParseSessionFile(filePath)
		if err != nil {
			return domain.SessionMetrics{}, err
		}
		s.cache.Insert(cacheKey, parsed)
	}
	return parsed.Metrics, nil
}

// --------------------------------------------------------------------------
// GetSubagentDetail (agents_search/waterfall.rs:29-78)
// --------------------------------------------------------------------------

// GetSubagentDetail parses a subagent JSONL file and returns its SessionDetail.
func (s *SessionService) GetSubagentDetail(projectID, sessionID, subagentID string) (*domain.SessionDetail, error) {
	if err := validateSessionIDPair(projectID, sessionID); err != nil {
		return nil, err
	}
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return nil, err
	}

	subagentPath, err := resolveSubagentPath(pd, projectID, sessionID, subagentID)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(subagentPath); os.IsNotExist(err) {
		return nil, nil
	}

	parsed, err := parsing.ParseSessionFile(subagentPath)
	if err != nil {
		return nil, err
	}

	decodedPath := discovery.DecodePath(discovery.ExtractBaseDir(projectID))
	isOngoing := discovery.DetectOngoing(subagentPath)

	session := domain.Session{
		ID:            subagentID,
		ProjectID:     projectID,
		ProjectPath:   decodedPath,
		CreatedAt:     0.0,
		HasSubagents:  false,
		MessageCount:  uint32(len(parsed.Messages)),
		IsOngoing:     isOngoing,
		MetadataLevel: ptr.To("deep"),
	}

	detail := analysis.BuildSessionDetail(session, parsed.Messages, []domain.Process{})
	return &detail, nil
}

// --------------------------------------------------------------------------
// GetWaterfallData — alias for GetSessionDetail (agents_search/waterfall.rs:17-26)
// --------------------------------------------------------------------------

// GetWaterfallData is a thin alias for GetSessionDetail.
func (s *SessionService) GetWaterfallData(projectID, sessionID string) (*domain.SessionDetail, error) {
	detail, err := s.GetSessionDetail(projectID, sessionID)
	if err != nil {
		return nil, err
	}
	return &detail, nil
}

// --------------------------------------------------------------------------
// GetAllTodos (sessions.rs:28-83)
// --------------------------------------------------------------------------

// AggregatedSessionTodos mirrors sessions.rs::AggregatedSessionTodos.
type AggregatedSessionTodos struct {
	ProjectID string          `json:"projectId"`
	SessionID string          `json:"sessionId"`
	UpdatedAt float64         `json:"updatedAt"`
	Items     json.RawMessage `json:"items"`
}

// GetAllTodos aggregates todo files across the given project IDs.
func (s *SessionService) GetAllTodos(projectIDs []string) ([]AggregatedSessionTodos, error) {
	cd, err := discovery.ClaudeDir()
	if err != nil {
		return nil, err
	}
	pd := discovery.GetProjectsBasePath(cd)
	todosDir := filepath.Join(cd, "todos")

	var out []AggregatedSessionTodos

	for _, projectID := range projectIDs {
		if !discovery.IsValidProjectID(projectID) {
			continue
		}
		baseID := discovery.ExtractBaseDir(projectID)
		projectDir := filepath.Join(pd, baseID)
		entries, err := os.ReadDir(projectDir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			fname := entry.Name()
			if !strings.HasSuffix(fname, ".jsonl") {
				continue
			}
			sessionID := strings.TrimSuffix(fname, ".jsonl")
			todoPath := filepath.Join(todosDir, sessionID+".json")
			if _, err := os.Stat(todoPath); os.IsNotExist(err) {
				continue
			}
			content, err := os.ReadFile(todoPath)
			if err != nil {
				continue
			}
			var items json.RawMessage
			if json.Unmarshal(content, &items) != nil {
				continue
			}
			info, err := os.Stat(todoPath)
			updatedAt := 0.0
			if err == nil {
				if mt, err2 := info.ModTime().MarshalBinary(); err2 == nil {
					_ = mt
					updatedAt = float64(info.ModTime().UnixMilli())
				}
			}
			out = append(out, AggregatedSessionTodos{
				ProjectID: projectID,
				SessionID: sessionID,
				UpdatedAt: updatedAt,
				Items:     items,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	if out == nil {
		out = []AggregatedSessionTodos{}
	}
	return out, nil
}

// --------------------------------------------------------------------------
// SessionScrollToLine (agents_search/context.rs:19-28)
// --------------------------------------------------------------------------

// ScrollToLineResult matches the Rust JSON shape.
type ScrollToLineResult struct {
	Success    bool   `json:"success"`
	SessionID  string `json:"sessionId"`
	LineNumber uint32 `json:"lineNumber"`
}

// SessionScrollToLine mirrors context.rs::session_scroll_to_line (stub).
func (s *SessionService) SessionScrollToLine(sessionID string, lineNumber uint32) ScrollToLineResult {
	return ScrollToLineResult{
		Success:    true,
		SessionID:  sessionID,
		LineNumber: lineNumber,
	}
}

// --------------------------------------------------------------------------
// GetSessionTldr (analysis/summarizer)
// --------------------------------------------------------------------------

// GetSessionTldr parses (or cache-hits) the session and returns its TL;DR.
func (s *SessionService) GetSessionTldr(projectID, sessionID string) (analysis.SessionTldr, error) {
	if err := validateSessionIDPair(projectID, sessionID); err != nil {
		return analysis.SessionTldr{}, err
	}
	pd, err := discovery.ProjectsDir()
	if err != nil {
		return analysis.SessionTldr{}, err
	}
	filePath, err := resolveSessionPath(pd, projectID, sessionID)
	if err != nil {
		return analysis.SessionTldr{}, err
	}

	cacheKey := projectID + "/" + sessionID
	var parsed domain.ParsedSession
	if cached, ok := s.cache.Get(cacheKey); ok {
		parsed = cached
	} else {
		parsed, err = parsing.ParseSessionFile(filePath)
		if err != nil {
			return analysis.SessionTldr{}, err
		}
		s.cache.Insert(cacheKey, parsed)
	}

	return analysis.BuildSessionTldr(parsed.Messages), nil
}

// --------------------------------------------------------------------------
// Stub commands — hardcoded constants, no real logic (mirrors Rust verbatim)
// --------------------------------------------------------------------------

// ContextListItem matches the context.rs JSON literal.
type ContextListItem struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// ContextList mirrors context.rs::context_list.
func (s *SessionService) ContextList() []ContextListItem {
	return []ContextListItem{{ID: "local", Type: "local"}}
}

// ContextGetActive mirrors context.rs::context_get_active.
func (s *SessionService) ContextGetActive() string { return "local" }

// ContextSwitchResult matches the context.rs JSON shape.
type ContextSwitchResult struct {
	ContextID string `json:"contextId"`
}

// ContextSwitch mirrors context.rs::context_switch.
func (s *SessionService) ContextSwitch(contextID string) ContextSwitchResult {
	return ContextSwitchResult{ContextID: contextID}
}

// GetSessionGroups mirrors waterfall.rs::get_session_groups (returns empty array).
func (s *SessionService) GetSessionGroups(projectID, sessionID string) []any {
	return []any{}
}

// GetRepositoryGroups mirrors waterfall.rs::get_repository_groups (returns empty array).
func (s *SessionService) GetRepositoryGroups() []any { return []any{} }

// GetWorktreeSessions mirrors waterfall.rs::get_worktree_sessions (returns empty slice).
func (s *SessionService) GetWorktreeSessions(worktreeID string) []domain.Session {
	return []domain.Session{}
}
