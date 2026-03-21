# Rust Migration Sprints

Roadmap for incrementally porting the Node.js/TypeScript sidecar backend to native Rust Tauri commands, eventually eliminating the sidecar entirely.

## Current Architecture

```
Tauri (Rust shell) → spawns → Bun sidecar (TypeScript HTTP server)
Frontend (React) → HTTP+SSE → Sidecar → file system / ~/.claude/
```

## Target Architecture

```
Tauri (Rust backend) → direct file system access
Frontend (React) → Tauri invoke → Rust commands
```

---

## Sprint 1: File Watching

**Goal**: Replace Node.js `fs.watch` + polling with Rust `notify` crate.

**Current**: `src/main/services/infrastructure/FileWatcher.ts`
- Watches `~/.claude/projects/{path}/*.jsonl` and `~/.claude/todos/*.json`
- 100ms debounce, 30s catch-up scan, supports local and SSH polling modes

**Rust replacement**:
- Use `notify` crate for native filesystem events
- Emit Tauri events (`app.emit("file-change", payload)`) instead of SSE
- Frontend listens via `@tauri-apps/api/event` `listen()`

**Effort**: Small — self-contained service with clear inputs/outputs

---

## Sprint 2: JSONL Parsing

**Goal**: Port session file parsing to Rust using `serde_json`.

**Current**: `src/main/services/parsing/SessionParser.ts`
- Line-by-line JSONL reading with byte offset tracking
- Message classification via `MessageClassifier.ts`

**Rust replacement**:
- `serde_json` for line-by-line parsing
- Return typed structs matching the existing TypeScript types
- Performance win: Rust parsing is 10-100x faster than JS for large JSONL files

**Effort**: Medium — needs type definitions for all message variants

---

## Sprint 3: Project Scanning

**Goal**: Port project directory scanning to Rust.

**Current**: `src/main/services/discovery/ProjectScanner.ts`
- Scans `~/.claude/projects/` for subdirectories
- Path decoding (e.g., `-Users-name-project` → `/Users/name/project`)
- Worktree grouping, session metadata extraction

**Rust replacement**:
- `std::fs` for directory traversal
- Port path encoding/decoding logic

**Effort**: Small-Medium

---

## Sprint 4: Chunk Building

**Goal**: Port conversation chunk building to Rust.

**Current**: `src/main/services/analysis/ChunkBuilder.ts`
- Builds UserChunk, AIChunk, SystemChunk, CompactChunk from parsed messages
- Tool execution linking, subagent detection, semantic step extraction
- Most complex service in the backend

**Rust replacement**:
- Implement chunk building logic in Rust
- Return serialized chunks via Tauri commands

**Effort**: Large — most complex service, many edge cases

---

## Sprint 5: Config Management

**Goal**: Port config read/write to Rust.

**Current**: `src/main/services/infrastructure/ConfigManager.ts`
- Reads/writes `~/.claude/config.json`
- Trigger management, session pin/hide, ignore patterns

**Rust replacement**:
- `serde_json` for config serialization
- File locking for safe concurrent access

**Effort**: Small

---

## Sprint 6: Notification System

**Goal**: Port error detection and notification triggers to Rust.

**Current**:
- `src/main/services/error/ErrorDetector.ts` — per-tool-use token counting
- `src/main/services/error/ErrorTriggerChecker.ts` — pattern matching
- `NotificationManager.ts` — notification storage and lifecycle

**Rust replacement**:
- Tauri notification plugin already handles native OS notifications
- Port detection logic and trigger evaluation

**Effort**: Medium

---

## Sprint 7: SSH Support

**Goal**: Port SSH connections to Rust.

**Current**: `src/main/services/infrastructure/SshConnectionManager.ts`
- Uses `ssh2` npm package for SSH connections
- `SshFileSystemProvider` for remote file access

**Rust replacement**:
- Use `russh` crate for SSH2 protocol
- Implement remote file system provider in Rust

**Effort**: Large — SSH protocol handling, authentication methods

---

## Sprint 8: Remove Sidecar

**Goal**: Delete the sidecar entirely once all services are ported.

**Steps**:
1. Remove `src/main/standalone.ts` and `src/main/http/` directory
2. Remove `vite.sidecar.config.ts`
3. Remove `scripts/bundle-sidecar.js`
4. Remove `src-tauri/sidecar/` directory
5. Remove sidecar lifecycle code from `src-tauri/src/sidecar.rs`
6. Update `TauriAPIClient` to use only `invoke()` (no HTTP)
7. Remove `fastify`, `@fastify/cors`, `@fastify/static` from dependencies
8. Remove `ssh2`, `ssh-config` from dependencies

**Result**: Pure Tauri app with Rust backend, no Node.js/Bun dependency.

---

## Priority Ordering

| Sprint | Impact | Effort | Priority |
|--------|--------|--------|----------|
| 1. File Watching | High (reduces latency) | Small | P0 |
| 5. Config Management | Medium (removes sidecar dep for settings) | Small | P1 |
| 2. JSONL Parsing | High (performance for large sessions) | Medium | P1 |
| 3. Project Scanning | Medium | Small-Medium | P2 |
| 4. Chunk Building | High (core logic) | Large | P2 |
| 6. Notifications | Medium | Medium | P3 |
| 7. SSH Support | Low (niche feature) | Large | P3 |
| 8. Remove Sidecar | High (final cleanup) | Small | Last |
