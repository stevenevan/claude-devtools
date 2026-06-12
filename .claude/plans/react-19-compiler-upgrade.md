# Plan: Upgrade React 18 → 19 + Add React Compiler

## Context

The app currently runs React 18.3.1 with `@vitejs/plugin-react@6.0.2` on Vite 8 (Rolldown). The project's React conventions (`.claude/rules/react.md`) explicitly **ban manual `useCallback`/`React.memo`** — making React Compiler (auto-memoization) a natural fit. This upgrade does two things, in order:

1. Upgrade `react` + `react-dom` (and their `@types`) from 18 → 19.
2. Add `babel-plugin-react-compiler` (v1.0, stable since 2025-10) wired into the Vite build.

**Why this order:** React Compiler's runtime (`react/compiler-runtime`) ships **inside React 19**. Doing 19 first means the compiler can target the built-in runtime (no `react-compiler-runtime` polyfill), and it isolates failures (a broken typecheck after step 1 is a 19 problem; a broken build after step 2 is a compiler problem).

## Current-State Facts (verified)

- `src/renderer/main.tsx` already uses `ReactDOM.createRoot(...).render(<StrictMode>)` → **no entry-point change needed** (createRoot is the React 18+ API, unchanged in 19).
- **17 files use the bare global `JSX.` namespace** (e.g. `): JSX.Element =>`). React 19's `@types/react` removed the global `JSX` namespace; it now lives at `React.JSX`. These break `tsc --noEmit`. Full list in step 2.
- Most components already use `React.JSX.Element` (correct, unaffected).
- One `forwardRef` (`src/renderer/components/ui/button.tsx`) — **still valid in React 19** (ref-as-prop is additive, `forwardRef` not removed). No change required.
- `React.cloneElement(children, { searchQuery })` in `GlobalContentView.tsx` and `React.Children.map` in `pathHighlighting.tsx` — valid in 19.
- No `ReactDOM.render`, `findDOMNode`, string refs, `propTypes`, or `defaultProps`-on-function-components (all removed in 19). **Codebase is clean of removed APIs.**
- `@testing-library/react@16.3.2` already supports React 19 (v16 targets React 18+19). No bump required, but re-verify after install.
- Linting is **oxlint**, not ESLint → the official `eslint-plugin-react-hooks` compiler rule is **not applicable**; skip it. `.oxlintrc.json` has `settings.react.version: "18"` → bump to `"19"`.

## Changes

### Step 1 — Upgrade React to 19

Update `package.json` dependency versions, then `bun install`:

```jsonc
// dependencies
"react": "^19.2.0",
"react-dom": "^19.2.0",
// devDependencies
"@types/react": "^19.2.0",
"@types/react-dom": "^19.2.0",
```

(Use `bun add react@^19 react-dom@^19` and `bun add -d @types/react@^19 @types/react-dom@^19` so the lockfile resolves transitive peers.)

**Verify after install:**
- `bun install` completes with **no unmet peer-dependency errors**. Watch these React-consuming libs specifically — all advertise React 19 support at current versions, but confirm no install warnings: `@base-ui/react`, `recharts@3`, `react-markdown@10`, `react-day-picker@9`, `vaul`, `cmdk`, `react-resizable-panels@4`, `sonner`, `@tanstack/react-virtual@3`, `@dnd-kit/*`, `lucide-react`, `@remixicon/react`. **If any peer conflict appears, stop and report it** — do not force-resolve.

### Step 2 — Fix `@types/react@19` type breaks

Rewrite the bare global `JSX.` namespace to `React.JSX.` in these **17 files**:

```
src/renderer/contexts/TabUIContext.tsx
src/renderer/components/settings/sections/ConnectionSection/SavedProfiles.tsx
src/renderer/components/settings/sections/ConnectionSection/ConnectionStatus.tsx
src/renderer/components/settings/sections/ConnectionSection/SshConnectionForm.tsx
src/renderer/components/chat/ChatHistoryVirtualizer.tsx
src/renderer/components/chat/ChatHistoryLoadingState.tsx
src/renderer/components/chat/ChatHistoryItem.tsx
src/renderer/components/chat/ChatHistoryEmptyState.tsx
src/renderer/components/chat/ChatHistory/ChatHistoryToolbar.tsx
src/renderer/components/chat/ChatHistory/index.tsx
src/renderer/components/chat/ChatHistory/SessionTitleHeader.tsx
src/renderer/components/chat/ChatHistory/ChatHistorySidePanels.tsx
src/renderer/components/chat/ChatHistory/ScrollToBottomButton.tsx
src/renderer/components/chat/items/SubagentItem/ShutdownOnlyRow.tsx
src/renderer/components/chat/items/SubagentItem/ContextUsageRows.tsx
src/renderer/components/search/CommandPalette/ProjectResults.tsx
src/renderer/components/search/CommandPalette/SessionResults.tsx
```

