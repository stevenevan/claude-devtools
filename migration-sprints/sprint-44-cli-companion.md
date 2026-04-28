# Sprint 44 — Week of 2026-11-02 | Extensibility

## External CLI Companion (`claude-devtools-cli`)

### Pre-conditions (blocking)
- Architect-reviewer explicit sign-off on the Cargo workspace split before sprint starts. Split introduces `shared-parsing` crate as workspace member; affects build pipeline for sprints 45–47.

### Deliverables
1. **Cargo workspace restructure** — extract parsing/analytics logic from `src-tauri/src/` into a new `crates/shared-parsing/` workspace member. `src-tauri` depends on it. No behavioral change.
2. **`[workspace.dependencies]` declaration** — unify `tauri`, `serde`, `serde_json`, `chrono`, `tokio`, `tracing` versions at root `Cargo.toml` so `shared-parsing` and `claude-devtools-cli` and `src-tauri` resolve identical versions. Prevents double-compile + version drift (architect directive #7a).
3. **`SessionCache` Tauri-agnostic refactor** — today it uses `tauri::State<Arc<Mutex<SessionCache>>>`. Extract the cache type into `shared-parsing`; `src-tauri` wraps it in a `State` adapter. `SessionCache` itself knows nothing about Tauri (architect directive #7b).
4. **Serde-stable public API** — tag `shared-parsing::api` types (`SessionDetail`, `EnhancedChunk`, `ContextInjection`) with a snapshot test that fails on field add/remove/rename, so CLI consumers are never broken silently (architect directive #7c).
5. **`commands.rs` split** — current 1345 lines, well past cap. Split into thematic submodules (`commands/sessions.rs`, `commands/analytics.rs`, `commands/config.rs`, `commands/ssh.rs`) as part of this workspace reshuffle (architect directive #6).
6. **CLI binary** — new `crates/claude-devtools-cli/` workspace member. Commands: `list`, `show <session>`, `stats --range=7d`, `export <session>`. Text + JSON output modes.
7. **Install path** — `cargo install --path crates/claude-devtools-cli` works.

### Files
- `Cargo.toml` (new workspace at repo root, with `[workspace.dependencies]`)
- `crates/shared-parsing/Cargo.toml` + src (extracted, including `cache.rs` refactor)
- `crates/shared-parsing/tests/api_snapshot.rs` (new — serde stability snapshot test)
- `crates/claude-devtools-cli/Cargo.toml` + `src/main.rs` (new)
- `src-tauri/Cargo.toml` (depend on `shared-parsing` via workspace = true)
- `src-tauri/src/commands.rs` → split into `src-tauri/src/commands/` (new dir) with `sessions.rs`, `analytics.rs`, `config.rs`, `ssh.rs`, `mod.rs`
- `src-tauri/src/lib.rs` (handler registration paths updated)
- `docs/cli.md` (new)

### Dependencies
- No code dependency on other sprints, but blocks sprint 45/46/47 build until workspace compiles green

### Verification
- `cargo build --workspace` all green
- `cargo test -p claude-devtools-cli` all commands exercised
- Manual: `claude-devtools-cli list --json | jq '.[0].id'` outputs valid id
