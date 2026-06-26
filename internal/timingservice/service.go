// Package timingservice ports timing.rs: a fixed-capacity ring buffer of command
// durations plus p50/p95/p99 percentile summarisation, and thin wrappers over
// the shared cache for GetCacheStats/SetCacheCapacity/ClearSessionCache.
package timingservice

import (
	"sort"
	"sync"
	"time"

	"claude-devtools/internal/cache"
)

// ---------------------------------------------------------------------------
// TimingBuffer — mirrors timing.rs::TimingBuffer
// ---------------------------------------------------------------------------

const bufferCapacity = 1024

// TimingEntry mirrors timing.rs::TimingEntry.
type TimingEntry struct {
	Command    string  `json:"command"`
	DurationMs float64 `json:"durationMs"`
	AtUnixMs   float64 `json:"atUnixMs"`
}

// TimingBuffer is a fixed-size ring buffer of timing entries (mutex-safe).
// Mirrors timing.rs::TimingBuffer.
type TimingBuffer struct {
	mu       sync.Mutex
	entries  []TimingEntry // circular ring, head tracks oldest
	head     int
	count    int
	capacity int
}

// NewTimingBuffer creates a ring buffer of the given capacity.
func NewTimingBuffer(capacity int) *TimingBuffer {
	if capacity < 1 {
		capacity = bufferCapacity
	}
	return &TimingBuffer{
		entries:  make([]TimingEntry, capacity),
		capacity: capacity,
	}
}

// Record appends an entry, evicting the oldest when full.
// Mirrors TimingBuffer::record.
func (b *TimingBuffer) Record(command string, durationMs float64) {
	entry := TimingEntry{
		Command:    command,
		DurationMs: durationMs,
		AtUnixMs:   nowUnixMS(),
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.entries[b.head] = entry
	b.head = (b.head + 1) % b.capacity
	if b.count < b.capacity {
		b.count++
	}
}

// Snapshot returns entries newest-first. Mirrors TimingBuffer::snapshot.
func (b *TimingBuffer) Snapshot() []TimingEntry {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.count == 0 {
		return []TimingEntry{}
	}
	out := make([]TimingEntry, b.count)
	for i := 0; i < b.count; i++ {
		// newest is at head-1 going backwards
		idx := ((b.head - 1 - i) % b.capacity + b.capacity) % b.capacity
		out[i] = b.entries[idx]
	}
	return out
}

// Clear empties the ring. Mirrors TimingBuffer::clear.
func (b *TimingBuffer) Clear() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.count = 0
	b.head = 0
}

func nowUnixMS() float64 {
	return float64(time.Now().UnixMilli())
}

// ---------------------------------------------------------------------------
// Percentile summarisation — mirrors timing.rs::summarize
// ---------------------------------------------------------------------------

// PercentileSummary mirrors timing.rs::PercentileSummary.
type PercentileSummary struct {
	Command string  `json:"command"`
	Count   uint32  `json:"count"`
	P50Ms   float64 `json:"p50Ms"`
	P95Ms   float64 `json:"p95Ms"`
	P99Ms   float64 `json:"p99Ms"`
	MaxMs   float64 `json:"maxMs"`
}

// Summarize groups entries by command and computes percentile stats.
// Mirrors timing.rs::summarize. Keys are sorted for determinism.
func Summarize(entries []TimingEntry) []PercentileSummary {
	grouped := make(map[string][]float64)
	for _, e := range entries {
		grouped[e.Command] = append(grouped[e.Command], e.DurationMs)
	}

	keys := make([]string, 0, len(grouped))
	for k := range grouped {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]PercentileSummary, 0, len(keys))
	for _, cmd := range keys {
		samples := grouped[cmd]
		if len(samples) == 0 {
			continue
		}
		sort.Float64s(samples)
		n := len(samples)
		pct := func(q float64) float64 {
			idx := int(math64Round(float64(n-1) * q))
			if idx >= n {
				idx = n - 1
			}
			return samples[idx]
		}
		out = append(out, PercentileSummary{
			Command: cmd,
			Count:   uint32(n),
			P50Ms:   pct(0.5),
			P95Ms:   pct(0.95),
			P99Ms:   pct(0.99),
			MaxMs:   samples[n-1],
		})
	}
	return out
}

func math64Round(x float64) float64 {
	if x < 0 {
		return float64(int(x - 0.5))
	}
	return float64(int(x + 0.5))
}

// ---------------------------------------------------------------------------
// TimingService — thin service wrapper
// ---------------------------------------------------------------------------

// CacheStats mirrors timing.rs::CacheStats.
type CacheStats = cache.Stats

// TimingService exposes GetBackendTimings, GetCacheStats, SetCacheCapacity,
// ClearSessionCache. It owns the TimingBuffer and holds a ref to the shared cache.
type TimingService struct {
	buf   *TimingBuffer
	cache *cache.SessionCache
}

// New creates a TimingService with its own ring buffer and the shared cache.
// c is the shared session cache singleton (arch C1).
func New(c *cache.SessionCache) *TimingService {
	return &TimingService{buf: NewTimingBuffer(bufferCapacity), cache: c}
}

// GetBackendTimings returns per-command percentile stats from the ring buffer.
// Mirrors timing.rs::get_backend_timings.
func (s *TimingService) GetBackendTimings(limit *int) ([]PercentileSummary, error) {
	entries := s.buf.Snapshot()
	if limit != nil {
		n := *limit
		if n < len(entries) {
			entries = entries[:n]
		}
	}
	return Summarize(entries), nil
}

// GetCacheStats returns the live cache hit-rate snapshot.
// Mirrors timing.rs::get_cache_stats.
func (s *TimingService) GetCacheStats() (CacheStats, error) {
	return s.cache.GetStats(), nil
}

// SetCacheCapacity hot-resizes the LRU cache.
// Mirrors timing.rs::set_cache_capacity.
func (s *TimingService) SetCacheCapacity(capacity int) error {
	s.cache.SetCapacity(capacity)
	return nil
}

// ClearSessionCache empties the session cache.
// Mirrors timing.rs::clear_session_cache.
func (s *TimingService) ClearSessionCache() error {
	s.cache.Clear()
	return nil
}
