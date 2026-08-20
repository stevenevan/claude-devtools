#!/usr/bin/env bash
# Local automated release gate. This checklist and docs/release.md are the
# authority until a CI release gate is approved and restored.
# Exits non-zero on any automated failure. Manual signoff remains mandatory.

set -euo pipefail
IFS=$'\n\t'

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

step() {
  echo
  echo "==> $*"
}

run_step() {
  local label="$1"
  shift
  if ! "$@"; then
    fail "$label failed"
  fi
}

# 1. Version consistency
step "Checking version consistency"

cargo_version="$(grep -E '^version = ' src-tauri/Cargo.toml | head -1 | sed -E 's/^version = "(.*)"/\1/')"
pkg_version="$(grep -E '^  "version":' package.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
tauri_version="$(grep -E '^  "version":' src-tauri/tauri.conf.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')"

echo "  src-tauri/Cargo.toml:        $cargo_version"
echo "  package.json:                $pkg_version"
echo "  src-tauri/tauri.conf.json:   $tauri_version"

if [[ "$cargo_version" != "$pkg_version" || "$cargo_version" != "$tauri_version" ]]; then
  fail "version mismatch across manifests"
fi

# 2. cargo audit
step "Running cargo audit"
if ! command -v cargo-audit >/dev/null 2>&1 && ! cargo audit --version >/dev/null 2>&1; then
  fail "cargo-audit not installed. Install: cargo install cargo-audit --locked"
fi
run_step "cargo audit" bash -c 'cd src-tauri && cargo audit --deny warnings'

# 3. bun audit
if ! command -v bun >/dev/null 2>&1; then
  fail "bun not installed"
fi
step "Running root bun audit"
run_step "root bun audit" bun audit --audit-level high
step "Running frontend bun audit"
run_step "frontend bun audit" bash -c 'cd frontend && bun audit --audit-level high'

# 4. cargo deny
step "Running cargo deny check"
if ! command -v cargo-deny >/dev/null 2>&1; then
  fail "cargo-deny not installed. Install: cargo install cargo-deny --locked --version 0.16.4"
fi
run_step "cargo deny" bash -c 'cd src-tauri && cargo deny --manifest-path Cargo.toml --config ../deny.toml check'

# 5. Full project QA. This is the only QA invocation here; it already runs
# typecheck, the frontend suite, the Rust suite, and the Rust safety grep gate.
step "Running project QA once"
run_step "bun run qa" bun run qa

# 6. Production compile without packaging an app bundle.
step "Running production build"
run_step "bun run build" bun run build

# 7. Deterministic fixture benchmark. It must fail on missing roots, manifests,
# unexpected cardinalities, unsupported-state mismatches, operation errors, or
# unavailable peak-RSS measurement.
step "Running deterministic Codex fixture benchmark"
run_step "Codex fixture benchmark" cargo run --release --bin codex-maintenance-bench --manifest-path src-tauri/Cargo.toml -- \
  --codex-root src-tauri/tests/fixtures/codex \
  --app-data-root src-tauri/tests/fixtures/codex-maintenance \
  --expected-manifest src-tauri/tests/fixtures/codex/benchmark-manifest.json

# 8. Diff safety. The Rust safety grep gate is covered by the single QA run
# above; manual dialog, accessibility, and recovery checks are documented in
# docs/release.md and are not claimed here.
step "Checking patch whitespace"
run_step "git diff --check" git diff --check

echo
echo "AUTOMATED CHECKS PASSED"
echo "Complete the manual signoff table in docs/release.md before release."
