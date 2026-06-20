package file_graph

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func writeFixture(t *testing.T, name string, lines []string) string {
	t.Helper()
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("fg_test_%s_%d", name, os.Getpid()))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	path := filepath.Join(dir, "session.jsonl")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	for _, l := range lines {
		fmt.Fprintln(f, l)
	}
	return path
}

func TestClassifyAllSupportedOps(t *testing.T) {
	cases := []struct {
		name string
		want op
		ok   bool
	}{
		{"Read", opRead, true},
		{"NotebookRead", opRead, true},
		{"Edit", opEdit, true},
		{"MultiEdit", opEdit, true},
		{"NotebookEdit", opEdit, true},
		{"Write", opWrite, true},
		{"Bash", 0, false},
	}
	for _, c := range cases {
		o, ok := classifyOp(c.name)
		if ok != c.ok {
			t.Errorf("%s: ok=%v want %v", c.name, ok, c.ok)
			continue
		}
		if ok && o != c.want {
			t.Errorf("%s: op=%v want %v", c.name, o, c.want)
		}
	}
}

func TestReadEditWriteCreatesTwoSelfEdges(t *testing.T) {
	path := writeFixture(t, "rew", []string{
		`{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/a.rs"}}]}}`,
		`{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/a.rs"}}]}}`,
		`{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Write","input":{"file_path":"/a.rs"}}]}}`,
	})
	graph, err := ScanFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Nodes) != 1 {
		t.Fatalf("nodes: got %d want 1", len(graph.Nodes))
	}
	if graph.Nodes[0].Path != "/a.rs" {
		t.Errorf("path: got %q want /a.rs", graph.Nodes[0].Path)
	}
	if graph.Nodes[0].TotalInteractions != 3 {
		t.Errorf("total_interactions: got %d want 3", graph.Nodes[0].TotalInteractions)
	}

	kinds := make(map[string]bool)
	for _, e := range graph.Edges {
		kinds[e.Kind] = true
	}
	if !kinds["read-to-edit"] {
		t.Error("missing read-to-edit edge")
	}
	if !kinds["edit-to-write"] {
		t.Error("missing edit-to-write edge")
	}
	if len(graph.Edges) != 2 {
		t.Errorf("edge count: got %d want 2", len(graph.Edges))
	}
}

func TestUnrelatedToolsIgnored(t *testing.T) {
	path := writeFixture(t, "bash", []string{
		`{"message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}`,
	})
	graph, err := ScanFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Nodes) != 0 {
		t.Errorf("expected no nodes, got %d", len(graph.Nodes))
	}
	if len(graph.Edges) != 0 {
		t.Errorf("expected no edges, got %d", len(graph.Edges))
	}
}
