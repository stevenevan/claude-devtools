#!/usr/bin/env bash
# Local pre-flight gate. Mirrors .github/workflows/release-audit.yml.
# Exits non-zero on any failure. See docs/release.md.

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
(cd src-tauri && cargo audit --deny warnings)

# 3. bun audit
step "Running bun audit"
if ! command -v bun >/dev/null 2>&1; then
  fail "bun not installed"
fi
bun audit --audit-level high
(cd frontend && bun audit --audit-level high)

# 4. cargo deny
step "Running cargo deny check"
if ! command -v cargo-deny >/dev/null 2>&1; then
  fail "cargo-deny not installed. Install: cargo install cargo-deny --locked --version 0.16.4"
fi
(cd src-tauri && cargo deny --manifest-path Cargo.toml --config ../deny.toml check)

echo
echo "ALL CHECKS PASSED"
