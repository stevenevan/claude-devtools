# Contributing

Thanks for contributing to claude-devtools (Tauri fork).

This project is a fork of [matt1398/claude-devtools](https://github.com/matt1398/claude-devtools), rebuilt with Tauri 2.x and a Rust backend.

## Project Philosophy & Scope

claude-devtools exists to make the invisible parts of Claude Code visible — the token flows, context injections, tool executions, and session dynamics that are otherwise hidden behind the CLI.

Our priorities:

1. **Parity with Claude Code** — When Claude Code ships new capabilities, we adopt them quickly so users always have full visibility.
2. **Context engineering insight** — Features that help users understand *what* is consuming their context window and *where* to optimize.
3. **Stability over novelty** — A reliable, fast tool for professional workflows.

**What we generally do not accept:**
- Large custom features that don't directly serve context visibility or Claude Code parity.
- Speculative features that add maintenance burden without solving a concrete problem.
- PRs that significantly expand scope without prior discussion in an Issue.

If you're considering a non-trivial contribution, **open an Issue first**.

## Prerequisites
- [Rust](https://rustup.rs/) (stable toolchain)
- [bun](https://bun.sh/)
- Tauri 2.x system dependencies ([see Tauri docs](https://v2.tauri.app/start/prerequisites/))

## Setup
```bash
bun install
bun run dev
```

## Quality Gates
Before opening a PR, run:
```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

Or all at once:
```bash
bun run check
```

## Pull Request Guidelines
- Keep changes focused and small — one purpose per PR.
- Add/adjust tests for behavior changes.
- Update docs when changing public behavior or setup.
- Use clear PR titles and include a short validation checklist.
- **Large changes must have a discussion in an Issue first.**
- Avoid committing large hardcoded data blobs.

## AI-Assisted Contributions

AI coding tools are welcome, but **you are responsible for what you submit**:

- **Review before submitting.** Read every line of AI-generated code and understand what it does.
- **Do not commit AI workflow artifacts.** Planning documents, session logs, step-by-step plans do not belong in the repository.
- **Test it yourself.** Run the app, confirm the feature works, check edge cases.
- **Keep it intentional.** Every line in your PR should exist for a reason you can explain.

## Commit Style
- Prefer conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Include rationale in commit body for non-trivial changes.

## Reporting Bugs
Please include:
- OS version
- app version / commit hash
- repro steps
- expected vs actual behavior
- logs/screenshots when possible
