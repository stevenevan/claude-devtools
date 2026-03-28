# Sprint 18 (Week 31: Jul 27 - Aug 2)

**Phase**: 5 - Polish & Accessibility
**Theme**: Accessibility Audit & Remediation

## Deliverables

- [ ] Keyboard navigation audit — all elements Tab-reachable, Enter/Space work, logical focus order, skip links [FE] [L]
- [ ] Screen reader compatibility — alt text, form labels, aria-live regions, correct landmark roles [FE] [L]
- [ ] Color contrast & visual a11y — WCAG AA in both themes, focus-visible indicators, non-color differentiators [FE] [M]
- [ ] Automated a11y testing — axe-core integration, a11y assertions in component tests, dedicated test suite [FE] [M]

## Key Files

- All interactive components across `src/renderer/components/`
- `src/renderer/index.css` (contrast, focus styles)
- `test/` (new a11y test suite)

## Done When

All elements keyboard-accessible; axe-core zero critical/serious violations; WCAG AA contrast in both themes; 20+ components with a11y tests.
