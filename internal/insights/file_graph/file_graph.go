// Package file_graph ports src-tauri/src/analysis/file_graph.rs to Go.
// Backs the get_file_graph command.
package file_graph

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
)

// FileGraphNode mirrors the Rust FileGraphNode struct.
type FileGraphNode struct {
	Path              string   `json:"path"`
	ReadCount         uint32   `json:"readCount"`
	EditCount         uint32   `json:"editCount"`
	WriteCount        uint32   `json:"writeCount"`
	TotalInteractions uint32   `json:"totalInteractions"`
	TurnIndices       []uint32 `json:"turnIndices"`
}

// FileGraphEdge mirrors the Rust FileGraphEdge struct.
type FileGraphEdge struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Kind   string `json:"kind"`
	Weight uint32 `json:"weight"`
}

// FileGraphResponse mirrors the Rust FileGraphResponse struct.
type FileGraphResponse struct {
	Nodes []FileGraphNode `json:"nodes"`
	Edges []FileGraphEdge `json:"edges"`
}

type rawEntry struct {
	Message *rawMsg `json:"message"`
}

type rawMsg struct {
	Role    *string          `json:"role"`
	Content *json.RawMessage `json:"content"`
}

type op int

const (
	opRead op = iota
	opEdit
	opWrite
)

func classifyOp(name string) (op, bool) {
	switch name {
	case "Read", "NotebookRead":
		return opRead, true
	case "Edit", "MultiEdit", "NotebookEdit":
		return opEdit, true
	case "Write":
		return opWrite, true
	default:
		return 0, false
	}
}

// extractPath returns the file path from a tool_use input block.
// Mirrors file_graph.rs::extract_path.
func extractPath(toolName string, input json.RawMessage) (string, bool) {
	var inp map[string]json.RawMessage
	if json.Unmarshal(input, &inp) != nil {
		return "", false
	}
	if v, ok := inp["file_path"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil && s != "" {
			return s, true
		}
	}
	if v, ok := inp["notebook_path"]; ok {
		var s string
		if json.Unmarshal(v, &s) == nil && s != "" {
			return s, true
		}
	}
	if toolName == "Read" {
		if v, ok := inp["path"]; ok {
			var s string
			if json.Unmarshal(v, &s) == nil && s != "" {
				return s, true
			}
		}
	}
	return "", false
}

type nodeAcc struct {
	readCount  uint32
	editCount  uint32
	writeCount uint32
	turns      []uint32
}

// edgeKey is (from, to, kind) — deterministic since we always normalize the
// co-access pair so from <= to.
type edgeKey struct{ from, to, kind string }

