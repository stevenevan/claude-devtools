# Sprint 41 — Week of 2026-10-12 | Extensibility

## Slack/Discord Webhook Integration for Notifications

### Deliverables
1. **Webhook dispatcher** — fill in `Action::Webhook` body (typed stub landed in sprint 40). Sends POST with template-expanded JSON payload. Template vars: `{session_id}`, `{tool}`, `{cost}`, `{summary}`.
2. **SSRF guardrail** — allowlist: only `hooks.slack.com`, `discord.com/api/webhooks/*`, `discordapp.com/api/webhooks/*`. Reject internal/private IP ranges (10/8, 172.16/12, 192.168/16, 127/8, ::1, fc00::/7) after DNS resolve.
3. **Retry** — exponential backoff (1s, 2s, 4s) on 5xx/429; max 3 attempts; drop on 4xx with error log.
4. `WebhookSettings.tsx` — add/remove endpoints + "send test payload" button.

### Files
- `src-tauri/src/notifications/webhook.rs` (new)
- `src-tauri/src/notifications/mod.rs`
- `src-tauri/src/config/types.rs` (endpoint list)
- `src/renderer/components/settings/sections/WebhookSettings.tsx` (new)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Sprint 40 (`Action::Webhook` variant must exist)
- `reqwest` (already in tree)

### Verification
- `cargo test` SSRF: `http://10.0.0.1/` rejected; `https://hooks.slack.com/services/…` accepted; `http://169.254.169.254/` (metadata) rejected
- `cargo test` retry: 429 then 200 succeeds in 2 attempts; three 500s fails after 3
- Manual: test-send posts to real Slack webhook and appears within 2s
