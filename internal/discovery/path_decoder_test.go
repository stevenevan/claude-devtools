package discovery

import (
	"path/filepath"
	"testing"
)

// buildSessionPath mirrors the Rust test helper (path_decoder.rs tests).
func buildSessionPath(base, projectID, sessionID string) string {
	return filepath.Join(base, ExtractBaseDir(projectID), sessionID+".jsonl")
}

func TestEncodePath(t *testing.T) {
	if got := EncodePath("/Users/name/project"); got != "-Users-name-project" {
		t.Errorf("EncodePath = %q", got)
	}
	if got := EncodePath(""); got != "" {
		t.Errorf("EncodePath(empty) = %q", got)
	}
}

func TestDecodePath(t *testing.T) {
	cases := map[string]string{
		"-Users-name-project":                "/Users/name/project",
		"":                                   "",
		"C--Users-name-project":              "C:/Users/name/project",
		"-Users-name-code-repos-project-v2":  "/Users/name/code/repos/project/v2",
		"-C:-Users-name-project":             "C:/Users/name/project",
	}
	for in, want := range cases {
		if got := DecodePath(in); got != want {
			t.Errorf("DecodePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDecodePathLossyDashes(t *testing.T) {
	encoded := EncodePath("/Users/name/my-project")
	if encoded != "-Users-name-my-project" {
		t.Fatalf("encode = %q", encoded)
	}
	// Known lossy behavior: dashes become slashes.
	if got := DecodePath(encoded); got != "/Users/name/my/project" {
		t.Errorf("DecodePath = %q", got)
	}
}

func TestExtractProjectName(t *testing.T) {
	if got := ExtractProjectName("-Users-name-my-project", "/Users/name/my-project"); got != "my-project" {
		t.Errorf("with hint = %q", got)
	}
	if got := ExtractProjectName("-Users-name-project", ""); got != "project" {
		t.Errorf("without hint = %q", got)
	}
	if got := ExtractProjectName("-", ""); got != "-" {
		t.Errorf("single dash = %q", got)
	}
}

func TestIsValidEncodedPath(t *testing.T) {
	valid := []string{"-Users-name-project", "-C:-Users-name-project", "C--Users-name-project", "-Users-name-my_project.v2"}
	for _, v := range valid {
		if !IsValidEncodedPath(v) {
			t.Errorf("expected valid: %q", v)
		}
	}
	invalid := []string{"", "no-leading-dash", "-invalid/chars", "-Users/name", `-Users\name`, "-Users@name"}
	for _, v := range invalid {
		if IsValidEncodedPath(v) {
			t.Errorf("expected invalid: %q", v)
		}
	}
}

func TestIsValidProjectID(t *testing.T) {
	if !IsValidProjectID("-Users-name-project::abcdef01") {
		t.Error("composite should be valid")
	}
	if IsValidProjectID("-Users-name-project::short") {
		t.Error("short hash should be invalid")
	}
	if IsValidProjectID("-Users-name-project::ABCDEF01") {
		t.Error("uppercase hash should be invalid")
	}
	oversize := "-foo"
	for i := 0; i < 1024; i++ {
		oversize += "a"
	}
	if IsValidProjectID(oversize) {
		t.Error("oversize should be invalid")
	}
}

func TestIsValidSessionID(t *testing.T) {
	valid := []string{
		"0123abcd-4567-89ef-abcd-0123456789ab",
		"ABCDEF01-2345-6789-abcd-ef0123456789",
		"00000000-0000-0000-0000-000000000000",
	}
	for _, v := range valid {
		if !IsValidSessionID(v) {
			t.Errorf("expected valid: %q", v)
		}
	}
	invalid := []string{
		"", "ABCD", "../../../etc/passwd",
		"gggggggg-gggg-gggg-gggg-gggggggggggg",
		"0123abcd-4567-89ef-abcd-0123456789a",
		"0123abcd-4567-89ef-abcd-0123456789abc",
	}
	for _, v := range invalid {
		if IsValidSessionID(v) {
			t.Errorf("expected invalid: %q", v)
		}
	}
}

func TestExtractBaseDir(t *testing.T) {
	if got := ExtractBaseDir("-Users-name-project"); got != "-Users-name-project" {
		t.Errorf("plain = %q", got)
	}
	if got := ExtractBaseDir("-Users-name-project::abcdef01"); got != "-Users-name-project" {
		t.Errorf("composite = %q", got)
	}
}

func TestBuildSessionPath(t *testing.T) {
	base := "/home/.claude/projects"
	want := "/home/.claude/projects/-Users-name-project/sess123.jsonl"
	if got := buildSessionPath(base, "-Users-name-project", "sess123"); got != want {
		t.Errorf("plain = %q", got)
	}
	if got := buildSessionPath(base, "-Users-name-project::abcdef01", "sess123"); got != want {
		t.Errorf("composite = %q", got)
	}
}

func TestBuildTodoPath(t *testing.T) {
	if got := BuildTodoPath("/home/.claude", "sess123"); got != "/home/.claude/todos/sess123.json" {
		t.Errorf("= %q", got)
	}
}

func TestGetProjectsBasePath(t *testing.T) {
	if got := GetProjectsBasePath("/home/.claude"); got != "/home/.claude/projects" {
		t.Errorf("= %q", got)
	}
}

func TestReversibleRoundtrip(t *testing.T) {
	originals := []string{
		"/Users/name/my-project",
		"/Users/name/project",
		"",
		"/Users/name/my-project/sub-dir/file-name.ts",
		"/Users/name/100%done",
	}
	for _, o := range originals {
		if got := DecodePathReversible(EncodePathReversible(o)); got != o {
			t.Errorf("roundtrip %q = %q", o, got)
		}
	}
}

func TestIsReversibleEncodingDetection(t *testing.T) {
	if !IsReversibleEncoding(EncodePathReversible("/Users/name/my-project")) {
		t.Error("reversible should be detected")
	}
	if IsReversibleEncoding(EncodePath("/Users/name/project")) {
		t.Error("legacy should not be detected as reversible")
	}
}

func TestDecodePathSmart(t *testing.T) {
	if got := DecodePathSmart("-Users-name-my-project", "/Users/name/my-project"); got != "/Users/name/my-project" {
		t.Errorf("hint = %q", got)
	}
	if got := DecodePathSmart(EncodePathReversible("/Users/name/my-project"), ""); got != "/Users/name/my-project" {
		t.Errorf("reversible = %q", got)
	}
	if got := DecodePathSmart("-Users-name-project", ""); got != "/Users/name/project" {
		t.Errorf("legacy = %q", got)
	}
}
