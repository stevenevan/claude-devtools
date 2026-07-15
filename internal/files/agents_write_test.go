// External test package (files_test): the delete->restore round-trip imports
// internal/maintenance, which itself imports internal/files, so an internal
// (package files) test would form an import cycle. Everything here exercises
// the exported agent-writer API only.
package files_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"claude-devtools/internal/files"
	"claude-devtools/internal/maintenance"
)

func ptr(s string) *string { return &s }

// agentTestRoot returns a fresh temp root with an agents/ dir created.
func agentTestRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "agents"), 0o755); err != nil {
		t.Fatalf("mkdir agents: %v", err)
	}
	return root
}

func seedAgent(t *testing.T, root, fileBase, content string) string {
	t.Helper()
	p := filepath.Join(root, "agents", fileBase+".md")
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatalf("seed agent %q: %v", fileBase, err)
	}
	return p
}

const fullAgent = "---\n" +
	"name: test-agent\n" +
	"description: A test agent\n" +
	"tools: Read, Write\n" +
	"model: sonnet\n" +
	"color: purple\n" +
	"emoji: sparkles\n" +
	"vibe: chill\n" +
	"---\n" +
	"\n" +
	"You are a test agent.\n" +
	"Do things.\n"

func TestPatchAgentPreservesBodyAndUnknownKeys(t *testing.T) {
	root := agentTestRoot(t)
	dest := seedAgent(t, root, "test-agent", fullAgent)

	if err := files.PatchAgentFrontmatter(root, "test-agent", files.AgentPatch{Model: ptr("opus")}); err != nil {
		t.Fatalf("PatchAgentFrontmatter: %v", err)
	}

	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read patched: %v", err)
	}
	want := strings.Replace(fullAgent, "model: sonnet\n", "model: opus\n", 1)
	if string(got) != want {
		t.Errorf("only the touched key line should change.\n got: %q\nwant: %q", got, want)
	}
	// Body preserved verbatim.
	if !strings.HasSuffix(string(got), "\n---\n\nYou are a test agent.\nDo things.\n") {
		t.Errorf("body not preserved byte-for-byte: %q", got)
	}
	// Unknown keys survive untouched.
	for _, unknown := range []string{"color: purple", "emoji: sparkles", "vibe: chill"} {
		if !strings.Contains(string(got), unknown) {
			t.Errorf("unknown key %q not preserved", unknown)
		}
	}
	// .bak holds the pre-patch bytes.
	bak, err := os.ReadFile(dest + ".bak")
	if err != nil {
		t.Fatalf("read .bak: %v", err)
	}
	if string(bak) != fullAgent {
		t.Errorf(".bak = %q, want original %q", bak, fullAgent)
	}
}

func TestPatchAgentAppendsAbsentKey(t *testing.T) {
	root := agentTestRoot(t)
	seed := "---\nname: minimal\ndescription: min\n---\n\nBody.\n"
	dest := seedAgent(t, root, "minimal", seed)

	if err := files.PatchAgentFrontmatter(root, "minimal", files.AgentPatch{Model: ptr("haiku")}); err != nil {
		t.Fatalf("PatchAgentFrontmatter: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read patched: %v", err)
	}
	want := "---\nname: minimal\ndescription: min\nmodel: haiku\n---\n\nBody.\n"
	if string(got) != want {
		t.Errorf("append mismatch.\n got: %q\nwant: %q", got, want)
	}
}

func TestPatchAgentBodyReplaceKeepsFrontmatter(t *testing.T) {
	root := agentTestRoot(t)
	dest := seedAgent(t, root, "test-agent", fullAgent)

	newBody := "Completely new body.\n"
	if err := files.PatchAgentFrontmatter(root, "test-agent", files.AgentPatch{Body: ptr(newBody)}); err != nil {
		t.Fatalf("PatchAgentFrontmatter: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read patched: %v", err)
	}

	fmThroughFence := fullAgent[:strings.Index(fullAgent, "---\n\nYou")+len("---\n")]
	want := fmThroughFence + newBody
	if string(got) != want {
		t.Errorf("body-replace should keep frontmatter byte-identical.\n got: %q\nwant: %q", got, want)
	}
}

