# Security & Privacy

## Network Activity

claude-devtools makes **zero** outbound network calls to third-party servers. There is no telemetry, analytics, tracking, or data exfiltration of any kind.

| Network activity | When | User-initiated |
|---|---|---|
| SSH connections | Settings > SSH | Yes |

The app is a native Tauri desktop application — there is no HTTP server, no auto-updater phoning home, and no standalone/Docker mode.

## Data Handling

- All session data is read **locally** from `~/.claude/` — it never leaves your machine.
- The app does not write to session files.
- Configuration is stored at `~/.claude/claude-devtools-config.json` on the local filesystem.
- No data is sent to Anthropic, GitHub, or any other third party.

## Tauri Command Validation

- All Tauri commands validate inputs with strict path containment checks
- File reads are constrained to the project root and `~/.claude/`
- Path traversal attacks are blocked
- Sensitive credential paths are rejected

## Supported Versions

Only the latest release is supported with security fixes.

## Reporting a Vulnerability

Please report vulnerabilities privately and do not open public issues for undisclosed security problems.

Include:
- affected version/commit
- vulnerability description
- impact assessment
- reproduction steps or proof of concept

If you do not have a private contact path yet, open a minimal GitHub issue asking for a secure reporting channel without disclosing technical details.

## Disclosure Process

- We will acknowledge reports as quickly as possible.
- We will validate, triage severity, and prepare a fix.
- We will coordinate a release and publish advisories when appropriate.
