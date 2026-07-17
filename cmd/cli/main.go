// Command claude-devtools-cli is a read-only CLI for inspecting Claude session
// data.
//
// Subcommands:
//
//	list-projects                  List projects
//	list-sessions <project>        List sessions for a project
//	show-session <project> <id>    Show session detail (--format json|markdown)
//	tail <project> <id>            Tail session JSONL (rate-limited)
//	stats                          Aggregate counts
//
// Security guards (ported verbatim from cli.rs):
//   - Symlink-safe canonicalization keeps file access under home/.claude
//   - Project/session IDs restricted to ASCII alnum, dash, underscore, dot, plus
//   - HOME resolved once via os.UserHomeDir; no CLAUDE_HOME override is read
//   - tail caps emit at 10 MB/s and 100_000 lines per invocation
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"

	"claude-devtools/internal/analysis"
	"claude-devtools/internal/analytics"
	"claude-devtools/internal/discovery"
	"claude-devtools/internal/insights/error_hotspots"
	"claude-devtools/internal/insights/file_graph"
	"claude-devtools/internal/insights/tool_analytics"
	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
	"claude-devtools/internal/pipeline"
	"claude-devtools/internal/ptr"
)

const (
	tailBytesPerSec = 10 * 1024 * 1024
	tailMaxLines    = 100_000
	maxIDLen        = 200
)

func resolveHome() (string, error) {
	h, err := os.UserHomeDir()
	if err != nil || h == "" {
		return "", fmt.Errorf("cannot resolve home directory (no fallback)")
	}
	return h, nil
}

func claudeDir() (string, error) {
	h, err := resolveHome()
	if err != nil {
		return "", err
	}
	return filepath.Join(h, ".claude"), nil
}

func projectsDir() (string, error) {
	c, err := claudeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(c, "projects"), nil
}

func validateID(kind, raw string) error {
	if raw == "" {
		return fmt.Errorf("%s is empty", kind)
	}
	if len(raw) > maxIDLen {
		return fmt.Errorf("%s exceeds %d chars", kind, maxIDLen)
	}
	for _, ch := range raw {
		if ch == 0 || unicode.IsControl(ch) {
			return fmt.Errorf("%s contains control character", kind)
		}
		if ch == '/' || ch == '\\' || ch == ':' {
			return fmt.Errorf("%s contains path separator", kind)
		}
		allowed := (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' || ch == '+'
		if !allowed {
			return fmt.Errorf("%s contains disallowed character '%c'", kind, ch)
		}
	}
	if raw == "." || raw == ".." {
		return fmt.Errorf("%s cannot be '.' or '..'", kind)
	}
	return nil
}

// validateUnderRoot canonicalizes both paths and confirms candidate is under root.
func validateUnderRoot(candidate, root string) (string, error) {
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("root canonicalization failed: %w", err)
	}
	canonical, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", fmt.Errorf("path outside session root: %w", err)
	}
	rel, err := filepath.Rel(canonicalRoot, canonical)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path outside session root")
	}
	return canonical, nil
}

func sessionPath(projectID, sessionID string) (string, error) {
	if err := validateID("project_id", projectID); err != nil {
		return "", err
	}
	if err := validateID("session_id", sessionID); err != nil {
		return "", err
	}
	base := projectID
	if idx := strings.Index(projectID, "::"); idx >= 0 {
		lhs := projectID[:idx]
		if err := validateID("project_id (base)", lhs); err != nil {
			return "", err
		}
		base = lhs
	}
	root, err := projectsDir()
	if err != nil {
		return "", err
	}
	projectDir := filepath.Join(root, base)
	if _, err := os.Stat(projectDir); os.IsNotExist(err) {
		return "", fmt.Errorf("project '%s' not found", base)
	}
	if _, err := validateUnderRoot(projectDir, root); err != nil {
		return "", err
	}
	candidate := filepath.Join(projectDir, sessionID+".jsonl")
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return "", fmt.Errorf("session '%s' not found in '%s'", sessionID, base)
	}
	return validateUnderRoot(candidate, root)
}

