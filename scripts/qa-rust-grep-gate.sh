#!/usr/bin/env bash
# Enforces W16 Rust safety boundaries. Run from any directory.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASELINE="scripts/qa-rust-root-baseline.txt"
FAIL=0

pass() { printf '  OK: %s\n' "$1"; }
violation() { printf '  VIOLATION: %s\n' "$1"; FAIL=1; }

printf '\n== Gate 1: destructive directory removal ==\n'
# Runtime deletes stay in the maintenance/config-backup/snapshot subsystems.
# The three excluded modules contain only in-module temp-directory test setup.
gate1_hits="$(rg -n '(?:std::)?fs::remove_dir(?:_all)?\(' src-tauri/src --glob '*.rs' \
  -g '!**/*test*.rs' \
  | rg -v '^src-tauri/src/(maintenance|configbackup)/|^src-tauri/src/snapshots\.rs:|^src-tauri/src/system\.rs:|^src-tauri/src/insights/' || true)"
if [ -n "$gate1_hits" ]; then
  while IFS= read -r line; do violation "$line"; done <<< "$gate1_hits"
else
  pass "directory removal confined to maintenance, configbackup, and snapshots"
fi

printf '\n== Gate 2: settings.json writer ==\n'
# Runtime writes use settings_write.rs; the excluded analyzer line is test fixture setup.
gate2_hits="$(rg -n '(?:std::)?fs::(?:write|rename)\([^\n]*settings\.json|settings\.json[^\n]*(?:std::)?fs::(?:write|rename)' src-tauri/src --glob '*.rs' \
  -g '!**/*test*.rs' \
  | rg -v '^src-tauri/src/files/settings_write\.rs:|^src-tauri/src/insights/permissions_analyzer/analyzer\.rs:' || true)"
if [ -n "$gate2_hits" ]; then
  while IFS= read -r line; do violation "$line"; done <<< "$gate2_hits"
else
  pass "settings.json direct writes remain in settings_write.rs"
fi

printf '\n== Gate 3: direct home-directory baseline ==\n'
if [ ! -f "$BASELINE" ]; then
  violation "missing baseline $BASELINE"
else
  current="$(rg -n 'dirs::home_dir\(' src-tauri/src --glob '*.rs' \
    | sed -E 's#^([^:]+):[0-9]+:[[:space:]]*#\1: #' \
    | sort -u)"
  new_sites="$(comm -23 <(printf '%s\n' "$current") <(sort -u "$BASELINE") || true)"
  if [ -n "$new_sites" ]; then
    while IFS= read -r line; do violation "new home-directory use: $line"; done <<< "$new_sites"
  else
    pass "no new dirs::home_dir() uses beyond baseline"
  fi
fi

printf '\n== Result ==\n'
if [ "$FAIL" -ne 0 ]; then
  printf '  FAILED\n'
  exit 1
fi
printf '  PASSED\n'
