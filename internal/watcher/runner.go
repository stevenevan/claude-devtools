package watcher

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rjeczalik/notify"
)

const (
	// debounceDuration matches Rust DEBOUNCE_MS = 100.
	debounceDuration = 100 * time.Millisecond
	// retryInterval matches Rust WATCHER_RETRY_MS = 2000.
	retryInterval = 2 * time.Second
	// channelBuf is the notify channel buffer. FSEvents on macOS can burst
	// events; 1000 prevents drops on large project directories.
	channelBuf = 1000
)

// pendingItem tracks one in-flight debounce timer for a given path.
type pendingItem struct {
	timer *time.Timer
	kind  string // last observed change kind for this path
	id    uint64 // monotone ID — allows the timer closure to detect supersession
}

// Runner manages recursive filesystem watches on projectsDir and todosDir.
//
// Layering rule: no Wails import here. The caller (SystemService) injects
// emitFn which calls application.Get().Event.Emit with nil-guard.
type Runner struct {
	projectsDir string
	todosDir    string
	emitFn      func(event string, payload any)

	mu      sync.Mutex
	pending map[string]*pendingItem
	idGen   uint64

	ch     chan notify.EventInfo
	stopCh chan struct{}
	wg     sync.WaitGroup
	running bool
}

// New creates a Runner. emitFn is always invoked outside all locks.
// The caller should pass real (symlink-resolved) paths so that event paths from
// FSEvents match the prefix checks in processEvent.
func New(projectsDir, todosDir string, emitFn func(event string, payload any)) *Runner {
	return &Runner{
		projectsDir: projectsDir,
		todosDir:    todosDir,
		emitFn:      emitFn,
		pending:     make(map[string]*pendingItem),
	}
}

// Start begins watching projectsDir (recursive) and todosDir (non-recursive).
// Idempotent. Returns nil if already running or if watchers are set up
// successfully. Missing directories are retried every 2 s.
func (r *Runner) Start() error {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return nil
	}
	r.ch = make(chan notify.EventInfo, channelBuf)
	r.stopCh = make(chan struct{})
	r.running = true
	r.mu.Unlock()

	needProjectsRetry := !r.watchProjects()
	needTodosRetry := !r.watchTodos()

	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		r.drain()
	}()

	if needProjectsRetry || needTodosRetry {
		r.wg.Add(1)
		go func() {
			defer r.wg.Done()
			r.retryWatch(needProjectsRetry, needTodosRetry)
		}()
	}

	return nil
}

// Stop halts all watching and waits for goroutines to exit. Safe to call
// multiple times. Matches Rust stop_watcher (drops debouncer, sets watching=false).
func (r *Runner) Stop() {
	r.mu.Lock()
	if !r.running {
		r.mu.Unlock()
		return
	}
	r.running = false
	for _, item := range r.pending {
		item.timer.Stop()
	}
	r.pending = make(map[string]*pendingItem)
	close(r.stopCh)
	r.mu.Unlock()

	// Wait for goroutines to observe stopCh, then remove watchpoints.
	// Order matters: wg.Wait() first, then notify.Stop(), so retryWatch cannot
	// call notify.Watch after we remove all watchpoints.
	r.wg.Wait()
	notify.Stop(r.ch)
	slog.Info("watcher: stopped")
}

// watchProjects registers a recursive watch on projectsDir.
// Returns true when the watch is established.
func (r *Runner) watchProjects() bool {
	if _, err := os.Stat(r.projectsDir); err != nil {
		slog.Warn("watcher: projects dir missing, will retry", "path", r.projectsDir)
		return false
	}
	recPath := filepath.Join(r.projectsDir, "...")
	if err := notify.Watch(recPath, r.ch, notify.All); err != nil {
		slog.Warn("watcher: cannot watch projects", "err", err)
		return false
	}
	slog.Info("watcher: watching projects", "path", r.projectsDir)
	return true
}

