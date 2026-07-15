// External test package (files_test): assertions run against the exported
// memory API only, matching agents_write_test.go / skills_inventory_test.go.
package files_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"claude-devtools/internal/files"
)

// validEncodedID passes discovery.IsValidProjectID (leading "-", encoded path).
const validEncodedID = "-tmp-fixture-proj"

// memoryIndex is the fixture MEMORY.md: fact_a is a valid entry, fact_c/fact_d
// are valid entries, and missing.md is a DANGLING-INDEX entry (no file on disk).
// fact_b.md is deliberately absent here so it is the ONLY orphan.
const memoryIndex = `# Memory Index

## Feedback
- [fact_a.md](fact_a.md) — Fact A description

## Project
- [fact_c.md](fact_c.md) — Fact C
- [fact_d.md](fact_d.md) — Fact D
- [missing.md](missing.md) — dangling entry
`

const factA = `---
name: fact-a
description: Fact A description
type: feedback
---

Body of A with a [[does-not-exist]] dangling link.
`

const factB = `---
name: fact-b
description: Fact B description
type: feedback
---

Body of B (orphan — on disk, not in the index).
`

const factC = `---
name: dupe-name
description: Fact C
type: project
---

Body of C.
`

const factD = `---
name: dupe-name
description: Fact D
type: project
---

Body of D.
`

