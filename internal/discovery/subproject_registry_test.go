package discovery

import (
	"strings"
	"testing"
)

func TestRegisterAndGetFilter(t *testing.T) {
	r := NewSubprojectRegistry()
	id := r.Register("-Users-name-project", "/Users/name/project", []string{"sess1", "sess2"})
	if !strings.HasPrefix(id, "-Users-name-project::") {
		t.Fatalf("id = %q", id)
	}
	if len(id) != len("-Users-name-project::")+8 {
		t.Fatalf("id len = %d", len(id))
	}
	filter := r.GetSessionFilter(id)
	if filter == nil {
		t.Fatal("nil filter")
	}
	if _, ok := filter["sess1"]; !ok {
		t.Error("missing sess1")
	}
	if _, ok := filter["sess2"]; !ok {
		t.Error("missing sess2")
	}
}

func TestConsistentHash(t *testing.T) {
	h1 := computeCWDHash("/Users/name/project")
	h2 := computeCWDHash("/Users/name/project")
	if h1 != h2 {
		t.Error("hash not consistent")
	}
	if len(h1) != 8 {
		t.Errorf("hash len = %d, want 8", len(h1))
	}
}

func TestDifferentCWDsDifferentHashes(t *testing.T) {
	if computeCWDHash("/Users/name/project1") == computeCWDHash("/Users/name/project2") {
		t.Error("different cwds should hash differently")
	}
}

func TestRegistryClear(t *testing.T) {
	r := NewSubprojectRegistry()
	r.Register("-Users-name-project", "/Users/name/project", []string{"sess1"})
	r.Clear()
	if len(r.entries) != 0 {
		t.Error("entries not cleared")
	}
}
