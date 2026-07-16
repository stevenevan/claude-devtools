// Package cache: an LRU cache with TTL + a coarse
// byte-budget ceiling for parsed session data, plus per-session incremental
// parse state. The cache owns its mutex internally; callers never lock it
// (arch C1). Layering: imports only domain + parsing, never pipeline/analysis/
// any service (arch H1) — enforced by import_test.go.
package cache

import (
	"strings"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2/simplelru"

	"claude-devtools/internal/domain"
	"claude-devtools/internal/parsing"
)

// MaxCacheBytes is the hard memory budget for the whole session cache
// (cache.rs:18). When the byte estimate exceeds it, oldest entries are evicted
// from the LRU tail until back under budget.
const MaxCacheBytes = 200 * 1024 * 1024

const (
	bytesPerMessageEstimate = 2048
	baseSessionBytes        = 4096
	defaultCapacity         = 50
	defaultTTL              = 600 * time.Second
	minMaxBytes             = 1024 * 1024
)

func estimateSessionBytes(v domain.ParsedSession) int {
	return baseSessionBytes + len(v.Messages)*bytesPerMessageEstimate
}

func saturatingSub(a, b int) int {
	if b > a {
		return 0
	}
	return a - b
}

type cacheEntry struct {
	value        domain.ParsedSession
	insertedAt   time.Time
	byteEstimate int
}

// IncrementalState tracks incremental parsing state for a session file
// (cache.rs:35).
type IncrementalState struct {
	// ByteOffset is the byte offset of the last successfully parsed position.
	ByteOffset uint64
	// Metadata is the accumulated metadata from all lines parsed so far.
	Metadata parsing.SessionFileMetadata
}

// Stats is the snapshot read by TimingService.get_cache_stats (timing.rs:149).
type Stats struct {
	Capacity int     `json:"capacity"`
	Size     int     `json:"size"`
	Hits     uint64  `json:"hits"`
	Misses   uint64  `json:"misses"`
	Evicts   uint64  `json:"evicts"`
	HitRate  float64 `json:"hitRate"`
}

// SessionCache is goroutine-safe; every method takes the internal mutex.
type SessionCache struct {
	mu          sync.Mutex
	inner       *lru.LRU[string, *cacheEntry]
	capacity    int // simplelru has no Cap() accessor; track it ourselves
	ttl         time.Duration
	incremental map[string]IncrementalState

	hits         uint64
	misses       uint64
	evicts       uint64
	budgetEvicts uint64

	totalByteEstimate int
	maxBytes          int
}

// New mirrors SessionCache::new (cache.rs:60); capacity < 1 falls back to 50.
func New(capacity int, ttl time.Duration) *SessionCache {
	if capacity < 1 {
		capacity = defaultCapacity
	}
	// nil onEvict: byte accounting is done manually (as in Rust) so set_capacity's
	// auto-eviction does NOT decrement the estimate — matching cache.rs exactly.
	inner, _ := lru.NewLRU[string, *cacheEntry](capacity, nil)
	return &SessionCache{
		inner:       inner,
		capacity:    capacity,
		ttl:         ttl,
		incremental: make(map[string]IncrementalState),
		maxBytes:    MaxCacheBytes,
	}
}

// Default mirrors SessionCache::default (cache.rs:216): 50 entries, 10 min TTL.
func Default() *SessionCache { return New(defaultCapacity, defaultTTL) }

func (c *SessionCache) TotalByteEstimate() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.totalByteEstimate
}

func (c *SessionCache) MaxBytes() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.maxBytes
}

func (c *SessionCache) BudgetEvicts() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.budgetEvicts
}

// SetMaxBytes clamps to a 1 MB floor then re-enforces immediately (cache.rs:82).
func (c *SessionCache) SetMaxBytes(bytes int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if bytes < minMaxBytes {
		bytes = minMaxBytes
	}
	c.maxBytes = bytes
	c.enforceByteBudget()
}

// enforceByteBudget evicts from the LRU tail while over budget. Caller holds mu.
func (c *SessionCache) enforceByteBudget() {
	for c.totalByteEstimate > c.maxBytes && c.inner.Len() > 0 {
		_, evicted, ok := c.inner.RemoveOldest()
		if !ok {
			break
		}
		c.totalByteEstimate = saturatingSub(c.totalByteEstimate, evicted.byteEstimate)
		c.budgetEvicts++
	}
}

