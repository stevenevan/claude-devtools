package cache

import (
	"go/build"
	"strings"
	"testing"
)

// TestCacheImportsAreDownwardOnly enforces arch H1: the cache leaf may import
// only domain + parsing (and stdlib/lru), never pipeline/analysis/any service —
// so a later port can't introduce an import cycle.
func TestCacheImportsAreDownwardOnly(t *testing.T) {
	pkg, err := build.ImportDir(".", 0)
	if err != nil {
		t.Fatalf("ImportDir: %v", err)
	}
	forbidden := []string{
		"claude-devtools/internal/pipeline",
		"claude-devtools/internal/analysis",
		"service", // any internal/<x>service
	}
	for _, imp := range pkg.Imports {
		for _, bad := range forbidden {
			if strings.Contains(imp, bad) {
				t.Errorf("cache must not import %q (downward-only rule)", imp)
			}
		}
	}
}
