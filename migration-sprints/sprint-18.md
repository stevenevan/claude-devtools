# Sprint 18 (Week 31: Jul 27 - Aug 2)

**Phase**: 5 - Polish & Accessibility
**Theme**: Accessibility Audit & Remediation

## Deliverables

- [x] ARIA attributes across 37 component files (75 occurrences) — role, aria-label, aria-live [FE] [L]
- [x] Focus-visible indicators in 22 UI component files [FE] [M]
- [x] Keyboard shortcuts with useKeyboardShortcuts (10+ shortcuts, scope isolation) [FE] [L]
- [ ] Automated a11y testing with axe-core — deferred (requires @testing-library/react) [FE] [M]

## Key Files

- All interactive components across `src/renderer/components/`
- `src/renderer/index.css` (contrast, focus styles)
- `test/` (new a11y test suite)

## Done When

All elements keyboard-accessible; axe-core zero critical/serious violations; WCAG AA contrast in both themes; 20+ components with a11y tests.
