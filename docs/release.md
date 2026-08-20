# Codex grouped-sprint release gate

Status: **blocked pending manual signoff and environment-limited checks**  
Release owner: `TBD`  
Review date: `2026-08-20`

This document and [`scripts/release-checklist.sh`](../scripts/release-checklist.sh)
are the local release authority until a CI release gate is separately approved and
restored. A passing automated script does not release the app. The manual table
below must be complete, with evidence, before packaging or publishing.

## Automated gate

Run from the repository root:

```bash
bash scripts/release-checklist.sh
```

The script runs these checks in order:

| Check | Acceptance |
| --- | --- |
| Manifest versions | `src-tauri/Cargo.toml`, `package.json`, and `src-tauri/tauri.conf.json` match. |
| Rust dependencies | `cargo audit --deny warnings` and `cargo deny ... check` pass. |
| JavaScript dependencies | Root and `frontend/` `bun audit --audit-level high` pass. |
| Project QA | Exactly one `bun run qa` passes. This covers typecheck, frontend tests, Rust tests, and the Rust safety grep gate. |
| Production compile | `bun run build` passes without packaging an app bundle. |
| Codex benchmark | The deterministic fixture benchmark passes every operation, cardinality, unsupported-state, latency, and peak-RSS threshold. |
| Patch safety | `git diff --check` passes. |

The script does not claim manual dialog behavior, recovery UX, accessibility,
SSH/local-machine scope, or release-owner approval.

The benchmark command can also be run directly:

```bash
cargo run --release --bin codex-maintenance-bench --manifest-path src-tauri/Cargo.toml -- \
  --codex-root src-tauri/tests/fixtures/codex \
  --app-data-root src-tauri/tests/fixtures/codex-maintenance \
  --expected-manifest src-tauri/tests/fixtures/codex/benchmark-manifest.json
```

It measures each operation independently and reports p50, p95, p99, failures,
and peak RSS. The current limits are p95 ≤ 500 ms, p99 ≤ 1,000 ms, and peak RSS
≤ 64 MiB per benchmark process.

## CDX-01–CDX-09 support matrix

The app must show an unavailable or unsupported state instead of falling back to
the other source.

| Roadmap | Surface | Current contract | Release state |
| --- | --- | --- | --- |
| CDX-01 | Source root and isolation | Codex reads use the selected Codex root; source-aware requests and caches are isolated. | Supported; source-switch signoff required. |
| CDX-02 | History, transcripts, task graphs | Bounded, paginated reads with malformed-record diagnostics and source-aware detail calls. | Supported; fixture benchmarked. |
| CDX-03 | Settings discovery | Precedence-aware discovery exposes source files and diagnostics. | Supported; fixture expects 7 sources. |
| CDX-04 | Settings editor | Preview/apply uses validated local targets, revision checks, bounded text, recovery copies, and post-write verification. | Supported by contract; write signoff required. |
| CDX-05 | Instructions and agents | Read/write calls use confined relative paths, revision checks, bounded content, and verified writes. | Supported by contract; write signoff required. |
| CDX-06 | Skills | Inventory and bounded document reads are available; writes use the same constrained text-write path. | Supported by contract; write signoff required. |
| CDX-07 | Plugins and marketplace | Inventory and metadata are read-only; installation or enablement is not exposed as a Codex mutation. | Read-only supported. |
| CDX-08 | MCP and execution policy | Configured/enabled/observed state is inspectable; the app does not execute MCP servers or captured shell commands. | Read-only supported. |
| CDX-09 | Usage | `stats-cache.json` is inspected but metrics are not projected without a pinned producer contract. | Unavailable with `usageSchemaUnsupported`. |
| CDX-09 | Telemetry | Telemetry files are bounded and diagnosed, but raw producer fields are not projected. | Unavailable with `telemetrySchemaUnsupported`. |
| CDX-09 | File history and checkpoints | Codex file-history data is not projected without a pinned producer contract; checkpoint content and origin stay unavailable. | Unavailable with `fileHistorySchemaUnsupported`; no Codex checkpoint mutation. |
| CDX-09 | Shell snapshots | Bounded, redacted reads are allowed; unsafe formats are withheld and nothing is executed. | Read-only supported. |

