# Sprint 42 — Week of 2026-10-19 | Extensibility

## Terminal Output Parser for Bash Blocks

### Deliverables
1. **ANSI parser** — strip/convert ANSI escape sequences in Bash tool_result outputs; preserve colour via React spans with CSS-var mapping.
2. **Progress-bar detection** — collapse repeating `\r` updates into a single final bar (saves scroll space and tokens in display).
3. `BashOutputViewer.tsx` — renderer used when tool = Bash.

### Files
- `src/shared/utils/ansiParser.ts` (new)
- `src/renderer/components/chat/viewers/BashOutputViewer.tsx` (new)
- `src/renderer/components/chat/items/` (wire viewer where tool result renders)
- `src/renderer/components/chat/markdownComponents.tsx` (non-Bash fallback unchanged)

### Dependencies
- Existing viewers directory

### Context alignment
Token accounting in `contextTracker` must use the **pre-collapse** tool_result text so renderer-side collapse does not diverge from Rust tokenizer counts (architect directive #11).

### Verification
- Unit test: input `\x1b[31mERROR\x1b[0m ok` → `<span style="color:var(--ansi-red)">ERROR</span> ok`
- Unit test: `loading 10%\rloading 20%\rloading 100%\n` collapses to `loading 100%`
- Manual: `cargo build` output colours match terminal
