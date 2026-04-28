# Sprint 40 — Week of 2026-10-05 | Extensibility

## Notification Rules Engine

### Deliverables
1. **Rule DSL** — condition tree (`AND` / `OR`) of predicates: `tool_name`, `duration_gt`, `error`, `cost_gt`, `regex_match`.
2. **Action enum** — `Notify`, `Badge`, `Webhook { url, template }`. `Webhook` ships as a typed stub that logs-and-skips; actual dispatch lands in sprint 41.
3. Extend `trigger_matcher.rs` to evaluate the tree. Persist rules under `AppConfig.notification_rules`.
4. `RulesEditor.tsx` — visual AND/OR builder; live "test against last N sessions" preview showing which would have matched.

### Files
- `src-tauri/src/notifications/trigger_matcher.rs`
- `src-tauri/src/notifications/types.rs` (enum additions)
- `src-tauri/src/config/types.rs`
- `src/renderer/components/settings/NotificationTriggerSettings/RulesEditor.tsx` (new)
- `src/renderer/api/tauriClient.ts`
- `src/shared/types/api.ts`

### Dependencies
- Existing `notifications/` backend

### Verification
- `cargo test` — `AND(regex_match("TODO"), duration_gt(5s))` matches only when both satisfied
- `cargo test` — `Webhook` action dispatch logs and returns `Ok(())` (stub)
- Manual: preview re-evaluates within 500ms on rule change

### Contract Handoff to Sprint 41
- `Action::Webhook { url, template }` variant must be shipped in this sprint so sprint 41 only fills the dispatch body — not the type
