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

const shingleK = 3
const minSharedShingles = 2

type rawError struct {
	sessionID   string
	toolName    string
	errorPrefix string
	fullText    string
	timestampMs float64
}

func scanSessionRawErrors(path, sessionID string, out *[]rawError) {
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
				*out = append(*out, rawError{
					sessionID:   sessionID,
					toolName:    call.toolName,
					errorPrefix: prefix,
					fullText:    resultText,
					timestampMs: tsMs,
				})
			}
		}
	}
}

// tokenize lower-cases and splits on non-alphanumeric/non-underscore runes.
// Mirrors clusters.rs::tokenize.
func tokenize(text string) []string {
	return strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !('a' <= r && r <= 'z') && !('0' <= r && r <= '9') && r != '_'
	})
}

// shingles returns k-word shingles from a token list.
// Falls back to a single shingle of all tokens when len < k.
// Mirrors clusters.rs::shingles.
func shingles(tokens []string, k int) map[string]struct{} {
	out := make(map[string]struct{})
	if len(tokens) == 0 {
		return out
	}
	if len(tokens) < k {
		out[strings.Join(tokens, " ")] = struct{}{}
		return out
	}
	for i := 0; i <= len(tokens)-k; i++ {
		out[strings.Join(tokens[i:i+k], " ")] = struct{}{}
	}
	return out
}

// unionFind implements path-compressed, rank-union union-find.
type unionFind struct {
	parent []int
	rank   []uint8
}

func newUnionFind(n int) *unionFind {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	return &unionFind{parent: parent, rank: make([]uint8, n)}
}

func (uf *unionFind) find(i int) int {
	for uf.parent[i] != i {
		uf.parent[i] = uf.parent[uf.parent[i]] // path compression
		i = uf.parent[i]
	}
	return i
}

func (uf *unionFind) union(a, b int) {
	ra, rb := uf.find(a), uf.find(b)
	if ra == rb {
		return
	}
	switch {
	case uf.rank[ra] < uf.rank[rb]:
		uf.parent[ra] = rb
	case uf.rank[ra] > uf.rank[rb]:
		uf.parent[rb] = ra
	default:
		uf.parent[rb] = ra
		uf.rank[ra]++
	}
}

// fxhash is the FNV-1a variant used in clusters.rs::fxhash.
// Deterministic display ID generation.
func fxhash(s string) uint64 {
	h := uint64(0xcbf29ce484222325)
	for _, b := range []byte(s) {
		h ^= uint64(b)
		h = h * 0x100000001b3
	}
	return h
}

// clusterErrors groups errors by shingle similarity using union-find.
// Mirrors clusters.rs::cluster_errors.
func clusterErrors(errors []rawError, minClusterSize uint32) []ErrorCluster {
	if len(errors) == 0 {
		return []ErrorCluster{}
	}

	shingleSets := make([]map[string]struct{}, len(errors))
	for i, e := range errors {
		shingleSets[i] = shingles(tokenize(e.fullText), shingleK)
	}

	// Inverted index: shingle → indices containing it.
	inverted := make(map[string][]int)
	for i, set := range shingleSets {
		for s := range set {
			inverted[s] = append(inverted[s], i)
		}
	}

	// Count shared shingles per pair via inverted index.
	pairShared := make(map[[2]int]uint32)
	for _, ids := range inverted {
		if len(ids) < 2 {
			continue
		}
		for i := 0; i < len(ids); i++ {
			for j := i + 1; j < len(ids); j++ {
				a, b := ids[i], ids[j]
				if a > b {
					a, b = b, a
				}
				pairShared[[2]int{a, b}]++
			}
		}
	}

	uf := newUnionFind(len(errors))
	for pair, count := range pairShared {
		if count >= minSharedShingles {
			uf.union(pair[0], pair[1])
		}
	}

	groups := make(map[int][]int)
	for i := range errors {
		root := uf.find(i)
		groups[root] = append(groups[root], i)
	}

	var clusters []ErrorCluster
	for _, memberIDs := range groups {
		if uint32(len(memberIDs)) < minClusterSize {
			continue
		}
		clusters = append(clusters, buildCluster(errors, memberIDs))
	}
	sort.Slice(clusters, func(i, j int) bool {
		return clusters[i].OccurrenceCount > clusters[j].OccurrenceCount
	})
	if clusters == nil {
		clusters = []ErrorCluster{}
	}
	return clusters
}

func buildCluster(errors []rawError, memberIDs []int) ErrorCluster {
	toolCounts := make(map[string]uint32)
	prefixCounts := make(map[string]uint32)
	sessions := make(map[string]struct{})
	lastSeenMs := 0.0

	members := make([]ErrorClusterMember, 0, len(memberIDs))
	for _, id := range memberIDs {
		e := errors[id]
		toolCounts[e.toolName]++
		prefixCounts[e.errorPrefix]++
		sessions[e.sessionID] = struct{}{}
		if e.timestampMs > lastSeenMs {
			lastSeenMs = e.timestampMs
		}
		members = append(members, ErrorClusterMember{
			SessionID:   e.sessionID,
			ToolName:    e.toolName,
			ErrorPrefix: e.errorPrefix,
			TimestampMs: e.timestampMs,
		})
	}

	// Deterministic max: highest count, alpha tie-break.
	primaryTool := maxByCountAlpha(toolCounts, "unknown")
	representative := maxByCountAlpha(prefixCounts, "")

	toolNames := make([]string, 0, len(toolCounts))
	for name := range toolCounts {
		toolNames = append(toolNames, name)
	}
	sort.Strings(toolNames)

	// Sort members by timestamp descending.
	sort.Slice(members, func(i, j int) bool {
		return members[i].TimestampMs > members[j].TimestampMs
	})

	clusterID := fmt.Sprintf("cluster-%s-%x", primaryTool, fxhash(representative))

	return ErrorCluster{
		ID:              clusterID,
		Representative:  representative,
		PrimaryTool:     primaryTool,
		ToolNames:       toolNames,
		OccurrenceCount: uint32(len(memberIDs)),
		SessionCount:    uint32(len(sessions)),
		LastSeenMs:      lastSeenMs,
		Members:         members,
	}
}

// maxByCountAlpha returns the key with the highest count; ties broken alphabetically.
func maxByCountAlpha(m map[string]uint32, fallback string) string {
	best := fallback
	var bestCount uint32
	for k, v := range m {
		if v > bestCount || (v == bestCount && k < best) {
			best = k
			bestCount = v
		}
	}
	return best
}

// ComputeErrorClusters scans sessions and clusters similar errors.
// Mirrors clusters.rs::compute_error_clusters.
func ComputeErrorClusters(projectID string, days, minClusterSize uint32) (*ErrorClustersResponse, error) {
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
	if minClusterSize < 2 {
		minClusterSize = 2
	}

	nowMs := float64(time.Now().UnixMilli())
	cutoffMs := nowMs - float64(days)*86_400_000.0

	entries, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}

	var rawErrors []rawError
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
		scanSessionRawErrors(projectDir+"/"+entry.Name(), sessionID, &rawErrors)
	}

	clusters := clusterErrors(rawErrors, minClusterSize)
	return &ErrorClustersResponse{
		Clusters:        clusters,
		ScannedSessions: scannedSessions,
	}, nil
}
