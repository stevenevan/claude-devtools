# paritytest fixture corpus

Two tiers feed the Go↔Rust parity harness (see the Cycle B plan, Strategy §2).

## 1. Committed synthetic fixtures — `*.jsonl` in this directory

Hand-authored, **fixed timestamps**, fully deterministic. They cover the
`EnhancedChunk` variant matrix (User / AI / System / Compact / Event) plus team
messages, subagents, system events, and a compaction boundary. These are the
reproducible per-commit gate and are safe to commit.

Fixtures are authored in the week that first consumes them (W4 parsing, W5
analysis), so this directory grows across Cycle B.

## 2. Local real corpus — the dev machine's `~/.claude/projects/*.jsonl`

Enumerated **in place** by the harness when present; **skipped** when absent
(so `go test ./...` and CI stay green without it).

**PRIVACY — never copy real sessions into this repo.** Real sessions contain
user prompts (possibly pasted secrets), tool output (file contents, keys), and
home-dir paths. This repo is public. Do NOT create a repo-internal real-corpus
directory, and do NOT rely on a `.gitignore` rule inside a directory that also
holds committed fixtures — a single `git add` of this directory would sweep a
stray real session into history irreversibly. When adapting a real session as a
synthetic template, scrub every prompt / path / output first.