Codex checkpoint `Save as…` and `Restore to original…` fail closed with:

```text
Codex checkpoint Save as and Restore are unavailable until the producer and origin contracts are pinned
```

Claude checkpoint actions are a separate supported path. They resolve the
original target on the Rust side from trusted session metadata and never accept
an arbitrary renderer path.

## Roots and version assumptions

- The benchmark sets `CODEX_HOME` to the checked-in fixture root and
  `CLAUDE_DEVTOOLS_DIR` to the checked-in app-data fixture. These variables are
  test inputs, not a claim about a live user's data.
- The fixture manifest pins Codex CLI version `0.147.0`. This is the schema and
  fixture assumption for this gate; it is not a runtime upgrade check.
- No check requires real credentials, a live MCP server, network access, or
  shell execution.
- For the live app, record the selected root and producer version with the
  release evidence. Codex configuration is user-local and can be changed by
  environment variables; see the [Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)
  and [configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic).

## Deterministic fixture matrix

The benchmark owns its roots and checks the expected cardinalities in
`benchmark-manifest.json`; it must not scan a live home directory.

| Fixture | Coverage | Expected result |
| --- | --- | --- |
| `src-tauri/tests/fixtures/codex/history.jsonl` and `sessions/` | History, transcript pagination, detail, redacted text | 2 history items, 2 transcript items, 5 detail events. |
| `src-tauri/tests/fixtures/codex/tasks/` | Task graph listing and detail | 1 graph, 2 nodes. |
| `src-tauri/tests/fixtures/codex/config.toml`, `AGENTS.md`, `agents/`, `skills/` | Settings discovery and inventory text | 7 settings sources; bounded detail and write contracts. |
| `src-tauri/tests/fixtures/codex/shell_snapshots/` | Safe and unsafe snapshot handling | 2 snapshots; unsafe content is withheld. |
| `src-tauri/tests/fixtures/codex-maintenance/stats-cache.json` | Usage schema guard | `usageSchemaUnsupported`. |
| `src-tauri/tests/fixtures/codex-maintenance/telemetry/` | Valid and malformed telemetry | 0 projected items; `telemetrySchemaUnsupported`. |
| `src-tauri/tests/fixtures/codex-maintenance/file-history/` | File-history schema guard | 0 projected items; `fileHistorySchemaUnsupported`. |
| `src-tauri/tests/fixtures/codex-maintenance/codex-restore-recovery/` | Recovery-list isolation | 0 Codex recovery copies. |

The expected values are versioned in
[`benchmark-manifest.json`](../src-tauri/tests/fixtures/codex/benchmark-manifest.json).
Change that manifest only when the fixture contract changes and the release
evidence explains why.

## Recovery and write behavior

- Claude `Save as…` writes only to the path selected in the native save dialog.
- Claude `Restore to original…` resolves the original path server-side from the
  session's `trackedFileBackups` map. The renderer receives an opaque recovery
  id and display metadata, not the target path.
- Before a Claude write, the backend creates a private recovery copy, verifies
  its bytes, and performs an atomic conditional write. Checksum, source,
  traversal, symlink, regular-file, and concurrent-target checks fail closed.
  The target is read back after the write; a verification failure names that
  the target may have changed.
- Recovery restore verifies the recovery checksum and the target's expected
  post-write checksum before replacing it. Recovery deletion removes the
  manifest record and private copy.
- Codex checkpoint origin resolution returns no trusted target. Codex Save as
  and Restore are rejected before a write.
- All maintenance writes are local-machine writes, even if an SSH session is
  selected elsewhere in the app.

