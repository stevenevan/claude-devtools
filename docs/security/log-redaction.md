# Log Redaction Policy

Structured JSON logs land in `~/.claude/logs/devtools.YYYY-MM-DD.jsonl`. Because session data contains absolute paths, tool outputs, mentioned file contents, and may pass tokens through callers, the logging layer applies defense-in-depth redaction before bytes hit disk.

## Defaults

- **Rotation:** daily, via `tracing-appender::rolling::daily`. Each day's file rolls automatically.
- **Per-file size cap:** 50 MB. On startup any existing managed log file ≥ this cap is removed.
- **Retention:** 7 days. Files older than the cutoff are deleted on startup.
- **Filter:** `RUST_LOG`-style filter via `CLAUDE_DEVTOOLS_LOG` env var. Defaults to `info`.

## Instrumentation Convention

When you add `#[tracing::instrument]` to any function, **always use `skip_all`** plus an explicit `fields(...)` list. Never accept the default field auto-capture — that captures every function argument by `Debug` and is the primary leak path.

```rust
#[tracing::instrument(skip_all, fields(session_id = %id))]
fn parse_session(id: &str, path: &Path) -> Result<Session> {
    // ...
}
```

Allowed field types in `fields(...)`:

- Opaque IDs (`session_id`, `chunk_id`, `tool_use_id`) — record as `%value`.
- Byte counts / counts (`len`, `byte_len`, `chunk_count`).
- `Redact<Path>` wrappers (renders `~/.../{tail-segment}` only).
- Enum tags / discriminants.

Disallowed:

- Raw `&Path` / `&PathBuf` (use `Redact`).
- Tool output bodies — log `byte_len` instead of the body.
- File contents from `Read` / `Bash` results.
- `error.cause` chains that might wrap user content.

## `Redact<Path>` Newtype

```rust
use crate::logging::Redact;
let p = Path::new("/Users/jane/Documents/secret.jsonl");
tracing::info!(target: "parse", session_path = %Redact(p));
// → logs `~/.../secret.jsonl`
```

`Redact<Path>` strips every component except the filename tail. If a directory path is passed (no filename), it renders `~/.../<unknown>`.

## Stream-Level Token Redaction

A final `RedactingWriter` wraps the rolling appender. Each write is scanned for known token shapes before flush. Patterns covered:

- OpenAI API keys: `sk-[A-Za-z0-9_-]{16,}`
- GitHub personal / server tokens: `gh[ps]_[A-Za-z0-9]{30,}`
- JWTs (header.payload.signature, ≥10 chars per segment)

Matches are replaced with `<REDACTED>`. This is **best-effort defense in depth**, not the primary control — primary control is the instrumentation convention above. Tokens that straddle a write boundary may be only partially redacted; do not rely on the byte-stream layer.

## Tool Output Bodies

When logging that a tool produced output, log the byte length only:

```rust
tracing::debug!(
    target: "tool_output",
    tool = %tool_name,
    byte_len = body.len(),
    "captured tool output"
);
```

Never `tracing::debug!("body = {body}")`.

## ErrorBoundary Payload (Frontend, Sprint 77)

Renderer-side `ErrorBoundary` calls `logger.error({ ... })`. The payload is shape-controlled:

- `component`: string component name.
- `error_message_redacted`: truncated to 200 chars, paths replaced via `Redact` equivalent.
- `component_stack_top_N`: capped at 10 frames.
- **`error.cause` is excluded** — it can wrap user data via `JSON.parse` of session bytes.

## Adding a New Token Pattern

1. Add the `Regex::new(...)` line to `TOKEN_PATTERNS` in `src-tauri/src/logging/redact.rs`.
2. Add a test in the same file asserting the pattern matches a representative sample.
3. Test against `redact_tokens(...)` to verify it produces `<REDACTED>`.
4. Open a PR; security review required for any pattern that loosens an existing one.

## Verification

`cargo test -p claude-devtools logging::` runs the redaction unit tests, including:

- OpenAI / GitHub / JWT token replacement.
- `Redact<Path>` displays only the tail segment.
- `RedactingWriter` strips tokens through the write boundary.
- End-to-end `tracing::error!` emits a JSON line with the token replaced by `<REDACTED>`.
