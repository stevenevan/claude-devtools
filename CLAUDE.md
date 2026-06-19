# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Tauri 2.x desktop app that visualizes Claude Code session execution. Reads raw JSONL session logs from `~/.claude/` and reconstructs the full execution trace.

**Tech Stack:** Tauri 2.x, Rust (backend), React 18, TypeScript 5, Tailwind CSS 4, Zustand 5
**Linting/Formatting:** oxlint, oxfmt
**Package Manager:** Always use `bun` (not npm/yarn/pnpm)

## Commands

```bash
bun install                    # Install dependencies
bun run dev                    # Dev server with hot reload (Tauri + Vite)
bun run build                  # Production build (Tauri)
bun run typecheck              # TypeScript type checking
bun run lint:fix               # Lint and auto-fix (oxlint)
bun run format                 # Format code (oxfmt)
bun run check                  # Full quality gate: types + lint + test + build
bun run quality                # check + format:check + knip (unused exports)

# Tests (Vitest)
bun run test                   # Run all tests
bun run test -- path/to/file.test.ts   # Run single test file
bun run test -- -t "test name"         # Run by test name pattern
bun run test:watch             # Watch mode
bun run test:coverage          # Coverage report
bun run test:coverage:critical # Critical path coverage (65% lines, 75% functions)

# Specialized test scripts (tsx, not vitest)
bun run test:chunks            # Chunk building tests
bun run test:semantic          # Semantic step extraction
bun run test:noise             # Noise filtering tests
bun run test:task-filtering    # Task tool filtering

# Rust (run from src-tauri/)
cargo test                     # Run Rust tests
cargo check                    # Type check Rust code
```

## Path Aliases

- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`

## Data Sources

`~/.claude/projects/{encoded-path}/*.jsonl` — Session files
`~/.claude/todos/{sessionId}.json` — Todo data

Path encoding: `/Users/name/project` → `-Users-name-project`

## Data Pipeline

```
~/.claude/projects/{id}/*.jsonl
  → Rust: session_parser (streaming line-by-line)
  → Rust: entry_parser → ParsedMessage[]
  → Rust: message_classifier → MessageCategory (HardNoise|User|Ai|System|Event|Compact)
  → Rust: chunk_builder (state machine, flushes AI buffer on non-AI messages)
  → Rust: chunk_factory → EnhancedChunk[] (User|AI|System|Compact|Event)
  → Rust: tool_linking, tokenizer, semantic_step_extractor, context_accumulator
  → SessionDetail { chunks, metrics, processes, contextStats }
  → Frontend invoke() via tauriClient.ts (with reviveDates for ISO→Date conversion)
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
// Message type guard (src/renderer/types/data.ts)
isAssistantMessage(msg)           // type: "assistant"
// Message classification (User/System/HardNoise/AI) lives in Rust:
// src-tauri/src/parsing/message_classifier.rs

// Chunk type guard (src/shared/types/chunks/guards.ts)
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
`src/main/services/` and its domain subdirectories have barrel exports via index.ts:
```typescript
// Preferred
import { ChunkBuilder, ProjectScanner } from './services';
// Also valid
import { ChunkBuilder } from './services/analysis';
```
Note: renderer utils/hooks/types do NOT have barrel exports — import directly from files.

### Import Order
1. External packages
2. Path aliases (@renderer, @shared)
3. Relative imports

## Performance
- LRU Cache: Avoids re-parsing large JSONL files (Rust `SessionCache`)
- Streaming JSONL: Line-by-line processing in Rust
- Virtual Scrolling: `@tanstack/react-virtual` for large session/message lists
- Debounced File Watching: 100ms debounce via `notify` crate
- Incremental Detail: `get_session_detail_incremental` skips unchanged sessions

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
