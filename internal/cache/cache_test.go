package cache

import (
	"testing"
	"time"

	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
)

func ptr[T any](v T) *T { return &v }

func makeSession() domain.ParsedSession { return domain.ParsedSession{} }

// The cache only reads len(Messages), so zero-value messages are sufficient.
func sessionWithMessages(n int) domain.ParsedSession {
	return domain.ParsedSession{Messages: make([]domain.ParsedMessage, n)}
}

func TestInsertAndGet(t *testing.T) {
	c := Default()
	c.Insert("proj/sess1", makeSession())
	if _, ok := c.Get("proj/sess1"); !ok {
		t.Fatal("expected hit for proj/sess1")
	}
	if _, ok := c.Get("proj/sess2"); ok {
		t.Fatal("expected miss for proj/sess2")
	}
}

func TestInvalidate(t *testing.T) {
	c := Default()
	c.Insert("proj/sess1", makeSession())
	c.Invalidate("proj/sess1")
	if _, ok := c.Get("proj/sess1"); ok {
		t.Fatal("expected miss after invalidate")
	}
}

func TestInvalidateProject(t *testing.T) {
	c := Default()
	c.Insert("proj1/sess1", makeSession())
	c.Insert("proj1/sess2", makeSession())
	c.Insert("proj2/sess1", makeSession())
	c.InvalidateProject("proj1")
	if _, ok := c.Get("proj1/sess1"); ok {
		t.Fatal("proj1/sess1 should be gone")
	}
	if _, ok := c.Get("proj1/sess2"); ok {
		t.Fatal("proj1/sess2 should be gone")
	}
	if _, ok := c.Get("proj2/sess1"); !ok {
		t.Fatal("proj2/sess1 should remain")
	}
}

func TestTTLExpiration(t *testing.T) {
	c := New(50, time.Millisecond)
	c.Insert("proj/sess1", makeSession())
	time.Sleep(10 * time.Millisecond)
	if _, ok := c.Get("proj/sess1"); ok {
		t.Fatal("entry should have expired")
	}
}

func TestSetAndGetIncremental(t *testing.T) {
	c := Default()
	c.SetIncremental("proj/sess1", IncrementalState{
		ByteOffset: 1024,
		Metadata:   parsing.SessionFileMetadata{CustomTitle: ptr("My Session")},
	})
	got, ok := c.GetIncremental("proj/sess1")
	if !ok {
		t.Fatal("expected incremental state")
	}
	if got.ByteOffset != 1024 {
		t.Fatalf("byteOffset = %d, want 1024", got.ByteOffset)
	}
	if got.Metadata.CustomTitle == nil || *got.Metadata.CustomTitle != "My Session" {
		t.Fatalf("customTitle mismatch: %v", got.Metadata.CustomTitle)
	}
}

func TestGetIncrementalMissing(t *testing.T) {
	c := Default()
	if _, ok := c.GetIncremental("nonexistent"); ok {
		t.Fatal("expected no incremental state")
	}
}

func TestRemoveIncremental(t *testing.T) {
	c := Default()
	c.SetIncremental("proj/sess1", IncrementalState{ByteOffset: 512})
	c.RemoveIncremental("proj/sess1")
	if _, ok := c.GetIncremental("proj/sess1"); ok {
		t.Fatal("incremental state should be removed")
	}
}

func TestUpdateIncrementalOffset(t *testing.T) {
	c := Default()
	c.SetIncremental("proj/sess1", IncrementalState{ByteOffset: 100})
	c.SetIncremental("proj/sess1", IncrementalState{
		ByteOffset: 500,
		Metadata:   parsing.SessionFileMetadata{CustomTitle: ptr("Updated")},
	})
	got, _ := c.GetIncremental("proj/sess1")
	if got.ByteOffset != 500 {
		t.Fatalf("byteOffset = %d, want 500", got.ByteOffset)
	}
	if got.Metadata.CustomTitle == nil || *got.Metadata.CustomTitle != "Updated" {
		t.Fatalf("customTitle mismatch: %v", got.Metadata.CustomTitle)
	}
}

func TestInvalidateClearsIncremental(t *testing.T) {
	c := Default()
	c.Insert("proj/sess1", makeSession())
	c.SetIncremental("proj/sess1", IncrementalState{ByteOffset: 256})
	c.Invalidate("proj/sess1")
	if _, ok := c.Get("proj/sess1"); ok {
		t.Fatal("session should be gone")
	}
	if _, ok := c.GetIncremental("proj/sess1"); ok {
		t.Fatal("incremental state should be gone")
	}
}

func TestByteEstimateIncrementsOnInsert(t *testing.T) {
	c := Default()
	before := c.TotalByteEstimate()
	c.Insert("proj/s1", sessionWithMessages(10))
	if c.TotalByteEstimate() <= before {
		t.Fatalf("byte estimate did not grow: before=%d after=%d", before, c.TotalByteEstimate())
	}
}

func TestByteBudgetEvictsLruTail(t *testing.T) {
	c := Default()
	c.SetMaxBytes(1024 * 1024) // 1 MB cap
	for i := 0; i < 10; i++ {
		c.Insert(key("p/s", i), sessionWithMessages(100)) // ≈204 KB each
	}
	if c.TotalByteEstimate() > c.MaxBytes() {
		t.Fatalf("total bytes (%d) exceed cap (%d)", c.TotalByteEstimate(), c.MaxBytes())
	}
	if c.BudgetEvicts() == 0 {
		t.Fatal("budgetEvicts must record evictions")
	}
	if _, ok := c.Get("p/s0"); ok {
		t.Fatal("oldest entry p/s0 should have been evicted")
	}
}

func TestSetMaxBytesReEnforcesImmediately(t *testing.T) {
	c := Default()
	for i := 0; i < 10; i++ {
		c.Insert(key("p/s", i), sessionWithMessages(500)) // ≈10 MB total
	}
	beforeTotal := c.TotalByteEstimate()
	beforeEvicts := c.BudgetEvicts()
	c.SetMaxBytes(1024 * 1024) // 1 MB floor
	if c.BudgetEvicts() <= beforeEvicts {
		t.Fatal("set_max_bytes must evict immediately")
	}
	if c.TotalByteEstimate() >= beforeTotal {
		t.Fatal("total should drop after re-enforce")
	}
	if c.TotalByteEstimate() > c.MaxBytes() {
		t.Fatalf("total (%d) must be under cap (%d)", c.TotalByteEstimate(), c.MaxBytes())
	}
}

func TestInvalidateProjectClearsIncremental(t *testing.T) {
	c := Default()
	c.Insert("proj1/sess1", makeSession())
	c.SetIncremental("proj1/sess1", IncrementalState{ByteOffset: 100})
	c.Insert("proj2/sess1", makeSession())
	c.SetIncremental("proj2/sess1", IncrementalState{ByteOffset: 200})
	c.InvalidateProject("proj1")
	if _, ok := c.GetIncremental("proj1/sess1"); ok {
		t.Fatal("proj1 incremental state should be gone")
	}
	if _, ok := c.GetIncremental("proj2/sess1"); !ok {
		t.Fatal("proj2 incremental state should remain")
	}
}

func key(prefix string, i int) string {
	return prefix + string(rune('0'+i))
}
