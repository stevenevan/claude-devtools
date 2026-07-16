package discovery

// Subagent locator — find subagent JSONL files for a session.
//
// Supports two layouts:
//
//	NEW: {projectDir}/{sessionID}/subagents/*.jsonl
//	OLD: {projectDir}/agent_*.jsonl

import (
	"os"
	"path/filepath"
	"strings"
)

// SubagentPath builds the NEW-layout path for a single subagent JSONL file.
// Mirrors subagent_locator::subagent_path.
func SubagentPath(projectsDir, projectID, parentSessionID, subagentID string) string {
	baseDir := ExtractBaseDir(projectID)
	return filepath.Join(projectsDir, baseDir, parentSessionID, "subagents", subagentID+".jsonl")
}

// HasSubagents returns true if any subagent JSONL file exists for the session.
// Mirrors subagent_locator::has_subagents.
func HasSubagents(projectsDir, projectID, sessionID string) bool {
	baseDir := ExtractBaseDir(projectID)

	// Check new structure first: {baseDir}/{sessionID}/subagents/
	newPath := filepath.Join(projectsDir, baseDir, sessionID, "subagents")
	if info, err := os.Stat(newPath); err == nil && info.IsDir() {
		entries, err := os.ReadDir(newPath)
		if err == nil {
			for _, e := range entries {
				if strings.HasSuffix(e.Name(), ".jsonl") {
					return true
				}
			}
		}
	}

	// Check old structure: {baseDir}/agent_*.jsonl
	projectDir := filepath.Join(projectsDir, baseDir)
	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return false
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, "agent_") && strings.HasSuffix(name, ".jsonl") {
			return true
		}
	}
	return false
}
