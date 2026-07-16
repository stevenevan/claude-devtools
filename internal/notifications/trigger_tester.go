// trigger_tester.go.
// Tests a trigger against all historical sessions with safety limits.
package notifications

import (
	"os"
	"path/filepath"
	"sort"
	"time"

	"claude-devtools/internal/config"
	"claude-devtools/internal/discovery"
	"claude-devtools/internal/parsing"
)

const (
	maxErrors       = 50
	maxTotalCount   = 10_000
	timeoutDuration = 30 * time.Second
)

type testState struct {
	errors        []DetectedError
	totalCount    int
	truncated     bool
	startTime     time.Time
	effectiveLimit int
}

func (ts *testState) shouldStop() bool {
	return len(ts.errors) >= ts.effectiveLimit ||
		time.Since(ts.startTime) > timeoutDuration ||
		ts.totalCount >= maxTotalCount
}

func (ts *testState) isSafetyLimit() bool {
	return time.Since(ts.startTime) > timeoutDuration || ts.totalCount >= maxTotalCount
}

// TestTrigger tests a trigger against all historical session data.
// Mirrors trigger_tester.rs::test_trigger.
func TestTrigger(trigger *config.NotificationTrigger, limit *int) TriggerTestResult {
	effectiveLimit := maxErrors
	if limit != nil && *limit < maxErrors {
		effectiveLimit = *limit
	}

	state := &testState{
		effectiveLimit: effectiveLimit,
		startTime:      time.Now(),
	}

	claudeDir := resolveClaudeDir()
	if claudeDir == "" {
		return TriggerTestResult{TotalCount: 0, Errors: []DetectedError{}}
	}

	projectsDir := discovery.GetProjectsBasePath(claudeDir)
	registry := discovery.NewSubprojectRegistry()

	projects, err := discovery.ScanProjects(projectsDir, registry)
	if err != nil {
		return TriggerTestResult{TotalCount: 0, Errors: []DetectedError{}}
	}

outer:
	for _, project := range projects {
		if state.shouldStop() {
			if state.isSafetyLimit() {
				state.truncated = true
			}
			break
		}

		projectDir := filepath.Join(projectsDir, project.ID)
		sessionFiles, err := listJSONLFiles(projectDir)
		if err != nil {
			continue
		}

		for _, filePath := range sessionFiles {
			if state.shouldStop() {
				if state.isSafetyLimit() {
					state.truncated = true
				}
				break outer
			}

			messages, _, err := parsing.ParseJSONLFile(filePath)
			if err != nil {
				continue
			}

			sessionID := filepath.Base(filePath)
			if ext := filepath.Ext(sessionID); ext != "" {
				sessionID = sessionID[:len(sessionID)-len(ext)]
			}

			sessionErrors := DetectErrorsWithTrigger(messages, trigger, sessionID, project.ID, filePath)

			newTotal := state.totalCount + len(sessionErrors)
			if newTotal >= maxTotalCount {
				state.totalCount = maxTotalCount
				state.truncated = true
			} else {
				state.totalCount = newTotal
			}

			for _, e := range sessionErrors {
				if len(state.errors) >= state.effectiveLimit {
					break
				}
				state.errors = append(state.errors, e)
			}
		}
	}

	if state.errors == nil {
		state.errors = []DetectedError{}
	}

	var truncated *bool
	if state.truncated {
		t := true
		truncated = &t
	}

	return TriggerTestResult{
		TotalCount: state.totalCount,
		Errors:     state.errors,
		Truncated:  truncated,
	}
}

// resolveClaudeDir mirrors watcher::resolve_claude_dir — returns ~/.claude or "".
func resolveClaudeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	dir := filepath.Join(home, ".claude")
	if _, err := os.Stat(dir); err != nil {
		return ""
	}
	return dir
}

// listJSONLFiles returns .jsonl files in a directory, sorted newest-first by mtime.
// Mirrors trigger_tester.rs::list_jsonl_files.
func listJSONLFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	type fileEntry struct {
		path  string
		mtime time.Time
	}
	var files []fileEntry
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".jsonl" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, fileEntry{
			path:  filepath.Join(dir, e.Name()),
			mtime: info.ModTime(),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].mtime.After(files[j].mtime)
	})

	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.path
	}
	return paths, nil
}