// Get returns the cached session and true on a live hit; expired entries are
// evicted and counted as a miss (cache.rs:100).
func (c *SessionCache) Get(key string) (domain.ParsedSession, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.inner.Get(key)
	if !ok {
		c.misses++
		return domain.ParsedSession{}, false
	}
	if time.Since(entry.insertedAt) > c.ttl {
		c.inner.Remove(key)
		c.totalByteEstimate = saturatingSub(c.totalByteEstimate, entry.byteEstimate)
		c.evicts++
		c.misses++
		return domain.ParsedSession{}, false
	}
	c.hits++
	return entry.value, true
}

// Insert stores a session, replacing any prior entry for the key (cache.rs:122).
func (c *SessionCache) Insert(key string, value domain.ParsedSession) {
	c.mu.Lock()
	defer c.mu.Unlock()
	wasFull := c.inner.Len() == c.capacity
	byteEstimate := estimateSessionBytes(value)
	prior, hadPrior := c.inner.Peek(key)
	c.inner.Remove(key) // pop the prior entry, mirroring lru::pop
	if hadPrior {
		c.totalByteEstimate = saturatingSub(c.totalByteEstimate, prior.byteEstimate)
	}
	c.totalByteEstimate += byteEstimate
	c.inner.Add(key, &cacheEntry{value: value, insertedAt: time.Now(), byteEstimate: byteEstimate})
	if wasFull && !hadPrior {
		c.evicts++
	}
	c.enforceByteBudget()
}

// SetCapacity hot-resizes; entries beyond the new bound are evicted from the
// LRU tail (cache.rs:146). Byte estimate is intentionally NOT adjusted here, to
// match the Rust behavior exactly.
func (c *SessionCache) SetCapacity(capacity int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if capacity < 1 {
		capacity = 1
	}
	prior := c.inner.Len()
	c.inner.Resize(capacity)
	c.capacity = capacity
	newLen := c.inner.Len()
	if prior > newLen {
		c.evicts += uint64(prior - newLen)
	}
}

func (c *SessionCache) Capacity() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.capacity
}

func (c *SessionCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.inner.Len()
}

// Clear empties the cache + incremental state (cache.rs:164).
func (c *SessionCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.evicts += uint64(c.inner.Len())
	c.inner.Purge()
	c.incremental = make(map[string]IncrementalState)
	c.totalByteEstimate = 0
}

// GetStats returns the live hit-rate snapshot (timing.rs:149).
func (c *SessionCache) GetStats() Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	total := c.hits + c.misses
	hitRate := 0.0
	if total != 0 {
		hitRate = float64(c.hits) / float64(total)
	}
	return Stats{
		Capacity: c.capacity,
		Size:     c.inner.Len(),
		Hits:     c.hits,
		Misses:   c.misses,
		Evicts:   c.evicts,
		HitRate:  hitRate,
	}
}

func (c *SessionCache) GetIncremental(key string) (IncrementalState, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	s, ok := c.incremental[key]
	return s, ok
}

func (c *SessionCache) SetIncremental(key string, state IncrementalState) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.incremental[key] = state
}

func (c *SessionCache) RemoveIncremental(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.incremental, key)
}

// Invalidate removes a single entry + its incremental state (cache.rs:187).
func (c *SessionCache) Invalidate(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry, ok := c.inner.Peek(key); ok {
		c.inner.Remove(key)
		c.totalByteEstimate = saturatingSub(c.totalByteEstimate, entry.byteEstimate)
	}
	delete(c.incremental, key)
}

// InvalidateProject removes every entry whose key is prefixed "<projectID>/"
// plus their incremental state (cache.rs:196).
func (c *SessionCache) InvalidateProject(projectID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	prefix := projectID + "/"
	var toRemove []string
	for _, k := range c.inner.Keys() {
		if strings.HasPrefix(k, prefix) {
			toRemove = append(toRemove, k)
		}
	}
	for _, k := range toRemove {
		if entry, ok := c.inner.Peek(k); ok {
			c.inner.Remove(k)
			c.totalByteEstimate = saturatingSub(c.totalByteEstimate, entry.byteEstimate)
		}
		delete(c.incremental, k)
	}
}
