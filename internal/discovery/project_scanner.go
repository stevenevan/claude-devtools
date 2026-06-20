package discovery

// Project scanning — discover projects from ~/.claude/projects/.
// Mirrors src-tauri/src/discovery/project_scanner.rs.

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"claude-devtools/internal/domain"
)

// ScanProjects scans the projects directory and returns all projects sorted by
// most-recent-session descending. Mirrors project_scanner::scan_projects.
func ScanProjects(projectsDir string, registry *SubprojectRegistry) ([]domain.Project, error) {
	if _, err := os.Stat(projectsDir); os.IsNotExist(err) {
		return []domain.Project{}, nil
	}

	registry.Clear()
	var allProjects []domain.Project

	entries, err := os.ReadDir(projectsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read projects dir: %w", err)
	}

	for _, e := range entries {
		if !e.IsDir() || !IsValidEncodedPath(e.Name()) {
			continue
		}
		projects, err := scanProject(projectsDir, e.Name(), registry)
		if err != nil {
			// Log and continue, matching Rust's tracing::warn behaviour.
			continue
		}
		allProjects = append(allProjects, projects...)
	}

	// Sort by most_recent_session descending.
	sortProjectsByMostRecent(allProjects)
	return allProjects, nil
}

// scanProject scans a single project directory. May return multiple projects if
// sessions have different cwd values (subproject splitting).
func scanProject(projectsDir, encodedName string, registry *SubprojectRegistry) ([]domain.Project, error) {
	projectDir := filepath.Join(projectsDir, encodedName)
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s: %w", projectDir, err)
	}

	// sessions by cwd: cwd → [(sessionID, createdAt)]
	type sessionInfo struct {
		id        string
		createdAt float64
	}
	sessionsByCWD := map[string][]sessionInfo{}
	var defaultCWD string

	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".jsonl") || strings.HasPrefix(name, "agent_") {
			continue
		}

		sessionID := strings.TrimSuffix(name, ".jsonl")
		filePath := filepath.Join(projectDir, name)

		// mtime as created_at (matches session_lister which also uses mtime).
		info, err := e.Info()
		var createdAt float64
		if err == nil {
			createdAt = float64(info.ModTime().UnixMilli())
		}

		cwd := extractCWDFromFile(filePath)

		if defaultCWD == "" && cwd != "" {
			defaultCWD = cwd
		}

		key := cwd
		if key == "" {
			key = "__default__"
		}
		sessionsByCWD[key] = append(sessionsByCWD[key], sessionInfo{id: sessionID, createdAt: createdAt})
	}

	// Single cwd group (or empty) → one project.
	if len(sessionsByCWD) <= 1 {
		var sessions []sessionInfo
		var cwdKey string
		for k, v := range sessionsByCWD {
			cwdKey = k
			sessions = v
			break
		}

		var cwdHint string
		if cwdKey == "__default__" || cwdKey == "" {
			cwdHint = defaultCWD
		} else {
			cwdHint = cwdKey
		}

		sessionIDs := make([]string, 0, len(sessions))
		mostRecent := 0.0
		earliest := -1.0
		for _, s := range sessions {
			sessionIDs = append(sessionIDs, s.id)
			if s.createdAt > mostRecent {
				mostRecent = s.createdAt
			}
			if earliest < 0 || s.createdAt < earliest {
				earliest = s.createdAt
			}
		}
		if earliest < 0 {
			earliest = 0
		}

		path := cwdHint
		if path == "" {
			path = DecodePath(encodedName)
		}

		var mostRecentPtr *float64
		if mostRecent > 0 {
			mostRecentPtr = &mostRecent
		}

		return []domain.Project{{
			ID:                encodedName,
			Path:              path,
			Name:              ExtractProjectName(encodedName, cwdHint),
			Sessions:          sessionIDs,
			CreatedAt:         earliest,
			MostRecentSession: mostRecentPtr,
		}}, nil
	}

	// Multiple cwds → create composite projects.
	var projects []domain.Project
	for cwdKey, sessions := range sessionsByCWD {
		cwdStr := cwdKey
		if cwdStr == "__default__" {
			cwdStr = defaultCWD
		}

		sessionIDs := make([]string, 0, len(sessions))
		mostRecent := 0.0
		earliest := -1.0
		for _, s := range sessions {
			sessionIDs = append(sessionIDs, s.id)
			if s.createdAt > mostRecent {
				mostRecent = s.createdAt
			}
			if earliest < 0 || s.createdAt < earliest {
				earliest = s.createdAt
			}
		}
		if earliest < 0 {
			earliest = 0
		}

		compositeID := registry.Register(encodedName, cwdStr, sessionIDs)

		var mostRecentPtr *float64
		if mostRecent > 0 {
			mostRecentPtr = &mostRecent
		}

		projects = append(projects, domain.Project{
			ID:                compositeID,
			Path:              cwdStr,
			Name:              ExtractProjectName(encodedName, cwdStr),
			Sessions:          sessionIDs,
			CreatedAt:         earliest,
			MostRecentSession: mostRecentPtr,
		})
	}

	return projects, nil
}

// extractCWDFromFile reads the cwd field from the first non-empty JSONL line.
func extractCWDFromFile(filePath string) string {
	f, err := os.Open(filePath)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry struct {
			Cwd *string `json:"cwd"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			if entry.Cwd != nil && *entry.Cwd != "" {
				return *entry.Cwd
			}
		}
		// Only check the first non-empty line.
		break
	}
	return ""
}

// sortProjectsByMostRecent sorts in-place by MostRecentSession descending.
func sortProjectsByMostRecent(projects []domain.Project) {
	for i := 1; i < len(projects); i++ {
		for j := i; j > 0; j-- {
			aTime := 0.0
			if projects[j].MostRecentSession != nil {
				aTime = *projects[j].MostRecentSession
			}
			bTime := 0.0
			if projects[j-1].MostRecentSession != nil {
				bTime = *projects[j-1].MostRecentSession
			}
			if aTime > bTime {
				projects[j], projects[j-1] = projects[j-1], projects[j]
			} else {
				break
			}
		}
	}
}