// watchTodos registers a non-recursive watch on todosDir.
// Returns true when the watch is established.
func (r *Runner) watchTodos() bool {
	if _, err := os.Stat(r.todosDir); err != nil {
		slog.Warn("watcher: todos dir missing, will retry", "path", r.todosDir)
		return false
	}
	if err := notify.Watch(r.todosDir, r.ch, notify.All); err != nil {
		slog.Warn("watcher: cannot watch todos", "err", err)
		return false
	}
	slog.Info("watcher: watching todos", "path", r.todosDir)
	return true
}

// drain reads events from the notify channel until stopCh is closed.
// recover() at the goroutine boundary: a panic cannot crash the application.
func (r *Runner) drain() {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("watcher: drain panic", "recover", fmt.Sprint(rec))
		}
	}()
	for {
		select {
		case <-r.stopCh:
			return
		case ei, ok := <-r.ch:
			if !ok {
				return
			}
			r.schedule(ei)
		}
	}
}

// retryWatch polls every 2 s for directories that were missing at Start time.
// Matches Rust retry_watch. recover() guards against panics.
func (r *Runner) retryWatch(needProjects, needTodos bool) {
	defer func() { recover() }() //nolint:errcheck // panic guard only
	ticker := time.NewTicker(retryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.stopCh:
			return
		case <-ticker.C:
		}
		// Check running under mutex before calling notify.Watch.
		r.mu.Lock()
		running := r.running
		r.mu.Unlock()
		if !running {
			return
		}
		if needProjects && r.watchProjects() {
			needProjects = false
		}
		if needTodos && r.watchTodos() {
			needTodos = false
		}
		if !needProjects && !needTodos {
			return
		}
	}
}

// schedule debounces an event: path-keyed, coalescing bursts within 100 ms.
//
// Lock discipline: r.mu is held while mutating pending. The timer closure's
// first action is r.mu.Lock(), so stopping an old timer while holding the lock
// guarantees the old closure finds the new item (via id check) and bails.
// emitFn is called outside all locks (no mutex held across emit).
func (r *Runner) schedule(ei notify.EventInfo) {
	path := ei.Path()
	kind, ok := MapEventKind(ei.Event())
	if !ok {
		return
	}

	// Capture immutable fields for the closure — avoids reading r fields
	// after the mutex is released.
	pDir := r.projectsDir
	tDir := r.todosDir

	r.mu.Lock()
	if existing, exists := r.pending[path]; exists {
		// Stop while holding lock: if the old timer func is queued to run,
		// it is blocked at r.mu.Lock() inside the func. We replace pending[path]
		// below, so the old func finds id mismatch and returns without emitting.
		existing.timer.Stop()
	}
	r.idGen++
	myID := r.idGen
	item := &pendingItem{kind: kind, id: myID}
	r.pending[path] = item
	item.timer = time.AfterFunc(debounceDuration, func() {
		r.mu.Lock()
		cur, ok := r.pending[path]
		if !ok || cur.id != myID {
			r.mu.Unlock()
			return // superseded by a newer event for this path
		}
		actualKind := cur.kind
		delete(r.pending, path)
		r.mu.Unlock()
		// Emit outside all locks.
		r.processEvent(path, actualKind, pDir, tDir)
	})
	r.mu.Unlock()
}

// processEvent classifies a debounced event and invokes emitFn.
// Called outside all locks.
func (r *Runner) processEvent(path, kind, projectsDir, todosDir string) {
	if isUnder(projectsDir, path) {
		if evt := ParseProjectFile(projectsDir, path, kind); evt != nil {
			r.emitFn("file-change", evt)
		}
	} else if isUnder(todosDir, path) {
		if evt := ParseTodoFile(todosDir, path, kind); evt != nil {
			r.emitFn("todo-change", evt)
		}
	}
}

// isUnder reports whether child is strictly inside parent (not the parent itself).
func isUnder(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != "." && !strings.HasPrefix(rel, "..")
}
