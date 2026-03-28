# Sprint 3 (Week 16: Apr 13 - Apr 19)

**Phase**: 1 - Quality Foundation
**Theme**: React Component Test Infrastructure + First Tests

## Deliverables

- [x] Store tests for `tabUISlice` — per-tab UI isolation, AI group/display item/subagent expansion, context panel, scroll, turn nav [FE] [M]
- [x] Store tests for `conversationSlice` — expansion states, detail popover, search show/hide/wrap [FE] [M]
- [x] Store tests for `notificationSlice` — initial state, openNotificationsTab singleton behavior [FE] [M]
- [ ] Component tests (deferred: requires @testing-library/react installation) [FE] [L]

## Key Files

- `src/renderer/components/sidebar/DateGroupedSessions.tsx`
- `src/renderer/components/sidebar/SessionItem.tsx`
- `src/renderer/components/layout/TabBar.tsx`
- `src/renderer/components/search/CommandPalette.tsx`

## Done When

25+ component tests across 3+ files; test infra supports rendering with pre-configured Zustand store.
