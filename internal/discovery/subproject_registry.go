package discovery

// Subproject registry — tracks composite project IDs for multi-cwd projects.
// Mirrors src-tauri/src/discovery/subproject_registry.rs.
//
// When sessions in the same encoded directory have different `cwd` values they
// are split into separate projects with composite IDs: `{encodedPath}::{hash}`.
// The registry is a plain struct with a sync.Mutex — injected by the caller,
// never a package-level singleton.

import (
	"crypto/sha256"
	"fmt"
	"sync"
)

// SubprojectEntry holds the set of session IDs that belong to one subproject.
type SubprojectEntry struct {
	SessionIDs map[string]struct{}
}

// SubprojectRegistry maps composite project IDs to their session-ID sets.
// All exported methods are safe for concurrent use.
type SubprojectRegistry struct {
	mu      sync.Mutex
	entries map[string]*SubprojectEntry
}

// NewSubprojectRegistry returns an initialised, empty registry.
func NewSubprojectRegistry() *SubprojectRegistry {
	return &SubprojectRegistry{
		entries: make(map[string]*SubprojectEntry),
	}
}

// Register records the given sessionIDs under a composite ID derived from
// baseDir and cwd, returning the composite ID.
// Mirrors subproject_registry::SubprojectRegistry::register.
func (r *SubprojectRegistry) Register(baseDir, cwd string, sessionIDs []string) string {
	hash := computeCWDHash(cwd)
	compositeID := fmt.Sprintf("%s::%s", baseDir, hash)

	// nil-safe: a nil registry (the frontend passes null) still returns a valid
	// composite ID, it just doesn't persist the membership.
	if r == nil {
		return compositeID
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	entry, ok := r.entries[compositeID]
	if !ok {
		entry = &SubprojectEntry{SessionIDs: make(map[string]struct{})}
		r.entries[compositeID] = entry
	}
	for _, id := range sessionIDs {
		entry.SessionIDs[id] = struct{}{}
	}
	return compositeID
}

// GetSessionFilter returns the set of session IDs for a composite project ID,
// or nil if the project ID is not composite / not registered.
// Mirrors subproject_registry::SubprojectRegistry::get_session_filter.
func (r *SubprojectRegistry) GetSessionFilter(projectID string) map[string]struct{} {
	if r == nil {
		return nil // no registry → no subproject filter
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	entry, ok := r.entries[projectID]
	if !ok {
		return nil
	}
	return entry.SessionIDs
}

// Clear removes all entries. Mirrors subproject_registry::SubprojectRegistry::clear.
func (r *SubprojectRegistry) Clear() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.entries = make(map[string]*SubprojectEntry)
}

// computeCWDHash returns the first 4 bytes of SHA-256(cwd) as 8 lowercase hex chars.
// Matches the Rust sha2::Sha256 output exactly.
func computeCWDHash(cwd string) string {
	sum := sha256.Sum256([]byte(cwd))
	return fmt.Sprintf("%02x%02x%02x%02x", sum[0], sum[1], sum[2], sum[3])
}
