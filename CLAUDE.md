# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Wails v3 (Go) desktop app that visualizes Claude Code session execution. Reads raw JSONL session logs from `~/.claude/` and reconstructs the full execution trace. (Migrated from Tauri 2.x/Rust — see `docs/wails-migration/`.)

**Tech Stack:** Wails v3 (alpha), Go (backend, `internal/`), React 19, TypeScript 5, Tailwind CSS 4, Zustand 5
**Package Manager:** Always use `bun` for the frontend (not npm/yarn/pnpm)

## Commands

```bash
wails3 dev                     # Dev server with hot reload (Wails + Vite); also: bun run dev
wails3 build                   # Production build → bin/claude-devtools; also: bun run build
wails3 generate bindings -ts   # Regenerate TS bindings after changing Go service methods

# Go backend (run from repo root)
go build ./...                 # Build everything
go test ./...                  # Run all Go tests (incl internal/paritytest gate)
go vet ./internal/...          # Static checks

# Read-only CLI (ports bin/cli.rs)
go run ./cmd/cli show-session <projectId> <sessionId> --format json|markdown

# Frontend (run from frontend/)
cd frontend && bunx tsc --noEmit   # Type-check
cd frontend && bun run build       # Production vite build
```

## Layout

- `main.go` — Wails app: registers 10 service structs, creates the window.
- `internal/` — Go backend (one package per domain): `parsing`, `analysis`, `discovery`,
  `analytics`, `insights`, `config`, `notifications`, `ssh`, `snapshots`, `cache`,
  `tokenizer`, `watcher`, `pipeline`, `paritytest`, `domain` (DTOs), + the `*service`
  wrappers Wails binds.
- `cmd/cli/` — read-only Go CLI.
- `frontend/` — the React app (its own `package.json`/`vite.config.ts`); generated bindings
  under `frontend/bindings/claude-devtools/internal/<svc>service/` (gitignored, regenerated).
- `docs/wails-migration/` — migration plan + `_command-inventory.md` (118/118 bound).

## Path Aliases (frontend)

- `@renderer/*` → `frontend/src/renderer/*`
- `@shared/*` → `frontend/src/shared/*`

## Data Sources

`~/.claude/projects/{encoded-path}/*.jsonl` — Session files
`~/.claude/todos/{sessionId}.json` — Todo data

Path encoding: `/Users/name/project` → `-Users-name-project`

## Data Pipeline

```
~/.claude/projects/{id}/*.jsonl
  → Go: parsing.ParseSessionFile (streaming line-by-line → ParsedMessage[])
  → Go: classifier → MessageCategory (HardNoise|User|Ai|System|Event|Compact)
  → Go: analysis.chunk_builder (state machine, flushes AI buffer on non-AI messages)
  → Go: chunk_factory → EnhancedChunk[] (User|AI|System|Compact|Event)
  → Go: tool_execution_builder, semantic_step_extractor, context_accumulator
  → SessionDetail { chunks, metrics, processes }
  → Frontend v3 bindings via tauriClient.ts (reviveDates for ISO→Date conversion)
  → Zustand store (sessionDetailSlice, conversationSlice)
  → aiGroupEnhancer → groupTransformer → displayItemBuilder
  → React components (ChatHistory, AIChatGroup, LinkedToolItem, etc.)
```

## Critical Concepts