// ScanFile runs the file graph scan on a single session JSONL file.
// Extracted as a separate function so tests can drive it without a real
// ~/.claude layout (matching the Rust test approach).
func ScanFile(path string) (*FileGraphResponse, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	nodes := make(map[string]*nodeAcc)
	edges := make(map[edgeKey]uint32)
	lastOp := make(map[string]op)
	turnIndex := -1

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
		if entry.Message == nil {
			continue
		}
		if entry.Message.Role == nil || *entry.Message.Role != "assistant" {
			continue
		}
		if entry.Message.Content == nil {
			continue
		}
		var blocks []json.RawMessage
		if json.Unmarshal(*entry.Message.Content, &blocks) != nil {
			continue
		}

		turnIndex++
		currentTurn := uint32(turnIndex)

		// Collect paths touched this turn for co-access edges.
		turnPaths := make(map[string]struct{})

		for _, b := range blocks {
			var block struct {
				Type  string           `json:"type"`
				Name  string           `json:"name"`
				Input *json.RawMessage `json:"input"`
			}
			if json.Unmarshal(b, &block) != nil || block.Type != "tool_use" {
				continue
			}
			o, ok := classifyOp(block.Name)
			if !ok {
				continue
			}
			if block.Input == nil {
				continue
			}
			p, ok := extractPath(block.Name, *block.Input)
			if !ok {
				continue
			}

			acc := nodes[p]
			if acc == nil {
				acc = &nodeAcc{}
				nodes[p] = acc
			}
			switch o {
			case opRead:
				acc.readCount++
			case opEdit:
				acc.editCount++
			case opWrite:
				acc.writeCount++
			}
			// Add turn index if not already present.
			hasTurn := false
			for _, t := range acc.turns {
				if t == currentTurn {
					hasTurn = true
					break
				}
			}
			if !hasTurn {
				acc.turns = append(acc.turns, currentTurn)
			}

			// Self-transition edge (read-to-edit, edit-to-write).
			if prev, hasPrev := lastOp[p]; hasPrev {
				var kind string
				switch {
				case prev == opRead && o == opEdit:
					kind = "read-to-edit"
				case prev == opEdit && o == opWrite:
					kind = "edit-to-write"
				}
				if kind != "" {
					edges[edgeKey{from: p, to: p, kind: kind}]++
				}
			}
			lastOp[p] = o
			turnPaths[p] = struct{}{}
		}

		// Co-access edges: every unordered pair of distinct paths in this turn.
		turnPathSlice := make([]string, 0, len(turnPaths))
		for p := range turnPaths {
			turnPathSlice = append(turnPathSlice, p)
		}
		// Sort for determinism before building pairs.
		sort.Strings(turnPathSlice)
		for i := 0; i < len(turnPathSlice); i++ {
			for j := i + 1; j < len(turnPathSlice); j++ {
				a, b := turnPathSlice[i], turnPathSlice[j]
				if a > b {
					a, b = b, a
				}
				edges[edgeKey{from: a, to: b, kind: "co-access"}]++
			}
		}
	}

	// Build output slices.
	nodeOut := make([]FileGraphNode, 0, len(nodes))
	for p, a := range nodes {
		ti := make([]uint32, len(a.turns))
		copy(ti, a.turns)
		sort.Slice(ti, func(i, j int) bool { return ti[i] < ti[j] })
		nodeOut = append(nodeOut, FileGraphNode{
			Path:              p,
			ReadCount:         a.readCount,
			EditCount:         a.editCount,
			WriteCount:        a.writeCount,
			TotalInteractions: a.readCount + a.editCount + a.writeCount,
			TurnIndices:       ti,
		})
	}
	// Sort nodes deterministically by path.
	sort.Slice(nodeOut, func(i, j int) bool { return nodeOut[i].Path < nodeOut[j].Path })

	edgeOut := make([]FileGraphEdge, 0, len(edges))
	for k, w := range edges {
		edgeOut = append(edgeOut, FileGraphEdge{From: k.from, To: k.to, Kind: k.kind, Weight: w})
	}
	// Sort edges deterministically.
	sort.Slice(edgeOut, func(i, j int) bool {
		if edgeOut[i].From != edgeOut[j].From {
			return edgeOut[i].From < edgeOut[j].From
		}
		if edgeOut[i].To != edgeOut[j].To {
			return edgeOut[i].To < edgeOut[j].To
		}
		return edgeOut[i].Kind < edgeOut[j].Kind
	})

	return &FileGraphResponse{Nodes: nodeOut, Edges: edgeOut}, nil
}

// ComputeFileGraph resolves the session file and runs ScanFile.
// Mirrors file_graph.rs::compute_file_graph.
// canonicalRoot is the ~/.claude/projects directory.
func ComputeFileGraph(canonicalRoot, projectID, sessionID string) (*FileGraphResponse, error) {
	// Strip composite suffix from project ID.
	baseID := projectID
	if i := strings.Index(projectID, "::"); i >= 0 {
		baseID = projectID[:i]
	}
	sessionPath := canonicalRoot + "/" + baseID + "/" + sessionID + ".jsonl"
	info, err := os.Stat(sessionPath)
	if err != nil || info.IsDir() {
		return nil, fmt.Errorf("session file not readable")
	}
	return ScanFile(sessionPath)
}