func cmdListProjects(asJSON bool) error {
	root, err := projectsDir()
	if err != nil {
		return err
	}
	registry := discovery.NewSubprojectRegistry()
	projects, err := discovery.ScanProjects(root, registry)
	if err != nil {
		return err
	}
	if asJSON {
		payload, err := json.Marshal(projects)
		if err != nil {
			return err
		}
		fmt.Println(string(payload))
		return nil
	}
	for _, p := range projects {
		fmt.Printf("%s\t%s\n", p.ID, p.Name)
	}
	fmt.Printf("\n%d projects\n", len(projects))
	return nil
}

func cmdListSessions(projectID string, asJSON bool) error {
	if err := validateID("project_id", projectID); err != nil {
		return err
	}
	root, err := projectsDir()
	if err != nil {
		return err
	}
	cdir, err := claudeDir()
	if err != nil {
		return err
	}
	registry := discovery.NewSubprojectRegistry()
	result, err := discovery.ListSessionsPaginated(root, cdir, projectID, nil, 100, discovery.SessionsPaginationOptions{}, registry)
	if err != nil {
		return err
	}
	if asJSON {
		payload, err := json.Marshal(result.Sessions)
		if err != nil {
			return err
		}
		fmt.Println(string(payload))
		return nil
	}
	for _, s := range result.Sessions {
		preview := "(no preview)"
		if s.FirstMessage != nil {
			preview = *s.FirstMessage
		}
		fmt.Printf("%s\t%s\tmessages=%d\n", s.ID, preview, s.MessageCount)
	}
	fmt.Printf("\n%d sessions (more=%t)\n", len(result.Sessions), result.HasMore)
	return nil
}

// cmdDumpMessages emits the raw parsed ParsedMessage[] as JSON — the W4 parser
// parity golden generator. Read-only; reuses the full sessionPath guard chain
// (validateID + validateUnderRoot) before touching the file.
func cmdDumpMessages(projectID, sessionID string) error {
	path, err := sessionPath(projectID, sessionID)
	if err != nil {
		return err
	}
	messages, _, err := parsing.ParseJSONLFile(path)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(messages)
	if err != nil {
		return err
	}
	fmt.Println(string(payload))
	return nil
}

// cmdDumpDetail emits the full SessionDetail WITH processes, mirroring
// sessionservice.buildSessionDetail (discovery.ResolveSubagents). It is the W6
// processes-parity golden generator — the CLI show-session oracle passes empty
// processes, so subagent resolution needs this separate path. Read-only; reuses
// the sessionPath guard chain.
func cmdDumpDetail(projectID, sessionID string) error {
	path, err := sessionPath(projectID, sessionID)
	if err != nil {
		return err
	}
	parsed, err := parsing.ParseSessionFile(path)
	if err != nil {
		return err
	}
	pd, err := projectsDir()
	if err != nil {
		return err
	}
	subagents := discovery.ResolveSubagents(pd, projectID, sessionID, parsed.TaskCalls, parsed.Messages)
	session := domain.Session{
		ID:            sessionID,
		ProjectID:     projectID,
		ProjectPath:   discovery.DecodePath(discovery.ExtractBaseDir(projectID)),
		CreatedAt:     0.0,
		HasSubagents:  len(subagents) > 0,
		MessageCount:  uint32(len(parsed.Messages)),
		IsOngoing:     discovery.DetectOngoing(path),
		MetadataLevel: ptr.To("deep"),
		CustomTitle:   parsed.CustomTitle,
		AgentName:     parsed.AgentName,
	}
	detail := analysis.BuildSessionDetail(session, parsed.Messages, subagents)
	payload, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	fmt.Println(string(payload))
	return nil
}

// parseDaysArg parses a uint32 window arg for the analytics dump commands.
// The Compute* functions clamp to their own [min,max]; this only rejects
// non-numeric input. No path arg → no session_path guard needed.
func parseDaysArg(s string) (uint32, error) {
	n, err := strconv.ParseUint(s, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid days arg %q: %w", s, err)
	}
	return uint32(n), nil
}