### isMeta Flag
- `isMeta: false` = Real user message (creates new UserChunk, starts new turn)
- `isMeta: true` = Internal message (tool results, system-generated, doesn't create chunks)

### Chunk Structure
Independent chunk types for timeline visualization:
- **UserChunk**: Single user message with metrics
- **AIChunk**: All assistant responses with tool executions and spawned subagents
- **SystemChunk**: Command output/system messages
- **CompactChunk**: System metadata/structural messages

Each chunk has: timestamp, duration, metrics (tokens, cost, tools)

### Task/Subagent Filtering
Task tool_use blocks are filtered when a matching subagent Process exists.
Keep orphaned Task calls (no matching subagent) for visibility.

### Agent Teams
Claude Code's "Orchestrate Teams" feature: multiple sessions coordinate as a team.
- **Process.team?** `{ teamName, memberName, memberColor }` — enriched by SubagentResolver from Task call inputs and `teammate_spawned` tool results
- **Teammate messages** arrive as `<teammate-message teammate_id="..." color="..." summary="...">content</teammate-message>` in user messages (isMeta: false). Detected by `isParsedTeammateMessage()` — excluded from UserChunks, rendered as `TeammateMessageItem` cards
- **Session ongoing detection** treats `SendMessage` shutdown_response (approve: true) and its tool_result as ending events, not ongoing activity
- **Display summary** counts distinct teammates (by name) separately from regular subagents
- **Team tools**: TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, TeamDelete — have readable summaries in `toolSummaryHelpers.ts`

### Visible Context Tracking
Tracks what consumes tokens in Claude's context window across 6 categories (discriminated union on `category` field):

| Category | Type | Source |
|----------|------|--------|
| `claude-md` | `ClaudeMdContextInjection` | CLAUDE.md files (global, project, directory) |
| `mentioned-file` | `MentionedFileInjection` | User @-mentioned files |
| `tool-output` | `ToolOutputInjection` | Tool execution results (Read, Bash, etc.) |
| `thinking-text` | `ThinkingTextInjection` | Extended thinking + text output tokens |
| `team-coordination` | `TeamCoordinationInjection` | Team tools (SendMessage, TaskCreate, etc.) |
| `user-message` | `UserMessageInjection` | User prompt text per turn |

- **Types**: `src/renderer/types/contextInjection.ts`
- **Tracker**: `src/renderer/utils/contextTracker.ts` — `computeContextStats()`, `processSessionContextWithPhases()`
- **Context Phases**: Compaction events reset accumulated injections, tracked via `ContextPhaseInfo`
- **Display surfaces**: `ContextBadge` (per-turn popover), `TokenUsageDisplay` (hover breakdown), `SessionContextPanel` (full panel)

## TypeScript Conventions

### Naming
| Category | Convention | Example |
|----------|------------|---------|
| Services/Components | PascalCase | `ProjectScanner.ts` |
| Utilities | camelCase | `pathDecoder.ts` |
| Constants | UPPER_SNAKE_CASE | `PARALLEL_WINDOW_MS` |
| Type Guards | isXxx | `isRealUserMessage()` |
| Builders | buildXxx | `buildChunks()` |
| Getters | getXxx | `getResponses()` |

### Type Guards
```typescript
// Message type guard (frontend/src/renderer/types/data.ts)
isAssistantMessage(msg)           // type: "assistant"
// Message classification (User/System/HardNoise/AI) lives in Go:
// internal/parsing/classifier.go

// Chunk type guard (frontend/src/shared/types/chunks/guards.ts)
isEnhancedAIChunk(chunk)    // AIChunk with semanticSteps

// Context injection type guards (component-scoped in ContextBadge.tsx, not exported)
isClaudeMdInjection(inj)          // category: "claude-md"
isMentionedFileInjection(inj)     // category: "mentioned-file"
isToolOutputInjection(inj)        // category: "tool-output"
isThinkingTextInjection(inj)      // category: "thinking-text"
isTeamCoordinationInjection(inj)  // category: "team-coordination"
isUserMessageInjection(inj)       // category: "user-message"
```

### Barrel Exports
The backend pipeline is Go (`internal/`) — there are no TS service barrels.
On the TS side, import directly from files. The one barrel that must be used is
`@shared/types/api` (deep imports through it are prohibited).

### Import Order
1. External packages
2. Path aliases (@renderer, @shared)
3. Relative imports

## Performance
- LRU Cache: Avoids re-parsing large JSONL files (Go `cache.SessionCache`, golang-lru/v2)
- Streaming JSONL: Line-by-line processing in Go (`bufio.Scanner`, large buffer)
- Virtual Scrolling: `@tanstack/react-virtual` for large session/message lists
- Debounced File Watching: 100ms debounce via `rjeczalik/notify` (recursive FSEvents)
- Incremental Detail: `get_session_detail_incremental` skips unchanged bytes (cache byte-offset)

## Troubleshooting

### Build Issues
```bash
rm -rf dist node_modules
bun install
bun run build
```

### Type Errors
```bash
bun run typecheck
```

### Test Failures
Check for changes in message parsing or chunk building logic.
