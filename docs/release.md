# Release Runbook

Release process for `claude-devtools` desktop builds (macOS, Windows,
Linux). Covers the pre-flight gate, exact-version pin policy, per-OS
signing/notarization runbooks, and supply-chain audits.

## Pre-flight Gate

Before cutting a release branch (`release/<version>`) or tagging
(`v<version>`):

1. **Version consistency** — `src-tauri/Cargo.toml`, `package.json`,
   `src-tauri/tauri.conf.json` MUST all carry the same `version`.
   `scripts/release-checklist.sh` enforces this.
2. **Supply-chain audit** — run `scripts/release-checklist.sh`. It runs:
   - `cargo audit --deny warnings` — fails on advisories.
   - `bun audit --audit-level high` — fails on high/critical CVEs.
     Moderate findings are tracked but not blocking; SLA is 30 days
     from publication to fix or document deferral.
   - `cargo deny check` (advisories + bans + licenses + sources) —
     fails on yanked/duplicate crates, disallowed licenses,
     non-allowlisted registries.
3. **CI status** — release branch matches main; cross-platform CI
   green (linux + macos + windows) per `.github/workflows/ci.yml`.

The CI workflow `.github/workflows/release-audit.yml` runs the same
audits on every push to `release/*` and on every `v*` tag. Local
runs via `scripts/release-checklist.sh` are advisory; the CI job is
authoritative.

## Exact-Version Pin Policy

Every new Rust or JavaScript dependency added to the project must:

1. Use an **exact version** in `Cargo.toml` or `package.json`
   (no caret, no tilde — e.g. `serde = "1.0.219"` not `serde = "^1.0"`).
2. Be accompanied by a `cargo audit` or `bun audit` run in the same
   commit's quality gate output (paste in commit body).
3. Be allowlisted in `deny.toml` if its license is not yet on the
   `[licenses] allow` list.

## macOS — Notarization

Prerequisites:

- Apple ID with active developer enrollment.
- App-specific password (generated at appleid.apple.com).
- Developer ID Application certificate in Keychain Access.
- `xcrun notarytool` (Xcode 13+).

Required GitHub Actions secrets:

- `APPLE_ID` — the Apple ID email.
- `APPLE_ID_APP_PASSWORD` — app-specific password.
- `APPLE_TEAM_ID` — 10-character team identifier.

Notarize the built app bundle:

```bash
xcrun notarytool submit "claude-devtools.app.zip" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_ID_APP_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
```

Then staple the result so the bundle verifies offline:

```bash
xcrun stapler staple "claude-devtools.app"
```

Never pass credentials as literal arguments. Always read from the
environment. The CI logs are reviewable — literal credentials in an
argv would leak.

## Windows — signtool

Prerequisites:

- EV (Extended Validation) code-signing certificate in PFX form.
- `signtool.exe` (Windows SDK).
- Password stored as a GHA secret, never literal.

Sign the built binary using an RFC 3161 timestamp server so the
signature remains verifiable after the cert expires:

```cmd
signtool.exe sign ^
  /fd SHA256 ^
  /tr http://timestamp.digicert.com ^
  /td SHA256 ^
  /f %CERT_PATH% ^
  /p %CERT_PASSWORD% ^
  "target\release\claude-devtools.exe"
```

`/tr` (not `/t`) and `/td SHA256` are required — `/t` uses the
legacy Authenticode timestamp protocol which is being phased out
by major timestamp authorities. The DigiCert timestamp URL above is
publicly available and recommended; switch only after confirming the
new authority's longevity.

## Linux — AppImage

Build the AppImage via Tauri's build pipeline. Signing is optional
for AppImages but recommended for distribution outside the upstream
release page:

```bash
gpg --detach-sign --armor "claude-devtools-<version>.AppImage"
```

Distribution channels (placeholder — wire up when the AppImage
release stream is live):

- AppImageHub mirror (if listed).
- Direct download from the GitHub release page.

## Supply-Chain — `cargo deny`

`deny.toml` at the repo root configures `cargo deny check`. First-run
output may surface pre-existing license or multiple-version findings;
`multiple-versions` ships as `"warn"` to avoid blocking the initial
release. Tighten to `"deny"` once the transitive tree is clean.

To install locally:

```bash
cargo install cargo-deny --locked --version 0.16.4
```

The CI release-audit workflow installs the same exact version via
`taiki-e/install-action`.
