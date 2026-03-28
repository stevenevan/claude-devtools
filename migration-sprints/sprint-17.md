# Sprint 17 (Week 30: Jul 20 - Jul 26)

**Phase**: 5 - Polish & Accessibility
**Theme**: Error Handling & User Feedback

## Deliverables

- [ ] User-facing error system — toast notifications (sonner) for recoverable, modal for critical, categorize all error paths [FE] [L]
- [ ] Error boundaries — wrap chat, sidebar, dashboard, settings with recovery UI [FE] [M]
- [ ] SSH retry/error recovery — auto-reconnect with backoff, status indicator, manual reconnect, clear messages [BE+FE] [L]
- [ ] Rust tests for SSH error paths — timeout, auth failure, SFTP failure, reconnection [BE] [M]

## Key Files

- `src/renderer/components/common/ErrorBoundary.tsx`
- `src-tauri/src/ssh/connection_manager.rs`
- `src-tauri/src/ssh/commands.rs`
- `src/renderer/store/slices/connectionSlice.ts`

## Done When

No error goes only to console; error boundaries catch failures in all 4 sections; SSH reconnects after transient failures.
