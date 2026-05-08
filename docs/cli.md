# claude-devtools-cli

A read-only command-line companion for inspecting Claude Code session data
without launching the Tauri shell.

## Build

```bash
cd src-tauri
cargo build --release --bin claude-devtools-cli
# binary: src-tauri/target/release/claude-devtools-cli
```

## Subcommands

| Command                                                      | Output |
| ------------------------------------------------------------ | ------ |
| `claude-devtools-cli list-projects`                          | Project id + name |
| `claude-devtools-cli list-sessions <project_id>`             | First 100 sessions for that project |
| `claude-devtools-cli show-session <project_id> <session_id>` | Chunk/message counts and aggregate token + cost metrics |
| `claude-devtools-cli tail <project_id> <session_id>`         | Stream session JSONL (rate-limited) |
| `claude-devtools-cli stats`                                  | Project / session / message totals across `~/.claude/projects/` |

Append `--json` to `list-projects`, `list-sessions`, and `stats` for machine
output. `show-session` uses `--format json|markdown` (defaults to `json`).
Legacy aliases (`list`, `sessions`, `show`) remain accepted for compatibility.

```bash
claude-devtools-cli list-projects --json | jq '.[0].id'
claude-devtools-cli show-session -Users-name-proj abc-1234 --format markdown
claude-devtools-cli tail -Users-name-proj abc-1234 > session.log
```

## Security guards (sprint 53)

- **Path traversal**: `<project_id>` / `<session_id>` are restricted to ASCII
  alphanumerics + `-`, `_`, `.`, `+`. Slashes, backslashes, colons, NUL, and
  control characters are rejected; `.` / `..` are rejected outright; length
  ≤ 200 chars.
- **Symlink containment**: every resolved path is canonicalized and verified to
  remain under `~/.claude/projects/` *after* symlink resolution. A symlink that
  points outside the session root is rejected.
- **Env injection**: `CLAUDE_HOME` and `HOME` overrides are ignored. The home
  directory is resolved once via `dirs::home_dir()`. If no home is resolvable,
  the CLI exits with an error (there is no `/` fallback).
- **`tail` rate limit**: emits ≤ 10 MB/s and ≤ 100 000 lines per invocation, so
  a malicious or noisy session cannot flood downstream pipes.

> **TOCTOU note**: the symlink check happens after canonicalization but before
> open. A race window exists; the CLI is intended for use with files the
> running user owns under their own `~/.claude/` tree.

## Stability

The CLI consumes `claude_devtools_lib` types directly. Public output types
(`Session`, `SessionDetail`, `ParsedSession`) carry serde serialization;
`--json` and `--format json` modes are the stable interface for downstream
tools.