// emitJSON marshals v and prints it (one line), matching the other dump commands.
func emitJSON(v any) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	fmt.Println(string(payload))
	return nil
}

// The W8 analytics dumps mirror analyticsservice.Get* → analytics.Compute*.
// They take only an integer window (no path arg) and resolve the corpus from
// $HOME, so they carry no path-injection surface. Parity is verified live vs the
// Rust CLI twin over a synthetic $HOME (internal/paritytest, W8 Step 5).

func cmdDumpAnalytics(daysArg string) error {
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	resp, err := analytics.ComputeAnalytics(days)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdDumpProductivity(daysArg string) error {
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	resp, err := analytics.ComputeProductivityMetrics(days)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdDumpDuration(daysArg string) error {
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	resp, err := analytics.ComputeSessionDurationStats(days)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdDumpModelComparison(daysArg string) error {
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	resp, err := analytics.ComputeModelComparison(days)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdDumpCostForecast(windowArg string) error {
	windowDays, err := parseDaysArg(windowArg)
	if err != nil {
		return err
	}
	resp, err := analytics.ComputeCostForecast(windowDays)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

// The W9 insights dumps mirror analyticsservice.Get{ToolAnalytics,ToolTimeHeatmap,
// ErrorHotspots,ErrorClusters} → insights.Compute*. Unlike the W8 dumps these take
// a <project> arg, so they MUST validateID it (they have no <session> arg, so the
// sessionPath guard does not cover them; the compute functions build the corpus
// path by raw join with no validation of their own — SECURITY).

func cmdDumpToolAnalytics(projectID, daysArg string) error {
	if err := validateID("project_id", projectID); err != nil {
		return err
	}
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	resp, err := tool_analytics.ComputeToolAnalytics(projectID, days)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdDumpToolHeatmap(projectID, daysArg, toolFilter string) error {
	if err := validateID("project_id", projectID); err != nil {
		return err
	}
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	resp, err := tool_analytics.ComputeToolTimeHeatmap(projectID, days, toolFilter)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdDumpErrorHotspots(projectID, daysArg, minArg string) error {
	if err := validateID("project_id", projectID); err != nil {
		return err
	}
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	minOccurrences, err := parseDaysArg(minArg)
	if err != nil {
		return err
	}
	resp, err := error_hotspots.ComputeErrorHotspots(projectID, days, minOccurrences)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdDumpErrorClusters(projectID, daysArg, minArg string) error {
	if err := validateID("project_id", projectID); err != nil {
		return err
	}
	days, err := parseDaysArg(daysArg)
	if err != nil {
		return err
	}
	minClusterSize, err := parseDaysArg(minArg)
	if err != nil {
		return err
	}
	resp, err := error_hotspots.ComputeErrorClusters(projectID, days, minClusterSize)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

// cmdDumpFileGraph mirrors analyticsservice.GetFileGraph → file_graph.ComputeFileGraph.
// It takes <project> <session> and resolves the root from ~/.claude/projects (what
// the service does when canonicalRoot is empty). Guarded by the sessionPath chain
// (validates both IDs + confines under root) before computing.
func cmdDumpFileGraph(projectID, sessionID string) error {
	if _, err := sessionPath(projectID, sessionID); err != nil {
		return err
	}
	root, err := projectsDir()
	if err != nil {
		return err
	}
	resp, err := file_graph.ComputeFileGraph(root, projectID, sessionID)
	if err != nil {
		return err
	}
	return emitJSON(resp)
}

func cmdShowSession(projectID, sessionID, format string) error {
	// Validate + canonicalize before building (guards), then build the detail
	// via the same stub path the parity harness uses.
	if _, err := sessionPath(projectID, sessionID); err != nil {
		return err
	}
	detail, err := pipeline.BuildSessionDetail(projectID, sessionID)
	if err != nil {
		return err
	}
	switch format {
	case "json":
		payload, err := json.Marshal(detail)
		if err != nil {
			return err
		}
		fmt.Println(string(payload))
	case "markdown":
		fmt.Printf("# Session `%s`\n\n", sessionID)
		fmt.Printf("- Chunks: %d\n", len(detail.Chunks))
		fmt.Printf("- Messages: %d\n", len(detail.Messages))
		fmt.Printf("- Tokens: total=%d input=%d output=%d cache_read=%d\n",
			detail.Metrics.TotalTokens, detail.Metrics.InputTokens,
			detail.Metrics.OutputTokens, detail.Metrics.CacheReadTokens)
		if detail.Metrics.CostUsd != nil {
			fmt.Printf("- Cost USD: $%.4f\n", *detail.Metrics.CostUsd)
		}
	default:
		return fmt.Errorf("unknown --format '%s' (use json|markdown)", format)
	}
	return nil
}

func cmdTail(projectID, sessionID string) error {
	path, err := sessionPath(projectID, sessionID)
	if err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open failed: %w", err)
	}
	defer f.Close()

	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 16*1024*1024)

	start := time.Now()
	bytesWritten := 0
	linesWritten := 0
	for scanner.Scan() {
		if linesWritten >= tailMaxLines {
			fmt.Fprintf(os.Stderr, "tail: line cap (%d) reached; stopping\n", tailMaxLines)
			break
		}
		line := scanner.Text()
		n := len(line) + 1
		elapsed := time.Since(start).Seconds()
		if elapsed < 0.001 {
			elapsed = 0.001
		}
		targetBytes := int(float64(tailBytesPerSec) * elapsed)
		if bytesWritten+n > targetBytes {
			over := bytesWritten + n - targetBytes
			if over > 0 {
				nap := float64(over) / float64(tailBytesPerSec)
				if nap > 1.0 {
					nap = 1.0
				}
				if nap > 0 {
					time.Sleep(time.Duration(nap * float64(time.Second)))
				}
			}
		}
		if _, err := w.WriteString(line); err != nil {
			return err
		}
		if err := w.WriteByte('\n'); err != nil {
			return err
		}
		bytesWritten += n
		linesWritten++
	}
	return nil
}

func cmdStats(asJSON bool) error {
	root, err := projectsDir()
	if err != nil {
		return err
	}
	cdir, err := claudeDir()
	if err != nil {
		return err
	}
	registry := discovery.NewSubprojectRegistry()
	projects, err := discovery.ScanProjects(root, registry)
	if err != nil {
		return err
	}
	totalSessions := 0
	var totalMessages uint64
	for _, p := range projects {
		result, err := discovery.ListSessionsPaginated(root, cdir, p.ID, nil, 1000, discovery.SessionsPaginationOptions{}, registry)
		if err != nil {
			continue
		}
		totalSessions += len(result.Sessions)
		for _, s := range result.Sessions {
			totalMessages += uint64(s.MessageCount)
		}
	}
	if asJSON {
		fmt.Printf("{\"projects\":%d,\"sessions\":%d,\"messages\":%d}\n", len(projects), totalSessions, totalMessages)
	} else {
		fmt.Printf("projects:  %d\n", len(projects))
		fmt.Printf("sessions:  %d\n", totalSessions)
		fmt.Printf("messages:  %d\n", totalMessages)
	}
	return nil
}

func printHelp() {
	fmt.Print("claude-devtools-cli\n\nUSAGE:\n" +
		"  claude-devtools-cli list-projects [--json]\n" +
		"  claude-devtools-cli list-sessions <project_id> [--json]\n" +
		"  claude-devtools-cli show-session <project_id> <session_id> [--format json|markdown]\n" +
		"  claude-devtools-cli tail <project_id> <session_id>\n" +
		"  claude-devtools-cli stats [--json]\n")
}

func hasFlag(args []string, name string) bool {
	for _, a := range args {
		if a == name {
			return true
		}
	}
	return false
}

func flagValue(args []string, name string) (string, bool) {
	for i, a := range args {
		if a == name && i+1 < len(args) {
			return args[i+1], true
		}
		if rest, ok := strings.CutPrefix(a, name+"="); ok {
			return rest, true
		}
	}
	return "", false
}

func run(args []string) error {
	asJSON := hasFlag(args, "--json")
	format := "json"
	if v, ok := flagValue(args, "--format"); ok {
		format = v
	}
	var positional []string
	for _, a := range args {
		if !strings.HasPrefix(a, "--") {
			positional = append(positional, a)
		}
	}
	cmd := ""
	if len(positional) > 0 {
		cmd = positional[0]
	}
	arg := func(i int) string {
		if len(positional) > i {
			return positional[i]
		}
		return ""
	}
	switch cmd {
	case "list-projects", "list":
		return cmdListProjects(asJSON)
	case "list-sessions", "sessions":
		if arg(1) == "" {
			return fmt.Errorf("list-sessions requires <project_id>")
		}
		return cmdListSessions(arg(1), asJSON)
	case "show-session", "show":
		if arg(1) == "" || arg(2) == "" {
			return fmt.Errorf("show-session requires <project_id> <session_id>")
		}
		return cmdShowSession(arg(1), arg(2), format)
	case "dump-messages":
		if arg(1) == "" || arg(2) == "" {
			return fmt.Errorf("dump-messages requires <project_id> <session_id>")
		}
		return cmdDumpMessages(arg(1), arg(2))
	case "dump-detail":
		if arg(1) == "" || arg(2) == "" {
			return fmt.Errorf("dump-detail requires <project_id> <session_id>")
		}
		return cmdDumpDetail(arg(1), arg(2))
	case "dump-analytics":
		if arg(1) == "" {
			return fmt.Errorf("dump-analytics requires <days>")
		}
		return cmdDumpAnalytics(arg(1))
	case "dump-productivity":
		if arg(1) == "" {
			return fmt.Errorf("dump-productivity requires <days>")
		}
		return cmdDumpProductivity(arg(1))
	case "dump-duration":
		if arg(1) == "" {
			return fmt.Errorf("dump-duration requires <days>")
		}
		return cmdDumpDuration(arg(1))
	case "dump-model-comparison":
		if arg(1) == "" {
			return fmt.Errorf("dump-model-comparison requires <days>")
		}
		return cmdDumpModelComparison(arg(1))
	case "dump-cost-forecast":
		if arg(1) == "" {
			return fmt.Errorf("dump-cost-forecast requires <windowDays>")
		}
		return cmdDumpCostForecast(arg(1))
	case "dump-tool-analytics":
		if arg(1) == "" || arg(2) == "" {
			return fmt.Errorf("dump-tool-analytics requires <project_id> <days>")
		}
		return cmdDumpToolAnalytics(arg(1), arg(2))
	case "dump-tool-heatmap":
		if arg(1) == "" || arg(2) == "" {
			return fmt.Errorf("dump-tool-heatmap requires <project_id> <days> [toolFilter]")
		}
		return cmdDumpToolHeatmap(arg(1), arg(2), arg(3))
	case "dump-error-hotspots":
		if arg(1) == "" || arg(2) == "" || arg(3) == "" {
			return fmt.Errorf("dump-error-hotspots requires <project_id> <days> <minOccurrences>")
		}
		return cmdDumpErrorHotspots(arg(1), arg(2), arg(3))
	case "dump-error-clusters":
		if arg(1) == "" || arg(2) == "" || arg(3) == "" {
			return fmt.Errorf("dump-error-clusters requires <project_id> <days> <minClusterSize>")
		}
		return cmdDumpErrorClusters(arg(1), arg(2), arg(3))
	case "dump-file-graph":
		if arg(1) == "" || arg(2) == "" {
			return fmt.Errorf("dump-file-graph requires <project_id> <session_id>")
		}
		return cmdDumpFileGraph(arg(1), arg(2))
	case "tail":
		if arg(1) == "" || arg(2) == "" {
			return fmt.Errorf("tail requires <project_id> <session_id>")
		}
		return cmdTail(arg(1), arg(2))
	case "stats":
		return cmdStats(asJSON)
	case "help", "--help", "-h", "":
		printHelp()
		return nil
	default:
		return fmt.Errorf("Unknown command: %s", cmd)
	}
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "error: %s\n", err)
		os.Exit(1)
	}
}