## Manual release signoff

Complete every applicable row. `TBD`, an empty observation, or missing evidence
keeps the release blocked.

| Owner | Date | macOS version | Operation | Expected result | Observed result | Evidence path |
| --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | Switch Claude/Codex across every route | Source label, data, cache, and unavailable states change together; no cross-source data appears. | TBD | TBD |
| TBD | TBD | TBD | Claude File History `Save as…` | Native dialog opens at the intended folder with the intended name; selected bytes are written locally and verified. | TBD | TBD |
| TBD | TBD | TBD | Claude `Restore to original…` | Backend resolves the trusted origin, creates a recovery copy, confirms the write, and shows the recovery record. | TBD | TBD |
| TBD | TBD | TBD | Cancelled or conflicted Save/Restore | No unintended write occurs; the error names the operation and the safest next action. | TBD | TBD |
| TBD | TBD | TBD | Codex checkpoint `Save as…` and Restore | Controls are unavailable and the backend rejects the mutation before any write. | TBD | TBD |
| TBD | TBD | TBD | Keyboard, screen reader, reduced motion, 200% zoom, narrow window, long content | Focus order, announcements, responsive layout, and static content remain usable. | TBD | TBD |
| TBD | TBD | TBD | Missing, malformed, unreadable, and permission-denied Codex inputs | Each state is explicit, bounded, source-labelled, and does not fall back to Claude. | TBD | TBD |
| TBD | TBD | TBD | Maintenance while an SSH session is connected | Codex and Claude maintenance writes remain on the local machine. | TBD | TBD |

## Current evidence and blockers

Record command output or an artifact path beside each result before release.

| Evidence | Result |
| --- | --- |
| `bash scripts/release-checklist.sh` | Blocked at `cargo audit`: the advisory database lock at `/Users/stevenevan/.cargo/advisory-db..lock` is read-only in this environment. |
| Focused frontend tests | Passed: source selector, maintenance gating, and source-state tests, 8/8. |
| Redaction unit test | Passed: standalone Rust redaction test, 5/5. |
| Rust formatting and patch whitespace | Passed for the changed Rust files and `git diff --check`; pre-existing unrelated formatting is not part of this sprint. |
| Full `bun run qa` | Blocked at TypeScript because the sandbox denies six existing secret-related files; the frontend and Rust suites were not reached. |
| `bun run build` | Blocked by three unresolved imports for the same denied `redactSecrets` and `envSecretMatcher` files. |
| Cargo benchmark/tests | Blocked while downloading `adler2 2.0.1`: `static.crates.io` DNS resolution failed. |
| `graphify update .` | Environment-blocked by the same denied files and filesystem policy; rerun after the checkout is readable. |
| macOS native dialog and recovery flow | Not yet confirmed; this is a release blocker. |

## Rollout and recovery

1. Run the automated gate from a clean checkout and archive its complete output.
2. Complete the manual signoff table on macOS and archive screenshots, screen
   recordings, or test logs at the listed evidence paths.
3. Record the tested Codex root, producer version, app version, OS version, and
   commit in the release artifact.
4. Run `bun run package` only after the automated gate and manual signoff are
   complete.
5. If a regression is found, stop using the affected Codex surface, retain the
   evidence, and return to the last accepted build. Do not enable Codex
   checkpoint writes until its producer and origin contracts are pinned.
6. For a Claude restore concern, preserve the private recovery copy and do not
   retry a conflicted write until the target and checksum are revalidated.

Evidence template:

```text
commit: <git revision>
app version: <version>
codex root: <path or fixture name>
codex producer version: <version or unknown>
macOS: <version>
automated gate output: <artifact path>
manual evidence: <artifact path>
owner/date: <owner> / <date>
```

## References

- [CDX-10 hardening and release evidence](codex-roadmap/codex-10-hardening-release.md)
- [Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)
- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Codex advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)