Change is mechanical: `JSX.Element` → `React.JSX.Element` (each of these files already imports `React`, since they reference `React.JSX` is the same module — **confirm each file has `import React from 'react'` or a `React` import; add it only if `tsc` reports `React` undefined**). Do **not** mass-rewrite `React.JSX.Element` occurrences (already correct).

**Verify:** `bun run typecheck` passes (0 errors). This is the gate for step 1 completeness.

### Step 3 — Bump oxlint React version setting

In `.oxlintrc.json`:

```jsonc
"settings": { "react": { "version": "19" } }
```

**Verify:** `bun run lint` passes.

### Step 4 — Install React Compiler

```bash
bun add -d --exact babel-plugin-react-compiler@latest
```

(Official guidance pins the compiler exactly. v1.0 default `target` is `'19'`, so no `target` option needed once on React 19.)

### Step 5 — Wire compiler into Vite

`vite.config.ts` uses `@vitejs/plugin-react@6.0.2`. **Two documented wiring paths exist for plugin-react v6 — pick one during implementation by testing which builds cleanly:**

**Path A (inline babel option — simplest, try first):**
```ts
react({
  babel: {
    plugins: [['babel-plugin-react-compiler', {}]],
  },
}),
```

**Path B (official v6+ preset — fallback if Path A doesn't run the compiler under Rolldown):**
```ts
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel' // requires: bun add -d @rolldown/plugin-babel
// ...
plugins: [
  tailwindcss(),
  react(),
  babel({ presets: [reactCompilerPreset()] }),
  process.env.ANALYZE === 'true' && analyzer(),
].filter(Boolean),
```

**Decision rule:** Implement Path A first. **Confirm the compiler actually ran** before accepting it (see verification below). Only if Path A produces a build with no compiler output do we switch to Path B. Document which path was used in the Review Trail.

### Step 6 — Confirm compiler is actually compiling

Compiler bail-outs are silent by default (`panicThreshold: 'none'`), so "build passed" ≠ "compiler ran". Confirm with **one** of:
- Temporarily add a `logger.logEvent` to the compiler options that `console.log`s `CompileSuccess` events during `bun run build:frontend`, observe ≥1 success, then remove the logger.
- OR run the dev server and confirm React DevTools shows the compiler "✨ (Memo)" badge on compiled components.

This is a **mandatory** verification — without it, the compiler may be installed but inert.

## Implementation Order

1. Step 1: bump React deps → `bun install` → check peers.
2. Step 2: fix 17 JSX-namespace files → `bun run typecheck` green.
3. Step 3: oxlint version bump → `bun run lint` green.
4. Step 4: install compiler.
5. Step 5: wire compiler (Path A first).
6. Step 6: prove compiler ran.
7. Final: full `bun run check` (typecheck + lint + test + build:frontend).

## Verification Steps (final gate)

- [ ] `bun install` — no peer-dependency errors
- [ ] `bun run typecheck` — 0 errors
- [ ] `bun run lint` — passes
- [ ] `bun run test` — all vitest tests pass (testing-library @ React 19)
- [ ] `bun run build:frontend` — production build succeeds
- [ ] Compiler proof: ≥1 `CompileSuccess` logged OR DevTools Memo badge visible
- [ ] Manual smoke (optional): `bun run dev`, app renders, no console errors / hook-order warnings

## Out of Scope (explicit — do not do)

- **No** removal of existing `useMemo`/`useCallback`/`React.memo` (253 occurrences). Compiler is additive; manual memo stays. Mass-removal is a separate future task.
- **No** migration of `forwardRef` → ref-as-prop (works as-is in 19).
- **No** adoption of new React 19 APIs (`use`, Actions, `useOptimistic`, `useFormStatus`, `ref` cleanup functions) — not requested.
- **No** ESLint react-compiler rule (project is oxlint-only).
- **No** Rust/Tauri-side changes.

## Rollback

Single-commit-per-logical-step. If compiler causes runtime issues, removing the `babel`/compiler block from `vite.config.ts` + uninstalling `babel-plugin-react-compiler` fully reverts compiler behavior without touching the React 19 upgrade.

## Review Trail

### Metis Plan Consultant
- (pending)

### Architect Reviewer
- (pending)

### Momus Plan Reviewer
- (pending)
