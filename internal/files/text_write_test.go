package files

import (
	"os"
	"path/filepath"
	"testing"
)

// instructionTestRoot sets HOME to a fresh temp dir and returns a freshly
// created <tmp>/.claude to use as the instruction-file root.
func instructionTestRoot(t *testing.T) string {
	t.Helper()
	tmp := t.TempDir()
	t.Setenv("HOME", tmp)
	root := filepath.Join(tmp, ".claude")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatalf("mkdir root: %v", err)
	}
	return root
}

func TestWriteTextFileReadRoundTrip(t *testing.T) {
	root := instructionTestRoot(t)
	body := "# CLAUDE.md\n\nRule: <do> & \"quote\" — unicode café 日本語\n"

	if err := WriteTextFile(root, "CLAUDE.md", []byte(body)); err != nil {
		t.Fatalf("first WriteTextFile: %v", err)
	}
	got, err := ReadTextFile(root, "CLAUDE.md")
	if err != nil {
		t.Fatalf("ReadTextFile: %v", err)
	}
	if string(got) != body {
		t.Errorf("round trip mismatch: got %q, want %q", got, body)
	}
	if _, err := os.Stat(filepath.Join(root, "CLAUDE.md.bak")); !os.IsNotExist(err) {
		t.Errorf("expected no .bak after first write, stat err = %v", err)
	}

	second := body + "\nappended rule\n"
	if err := WriteTextFile(root, "CLAUDE.md", []byte(second)); err != nil {
		t.Fatalf("second WriteTextFile: %v", err)
	}
	bak, err := os.ReadFile(filepath.Join(root, "CLAUDE.md.bak"))
	if err != nil {
		t.Fatalf("read .bak: %v", err)
	}
	if string(bak) != body {
		t.Errorf(".bak content = %q, want first-write content %q", bak, body)
	}
	got2, err := ReadTextFile(root, "CLAUDE.md")
	if err != nil {
		t.Fatalf("ReadTextFile after second write: %v", err)
	}
	if string(got2) != second {
		t.Errorf("second round trip mismatch: got %q, want %q", got2, second)
	}
}

func TestMutateTextFileTransformReceivesCurrentAndWritesOutput(t *testing.T) {
	root := instructionTestRoot(t)
	if err := WriteTextFile(root, "rules/style.md", []byte("v1")); err != nil {
		t.Fatalf("seed write: %v", err)
	}

	var seen string
	err := MutateTextFile(root, "rules/style.md", func(current []byte) ([]byte, error) {
		seen = string(current)
		return []byte(seen + "-v2"), nil
	})
	if err != nil {
		t.Fatalf("MutateTextFile: %v", err)
	}
	if seen != "v1" {
		t.Errorf("transform saw %q, want %q", seen, "v1")
	}
	got, err := ReadTextFile(root, "rules/style.md")
	if err != nil {
		t.Fatalf("ReadTextFile: %v", err)
	}
	if string(got) != "v1-v2" {
		t.Errorf("got %q, want %q", got, "v1-v2")
	}
}

func TestWriteTextFileRejectsEscapingOrNonCanonicalPaths(t *testing.T) {
	cases := []string{
		"rules/../../../etc/x", // traversal
		"rules-evil.md",        // sibling-prefix, not segment-bounded
		"/etc/x",               // absolute
		"rules/./x.md",         // non-canonical (Clean changes it)
		"../../etc/x",          // parent escape
	}
	for _, relPath := range cases {
		t.Run(relPath, func(t *testing.T) {
			root := instructionTestRoot(t)
			if err := WriteTextFile(root, relPath, []byte("payload")); err == nil {
				t.Fatalf("expected WriteTextFile(%q) to be rejected", relPath)
			}
		})
	}
}

func TestWriteTextFileRejectsSymlinkedParentEscape(t *testing.T) {
	root := instructionTestRoot(t)
	outside := t.TempDir()

	if err := os.Symlink(outside, filepath.Join(root, "rules")); err != nil {
		t.Fatalf("symlink rules -> outside: %v", err)
	}

	if err := WriteTextFile(root, "rules/x.md", []byte("payload")); err == nil {
		t.Fatalf("expected WriteTextFile to reject a symlinked rules/ escaping root")
	}
	if _, err := os.Stat(filepath.Join(outside, "x.md")); !os.IsNotExist(err) {
		t.Errorf("file leaked outside root via symlinked parent, stat err = %v", err)
	}
}

func TestWriteTextFileRejectsNonUTF8Content(t *testing.T) {
	root := instructionTestRoot(t)
	err := WriteTextFile(root, "CLAUDE.md", []byte{0xff, 0xfe})
	if err == nil {
		t.Fatal("expected non-UTF-8 content to be rejected")
	}
	if _, err := os.Stat(filepath.Join(root, "CLAUDE.md")); !os.IsNotExist(err) {
		t.Errorf("expected no file written, stat err = %v", err)
	}
}

func TestListInstructionFiles(t *testing.T) {
	root := instructionTestRoot(t)
	seed := map[string]string{
		"CLAUDE.md":         "claude md body",
		"RTK.md":            "rtk body",
		"rules/style.md":    "style rules body",
		"commands/foo.toml": "[tool]\nname=\"foo\"",
	}
	for relPath, content := range seed {
		if err := WriteTextFile(root, relPath, []byte(content)); err != nil {
			t.Fatalf("seed WriteTextFile(%q): %v", relPath, err)
		}
	}
	// Non-allowlisted sibling must be excluded.
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("not tracked"), 0o644); err != nil {
		t.Fatalf("write sibling: %v", err)
	}

	got, err := ListInstructionFiles(root)
	if err != nil {
		t.Fatalf("ListInstructionFiles: %v", err)
	}

	byPath := make(map[string]InstructionFile, len(got))
	for _, f := range got {
		byPath[f.RelPath] = f
	}
	for relPath, content := range seed {
		entry, ok := byPath[relPath]
		if !ok {
			t.Errorf("missing entry for %q", relPath)
			continue
		}
		if entry.Bytes != len(content) {
			t.Errorf("%q Bytes = %d, want %d", relPath, entry.Bytes, len(content))
		}
		if entry.ApproxTokens <= 0 {
			t.Errorf("%q ApproxTokens = %d, want > 0", relPath, entry.ApproxTokens)
		}
	}
	if _, ok := byPath["notes.txt"]; ok {
		t.Errorf("non-allowlisted sibling notes.txt leaked into ListInstructionFiles")
	}
}
