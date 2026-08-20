# Codex maintenance fixture

This fixture is sanitized and is used to pin the grouped maintenance reader
contract. It is fixture-only and experimental: this repository does not pin a
Codex producer version for `stats-cache.json`, `telemetry/`, or `file-history/`.
Those datasets are used to test bounded parsing and safe projections, not to
claim a stable cross-version schema. Unknown or missing fields must remain
diagnostics or unavailable states until a producer/version contract is pinned.

It reflects the current Codex layout names used by the reader:

- `$CODEX_HOME/stats-cache.json`
- `$CODEX_HOME/telemetry/`
- `$CODEX_HOME/file-history/{session}/{hash}@vN`
- `$CODEX_HOME/shell_snapshots/`

The shell snapshot directory spelling and the snapshot header are taken from
the official Codex source: `codex-rs/core/src/shell_snapshot.rs`.

Primary references:

- [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Codex config source](https://github.com/openai/codex/blob/main/codex-rs/core/src/config/mod.rs)
- [Codex shell snapshot source](https://github.com/openai/codex/blob/main/codex-rs/core/src/shell_snapshot.rs)

The fixture is not a promise that every historical Codex build contains every
dataset. Missing or unsupported datasets remain explicit capability states.

Fixture-to-state cases:

- `stats-cache.json` — valid but producer-unpinned; capability is unsupported.
- `telemetry/fixture.json` — valid but not projected; safe fields stay out of
  the Codex telemetry response.
- `telemetry/malformed.json` — malformed JSON; detail returns a diagnostic.
- `file-history/session-1/not-a-version` — unsafe checkpoint name; it is not a
  versioned checkpoint.
- `shell_snapshots/session-1.sh` — supported header with assignments redacted.
- `shell_snapshots/unsafe.sh` — shell content withheld as unsafe.
