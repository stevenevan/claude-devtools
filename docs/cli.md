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

| Command                                      | Output |
| -------------------------------------------- | ------ |
| `claude-devtools-cli list`                   | Project id + name |
| `claude-devtools-cli sessions <project_id>`  | First 100 sessions for that project |
| `claude-devtools-cli show <project_id> <session_id>` | Chunk/message counts and aggregate token + cost metrics |
| `claude-devtools-cli stats`                  | Project / session / message totals across `~/.claude/projects/` |

Append `--json` to any command for machine-readable output.

```bash
claude-devtools-cli list --json | jq '.[0].id'
```

## Scope notes

Sprint 44 deferred the full Cargo workspace split (architect-reviewer
pre-condition was not met in the autonomous execution). The CLI ships as a
second `[[bin]]` target inside the existing `claude-devtools` crate so it
has zero impact on the Tauri build and a future workspace restructure can
land independently.

## Stability

The CLI consumes `claude_devtools_lib` types directly. Public output types
(`Session`, `SessionDetail`, `ParsedSession`) carry serde serialization;
`--json` mode is the stable interface for downstream tools.
