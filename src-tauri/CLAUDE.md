# Rust Backend

Tauri 2.x native backend. All session parsing, file watching, and data processing runs here.

## Module Organization

```
src/
├── lib.rs              # Tauri app builder, plugin registration, managed state
├── commands.rs         # Tauri command handlers (~60 commands)
├── cache.rs            # LRU cache for parsed sessions
├── watcher.rs          # File system watcher (notify crate, 100ms debounce)
├── analytics.rs        # Usage analytics aggregation
├── analysis/           # Message → Chunk transformation
├── parsing/            # JSONL → ParsedMessage extraction
├── discovery/          # Project/session discovery and resolution
├── config/             # User config, triggers, bookmarks
├── notifications/      # Notification trigger matching and delivery
├── ssh/                # SSH connection management (russh)
└── types/              # Shared Rust type definitions
```

## Key Modules

### parsing/ — JSONL to structured messages
- `session_parser.rs` — Streaming line-by-line JSONL file reader
- `entry_parser.rs` — Raw JSON → `ParsedMessage` conversion (handles all message roles, content types)
- `message_classifier.rs` — Categorizes into `MessageCategory` (HardNoise, User, Ai, System, Event, Compact)
- `tool_extraction.rs` — Extracts tool_use/tool_result blocks from content arrays
- `metrics.rs` — Computes session-level metrics (tokens, cost, duration)
- `deduplication.rs` — Removes duplicate messages

### analysis/ — Chunks and enrichment
- `chunk_builder.rs` — State machine that groups messages into chunks. Maintains an AI buffer that flushes on non-AI messages
- `chunk_factory.rs` — Creates typed chunks (User, AI, System, Compact, Event) with metrics
- `tool_linking.rs` — Links tool_use blocks to their tool_result by ID
- `tool_execution_builder.rs` — Builds ToolExecution objects from linked pairs
- `semantic_step_extractor.rs` — Extracts reasoning steps from AI responses
- `semantic_step_grouper.rs` — Groups related semantic steps
- `tokenizer.rs` — Token counting via tiktoken-rs
- `context_accumulator.rs` — Computes visible context stats (6 categories)
- `context_tracker/` — Per-turn context injection tracking
- `process_linker.rs` — Links subagent processes to parent chunks

### discovery/ — Finding sessions and projects
- `project_scanner.rs` — Lists projects in `~/.claude/projects/`
- `session_lister.rs` — Paginated session listing with sorting
- `path_decoder.rs` — Encodes/decodes project paths (`/Users/name/project` ↔ `-Users-name-project`)
- `subagent_resolver.rs` — Resolves subagent Process objects from Task tool inputs, enriches with team info
- `subagent_locator.rs` — Finds subagent session files on disk
- `ongoing_detector.rs` — Detects if sessions are still executing
- `subproject_registry.rs` — Tracks subproject sessions (worktrees)
- `content_filter.rs` — Content filtering for search

## State Management

All state managed via `tauri::State<Mutex<T>>` or `tauri::State<Arc<Mutex<T>>>`:
- `WatcherState` — File watcher handles
- `SessionCache` — LRU cache for parsed sessions (Arc<Mutex>)
- `SubprojectRegistry` — Subproject tracking (Arc<Mutex>)
- `ConfigState` — User configuration (Arc<Mutex>)
- `NotificationState` — Notifications
- `SshState` — SSH connections (Arc<tokio::sync::Mutex> for async)

## Command Organization

Commands are registered in `lib.rs` via `tauri::generate_handler![]`. They're spread across:
- `commands.rs` — Session, search, utility commands
- `config/commands.rs` — Config, triggers, bookmarks, tags
- `notifications/commands.rs` — Notification CRUD
- `ssh/commands.rs` — SSH connection management

All commands return `Result<T, String>` using `.map_err(|e| e.to_string())`.

## Frontend Communication

Frontend calls Rust via `invoke('command_name', { params })`. Key pattern:
- Rust serializes dates as ISO-8601 strings
- Frontend `reviveDates()` in `tauriClient.ts` converts them back to `Date` objects
- Events emitted via `app.emit("event-name", payload)` for file changes, notifications

## Testing

```bash
cargo test                 # Run all Rust tests
cargo test test_name       # Run specific test
cargo check                # Type check only
```
