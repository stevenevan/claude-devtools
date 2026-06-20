package error_hotspots

import (
	"testing"
)

// ---- shared.rs tests --------------------------------------------------------

func TestNormalizesPrefix(t *testing.T) {
	got := normalizeErrorPrefix("  hello   world  ")
	if got != "hello world" {
		t.Errorf("got %q want %q", got, "hello world")
	}
	long := string(make([]byte, 200))
	for i := range []byte(long) {
		long = long[:i] + "a" + long[i+1:]
	}
	long = string(make([]rune, 200))
	// Build 200-char string of 'a'
	r := make([]rune, 200)
	for i := range r {
		r[i] = 'a'
	}
	long = string(r)
	got2 := normalizeErrorPrefix(long)
	count := len([]rune(got2))
	if count != errorPrefixLen {
		t.Errorf("clipped length: got %d want %d", count, errorPrefixLen)
	}
}

// ---- clusters.rs tests ------------------------------------------------------

func makeRaw(session, tool, msg string) rawError {
	return rawError{
		sessionID:   session,
		toolName:    tool,
		errorPrefix: normalizeErrorPrefix(msg),
		fullText:    msg,
		timestampMs: 0,
	}
}

func TestNearDuplicateErrorsLandInSameCluster(t *testing.T) {
	errors := []rawError{
		makeRaw("s1", "Bash", "Error: file not found at /path/to/foo.rs"),
		makeRaw("s2", "Bash", "Error: file not found at /path/to/bar.rs"),
		makeRaw("s3", "Read", "Permission denied when reading /etc/passwd"),
	}
	clusters := clusterErrors(errors, 2)
	if len(clusters) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(clusters))
	}
	if clusters[0].OccurrenceCount != 2 {
		t.Errorf("OccurrenceCount: got %d want 2", clusters[0].OccurrenceCount)
	}
	if clusters[0].SessionCount != 2 {
		t.Errorf("SessionCount: got %d want 2", clusters[0].SessionCount)
	}
	if clusters[0].PrimaryTool != "Bash" {
		t.Errorf("PrimaryTool: got %q want Bash", clusters[0].PrimaryTool)
	}
}

func TestDisjointErrorsAreNotClustered(t *testing.T) {
	errors := []rawError{
		makeRaw("s1", "Bash", "Error: file not found"),
		makeRaw("s2", "Read", "Syntax error on line 12"),
	}
	clusters := clusterErrors(errors, 2)
	if len(clusters) != 0 {
		t.Errorf("expected 0 clusters, got %d", len(clusters))
	}
}

func TestMinClusterSizeEnforced(t *testing.T) {
	errors := []rawError{
		makeRaw("s1", "Bash", "Error: file not found at /path/a"),
		makeRaw("s2", "Bash", "Error: file not found at /path/b"),
	}
	// min_cluster_size=3 means this 2-member cluster is dropped.
	clusters := clusterErrors(errors, 3)
	if len(clusters) != 0 {
		t.Errorf("expected 0 clusters with minSize=3, got %d", len(clusters))
	}
}
