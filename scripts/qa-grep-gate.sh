#!/usr/bin/env bash
# qa-grep-gate.sh — Program-QA grep gate (W32). Mechanically enforces the three
# safety invariants built across the program. Run from the repo root (or any cwd
# — it resolves paths from its own location). Exits non-zero on any violation.
#
# There is no CI runner and no .github/ — `task qa` (Taskfile.yml) is the CI
# surface and invokes this script alongside gofmt/vet/test.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASELINE="scripts/qa-root-baseline.txt"
FAIL=0

section() { printf '\n== %s ==\n' "$1"; }
pass()    { printf '  OK: %s\n' "$1"; }
violation() { printf '  VIOLATION: %s\n' "$1"; FAIL=1; }

# ── Gate 1: os.Remove/os.RemoveAll on user data ────────────────────────────────
# Only internal/maintenance (trash engine) + the app-owned stores
# internal/snapshots + internal/configbackup may remove user/app trees. Temp
# cleanups (*.tmp / *.bak) are always allowed. Anything else is a violation.
section "Gate 1: os.Remove(All) confined to the trash engine + app-owned stores"
gate1_hits="$(grep -rnE 'os\.Remove(All)?\(' internal/ --include='*.go' \
  | grep -v '_test.go' \
  | grep -vE 'internal/(maintenance|snapshots|configbackup)/' \
  | grep -viE 'tmp|\.bak' || true)"
if [ -n "$gate1_hits" ]; then
  printf '%s\n' "$gate1_hits" | while IFS= read -r line; do violation "$line"; done
  FAIL=1
else
  pass "no stray os.Remove/os.RemoveAll on user data (allowlist: maintenance, snapshots, configbackup, *.tmp/*.bak)"
fi

# ── Gate 2: settings.json writes ───────────────────────────────────────────────
# The live ~/.claude/settings.json is written ONLY through settings_write.go's
# MutateSettingsJSON / ReplaceSettingsJSON. Any WriteFile/Rename touching a
# settings.json path elsewhere is a violation.
section "Gate 2: settings.json written only via settings_write.go"
gate2_hits="$(grep -rnE 'os\.(WriteFile|Rename)\(' internal/ --include='*.go' \
  | grep -v '_test.go' \
  | grep 'settings.json' \
  | grep -v 'internal/files/settings_write.go' || true)"
if [ -n "$gate2_hits" ]; then
  printf '%s\n' "$gate2_hits" | while IFS= read -r line; do violation "$line"; done
  FAIL=1
else
  pass "no settings.json write outside MutateSettingsJSON / ReplaceSettingsJSON"
fi

# ── Gate 3: hardcoded claude-root bypasses ─────────────────────────────────────
# ~15 pre-existing filepath.Join(home, ".claude") / os.UserHomeDir sites are a
# documented baseline (a resolver-unification refactor is out of scope). The gate
# fails only on a NEW site beyond the checked-in baseline; new code must resolve
# roots via config.GetClaudeRootInfo().EffectivePath + config.AppDataDir().
section "Gate 3: no NEW hardcoded ~/.claude root bypass (baseline: $BASELINE)"
if [ ! -f "$BASELINE" ]; then
  violation "missing baseline $BASELINE — regenerate it from the current tree"
else
  current="$(grep -rnE 'os\.UserHomeDir|filepath\.Join\([A-Za-z_][A-Za-z0-9_]*, *"\.claude"' internal/ --include='*.go' \
    | grep -v '_test.go' \
    | sed -E 's#^([^:]+):[0-9]+:[[:space:]]*#\1: #' \
    | sort -u)"
  new_sites="$(comm -23 <(printf '%s\n' "$current") <(sort -u "$BASELINE") || true)"
  if [ -n "$new_sites" ]; then
    printf '%s\n' "$new_sites" | while IFS= read -r line; do violation "NEW root bypass: $line"; done
    FAIL=1
  else
    pass "no new hardcoded ~/.claude sites beyond the $(wc -l < "$BASELINE" | tr -d ' ')-line baseline"
  fi
fi

section "Result"
if [ "$FAIL" -ne 0 ]; then
  printf '  FAILED — see violations above\n'
  exit 1
fi
printf '  PASSED — all three gates clean\n'
exit 0