// buildMemoryFixture lays down <root>/projects/<validEncodedID>/memory/ with the
// MEMORY.md index + fact files exercising all four finding kinds. Returns
// (root, dirID, memDir).
func buildMemoryFixture(t *testing.T) (root, dirID, memDir string) {
	t.Helper()
	root = t.TempDir()
	dirID = "project:" + validEncodedID
	memDir = filepath.Join(root, "projects", validEncodedID, "memory")
	if err := os.MkdirAll(memDir, 0o755); err != nil {
		t.Fatalf("mkdir memory: %v", err)
	}
	for name, content := range map[string]string{
		"MEMORY.md": memoryIndex,
		"fact_a.md": factA,
		"fact_b.md": factB,
		"fact_c.md": factC,
		"fact_d.md": factD,
	} {
		if err := os.WriteFile(filepath.Join(memDir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}
	return root, dirID, memDir
}

func findingByKind(findings []files.MemoryFinding, kind string) *files.MemoryFinding {
	for i := range findings {
		if findings[i].Kind == kind {
			return &findings[i]
		}
	}
	return nil
}

func TestMemoryIntegrityFindsAllFourKinds(t *testing.T) {
	root, dirID, _ := buildMemoryFixture(t)

	report, err := files.MemoryIntegrity(root, dirID)
	if err != nil {
		t.Fatalf("MemoryIntegrity: %v", err)
	}

	orphan := findingByKind(report.Findings, "orphan-file")
	if orphan == nil {
		t.Fatal("expected an orphan-file finding for fact_b.md")
	}
	if orphan.File != "fact_b.md" {
		t.Errorf("orphan File = %q, want fact_b.md", orphan.File)
	}
	if orphan.Fix == nil || orphan.Fix.Op != "add" {
		t.Errorf("orphan Fix = %+v, want Op=add", orphan.Fix)
	}

	dangIdx := findingByKind(report.Findings, "dangling-index")
	if dangIdx == nil {
		t.Fatal("expected a dangling-index finding for missing.md")
	}
	if dangIdx.Fix == nil || dangIdx.Fix.Op != "remove" {
		t.Errorf("dangling-index Fix = %+v, want Op=remove", dangIdx.Fix)
	}
	// The remove Line must be a VERBATIM MEMORY.md line so removal is byte-exact.
	if dangIdx.Fix != nil && !strings.Contains(memoryIndex, dangIdx.Fix.Line) {
		t.Errorf("dangling-index Fix.Line = %q is not a verbatim MEMORY.md line", dangIdx.Fix.Line)
	}
	if dangIdx.File != "missing.md" {
		t.Errorf("dangling-index File = %q, want missing.md", dangIdx.File)
	}

	dangLink := findingByKind(report.Findings, "dangling-link")
	if dangLink == nil {
		t.Fatal("expected a dangling-link finding for [[does-not-exist]]")
	}
	if dangLink.Fix != nil {
		t.Errorf("dangling-link Fix must be nil (informational), got %+v", dangLink.Fix)
	}

	dup := findingByKind(report.Findings, "duplicate-slug")
	if dup == nil {
		t.Fatal("expected a duplicate-slug finding for dupe-name")
	}
	if dup.Fix != nil {
		t.Errorf("duplicate-slug Fix must be nil (manual merge), got %+v", dup.Fix)
	}
}

func TestMemoryIntegrityIgnoresBackupsAndDotfiles(t *testing.T) {
	root, dirID, memDir := buildMemoryFixture(t)
	// A .bak byproduct, a .tmp, a dotfile, and the consolidation lock must never
	// be flagged as orphan-file (Security S3).
	for _, name := range []string{"fact_a.md.bak", "fact_a.md.tmp", ".DS_Store", ".consolidate-lock"} {
		if err := os.WriteFile(filepath.Join(memDir, name), []byte("junk"), 0o644); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}

	report, err := files.MemoryIntegrity(root, dirID)
	if err != nil {
		t.Fatalf("MemoryIntegrity: %v", err)
	}
	for _, f := range report.Findings {
		if f.Kind != "orphan-file" {
			continue
		}
		if f.File != "fact_b.md" {
			t.Errorf("only fact_b.md may be an orphan, got %q", f.File)
		}
	}
}

func TestApplyMemoryIndexFixAddOrphan(t *testing.T) {
	root, dirID, memDir := buildMemoryFixture(t)
	indexPath := filepath.Join(memDir, "MEMORY.md")

	report, err := files.MemoryIntegrity(root, dirID)
	if err != nil {
		t.Fatalf("MemoryIntegrity: %v", err)
	}
	orphan := findingByKind(report.Findings, "orphan-file")
	if orphan == nil {
		t.Fatal("no orphan finding")
	}

	if err := files.ApplyMemoryIndexFix(root, dirID, *orphan.Fix); err != nil {
		t.Fatalf("ApplyMemoryIndexFix(add): %v", err)
	}

	got, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	want := memoryIndex + orphan.Fix.Line + "\n"
	if string(got) != want {
		t.Errorf("index after add not byte-exact.\n got: %q\nwant: %q", got, want)
	}
	if !strings.HasPrefix(string(got), memoryIndex) {
		t.Error("all prior bytes must be preserved (original is a prefix)")
	}
	if lines := strings.Count(string(got), "\n"); lines != strings.Count(memoryIndex, "\n")+1 {
		t.Errorf("index gained %d lines, want exactly 1", lines-strings.Count(memoryIndex, "\n"))
	}
}

func TestApplyMemoryIndexFixRemoveDangling(t *testing.T) {
	root, dirID, memDir := buildMemoryFixture(t)
	indexPath := filepath.Join(memDir, "MEMORY.md")

	report, err := files.MemoryIntegrity(root, dirID)
	if err != nil {
		t.Fatalf("MemoryIntegrity: %v", err)
	}
	dangIdx := findingByKind(report.Findings, "dangling-index")
	if dangIdx == nil {
		t.Fatal("no dangling-index finding")
	}

	if err := files.ApplyMemoryIndexFix(root, dirID, *dangIdx.Fix); err != nil {
		t.Fatalf("ApplyMemoryIndexFix(remove): %v", err)
	}

	got, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	// want is the source minus exactly the one verbatim line (+ its newline).
	want := strings.Replace(memoryIndex, dangIdx.Fix.Line+"\n", "", 1)
	if string(got) != want {
		t.Errorf("index after remove not byte-exact.\n got: %q\nwant: %q", got, want)
	}
	if strings.Contains(string(got), "missing.md") {
		t.Error("removed dangling-index line must be gone")
	}
}

func TestApplyMemoryIndexFixRejectsStale(t *testing.T) {
	root, dirID, _ := buildMemoryFixture(t)

	// A fabricated fix that matches no finding must be refused (client can't
	// inject an arbitrary index line).
	bogus := files.MemoryIndexFix{Op: "add", Line: "- [evil.md](evil.md) — injected"}
	if err := files.ApplyMemoryIndexFix(root, dirID, bogus); err == nil {
		t.Error("ApplyMemoryIndexFix must reject a fix with no matching finding")
	}
}

func TestWriteMemoryFileRoundTrips(t *testing.T) {
	root, dirID, memDir := buildMemoryFixture(t)

	edited := "---\nname: fact-a-edited\ndescription: edited\ntype: feedback\n---\n\nedited body\n"
	if err := files.WriteMemoryFile(root, dirID, "fact_a.md", []byte(edited)); err != nil {
		t.Fatalf("WriteMemoryFile: %v", err)
	}

	got, err := files.ReadMemoryFile(root, dirID, "fact_a.md")
	if err != nil {
		t.Fatalf("ReadMemoryFile: %v", err)
	}
	if got != edited {
		t.Errorf("fact file not byte-faithful.\n got: %q\nwant: %q", got, edited)
	}

	// .bak preserves the original bytes.
	bak, err := os.ReadFile(filepath.Join(memDir, "fact_a.md.bak"))
	if err != nil {
		t.Fatalf("read .bak: %v", err)
	}
	if string(bak) != factA {
		t.Errorf(".bak = %q, want original", bak)
	}

	// Frontmatter re-parses to the edited name.
	report, err := files.MemoryIntegrity(root, dirID)
	if err != nil {
		t.Fatalf("MemoryIntegrity: %v", err)
	}
	var name string
	for _, f := range report.Files {
		if f.FileName == "fact_a.md" {
			name = f.Name
		}
	}
	if name != "fact-a-edited" {
		t.Errorf("re-parsed name = %q, want fact-a-edited", name)
	}
}

func TestResolveMemoryDirRejectsBadIDs(t *testing.T) {
	root, _, _ := buildMemoryFixture(t)

	for _, dirID := range []string{"bogus:x", "project:../evil", "agent:../x", "project:evil-no-dash"} {
		if _, _, err := files.ResolveMemoryDir(root, dirID); err == nil {
			t.Errorf("ResolveMemoryDir(%q) must be rejected", dirID)
		}
	}
}

func TestResolveMemoryDirRejectsMissingDir(t *testing.T) {
	root, _, _ := buildMemoryFixture(t)
	// A valid-looking project ID whose projects/<encoded> parent doesn't exist
	// must be rejected (confine-parent-must-exist, no scan).
	if _, _, err := files.ResolveMemoryDir(root, "project:-tmp-does-not-exist-xyz"); err == nil {
		t.Error("ResolveMemoryDir for a non-existent dir must be rejected")
	}
}

func TestMemoryWritesRefusedUnderConsolidationLock(t *testing.T) {
	root, dirID, memDir := buildMemoryFixture(t)
	if err := os.WriteFile(filepath.Join(memDir, ".consolidate-lock"), nil, 0o644); err != nil {
		t.Fatalf("touch lock: %v", err)
	}

	if err := files.WriteMemoryFile(root, dirID, "fact_a.md", []byte("nope\n")); err == nil {
		t.Error("WriteMemoryFile must refuse while .consolidate-lock is present")
	}
	fix := files.MemoryIndexFix{Op: "add", Line: "- [x.md](x.md) — x"}
	if err := files.ApplyMemoryIndexFix(root, dirID, fix); err == nil {
		t.Error("ApplyMemoryIndexFix must refuse while .consolidate-lock is present")
	}
}