func TestPatchAgentRefusesBlockScalarValue(t *testing.T) {
	cases := map[string]string{
		"folded-indicator": "---\nname: blocky\ndescription: >\n  A folded\n  description here\nmodel: opus\n---\n\nBody.\n",
		"indented-cont":    "---\nname: multi\ndescription: first line\n  continuation\nmodel: opus\n---\n\nBody.\n",
	}
	for name, seed := range cases {
		t.Run(name, func(t *testing.T) {
			root := agentTestRoot(t)
			dest := seedAgent(t, root, "agent", seed)

			err := files.PatchAgentFrontmatter(root, "agent", files.AgentPatch{Description: ptr("new")})
			if err == nil {
				t.Fatal("expected block-scalar/multi-line patch to be refused")
			}
			got, err := os.ReadFile(dest)
			if err != nil {
				t.Fatalf("read file: %v", err)
			}
			if string(got) != seed {
				t.Errorf("file must be unchanged on refusal.\n got: %q\nwant: %q", got, seed)
			}
			if _, statErr := os.Stat(dest + ".bak"); !os.IsNotExist(statErr) {
				t.Errorf("no .bak should be written on refusal, stat err = %v", statErr)
			}
		})
	}
}

func TestCreateAgentTemplateReParses(t *testing.T) {
	root := agentTestRoot(t)
	if err := files.CreateAgent(root, "fresh-agent", "A fresh agent"); err != nil {
		t.Fatalf("CreateAgent: %v", err)
	}
	agents, err := files.ReadManagedAgents(root)
	if err != nil {
		t.Fatalf("ReadManagedAgents: %v", err)
	}
	found := false
	for _, a := range agents {
		if a.Name == "fresh-agent" {
			found = true
			if a.Description != "\"A fresh agent\"" {
				t.Errorf("description = %q, want quoted %q", a.Description, "\"A fresh agent\"")
			}
		}
	}
	if !found {
		t.Fatalf("created agent did not re-parse into ReadManagedAgents: %+v", agents)
	}
}

func TestCreateAgentEscapesQuotesAndBackslashes(t *testing.T) {
	root := agentTestRoot(t)
	if err := files.CreateAgent(root, "quoted", `has "quotes" and \ backslash`); err != nil {
		t.Fatalf("CreateAgent: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "agents", "quoted.md"))
	if err != nil {
		t.Fatalf("read created: %v", err)
	}
	if !strings.Contains(string(raw), `description: "has \"quotes\" and \\ backslash"`) {
		t.Errorf("quotes/backslashes not escaped in template: %q", raw)
	}
	// Name must still re-parse.
	agents, _ := files.ReadManagedAgents(root)
	found := false
	for _, a := range agents {
		if a.Name == "quoted" {
			found = true
		}
	}
	if !found {
		t.Error("escaped-description agent did not re-parse a name")
	}
}

func TestCreateAgentRejectsDuplicate(t *testing.T) {
	root := agentTestRoot(t)
	if err := files.CreateAgent(root, "dup", "first"); err != nil {
		t.Fatalf("first CreateAgent: %v", err)
	}
	if err := files.CreateAgent(root, "dup", "second"); err == nil {
		t.Fatal("expected duplicate agent name to be rejected")
	}
}

func TestCreateAgentRejectsNewlineDescription(t *testing.T) {
	root := agentTestRoot(t)
	for _, desc := range []string{"line1\nline2", "carriage\rreturn"} {
		if err := files.CreateAgent(root, "nl", desc); err == nil {
			t.Fatalf("expected newline description %q to be rejected", desc)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "agents", "nl.md")); !os.IsNotExist(err) {
		t.Errorf("no file should be written for a rejected description, stat err = %v", err)
	}
}

func TestResolveAgentPathRejectsUnsafeNames(t *testing.T) {
	root := agentTestRoot(t)
	for _, bad := range []string{"../evil", "a/b", "", ".", "..", "/abs/path"} {
		if _, err := files.ResolveAgentPath(root, bad); err == nil {
			t.Errorf("expected ResolveAgentPath(%q) to be rejected", bad)
		}
	}
}

func TestDeleteRestoreRoundTrip(t *testing.T) {
	root := agentTestRoot(t)
	appData := t.TempDir()
	dest := seedAgent(t, root, "victim", fullAgent)

	resolved, err := files.ResolveAgentPath(root, "victim")
	if err != nil {
		t.Fatalf("ResolveAgentPath: %v", err)
	}
	roots := []string{root}

	receipt, err := maintenance.TrashItems(roots, appData, []string{resolved})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatalf("agent should be gone after trash, stat err = %v", err)
	}

	if err := maintenance.RestoreTrash(roots, appData, receipt.ID); err != nil {
		t.Fatalf("RestoreTrash: %v", err)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read restored: %v", err)
	}
	if string(got) != fullAgent {
		t.Errorf("restored agent not byte-identical.\n got: %q\nwant: %q", got, fullAgent)
	}
}
