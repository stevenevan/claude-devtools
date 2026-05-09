# Security Notes — claude-devtools

## Per-line byte cap (sprint 56)

`session_parser::parse_jsonl_line` rejects any line longer than
`MAX_JSONL_LINE_BYTES = 10 * 1024 * 1024` (10 MB) before it reaches
`serde_json::from_str`. The oversized line is logged with a structured
message and skipped; the file continues to parse. This prevents a pathological
producer from forcing a multi-gigabyte allocation or stalling the parser.

## SSH host-key verification (sprint 55)

The SSH client stores host fingerprints at `~/.claude/ssh/known_hosts`
(`0600` on Unix). On first contact a host's key is recorded (TOFU); on a
later connection the offered key must match. A mismatch surfaces an MITM
warning and the connection is refused — the user must edit the file by
hand to recover. Algorithm allowlist excludes `ssh-rsa` (SHA-1) and DSS;
only Ed25519, ECDSA NIST P-256/384/521, and RSA SHA2-256/512 are offered.
Agent forwarding is never requested on any channel.

## Parser fuzzing (planned)

A `cargo fuzz` target for `parse_jsonl_line` and the message classifier is
recommended as an opt-in step before release. The smoke command:

```bash
# (cargo-fuzz must be installed: cargo install cargo-fuzz)
cd src-tauri
cargo fuzz init                              # one-time
cargo fuzz add parse_jsonl_line              # add target
# Fill src-tauri/fuzz/fuzz_targets/parse_jsonl_line.rs with:
#
#   use claude_devtools_lib::parsing::session_parser::parse_jsonl_line;
#   use claude_devtools_lib::parsing::session_parser::SessionFileMetadata;
#   fuzz_target!(|data: &[u8]| {
#       let mut meta = SessionFileMetadata::default();
#       if let Ok(s) = std::str::from_utf8(data) {
#           let _ = parse_jsonl_line(s, &mut meta);
#       }
#   });
cargo fuzz run parse_jsonl_line --max-total-time 60
```

The 10 MB per-line cap means the fuzzer cannot drive the parser into a
multi-megabyte allocation regardless of input.

## CLI path hardening (sprint 53)

`claude-devtools-cli` rejects IDs containing slashes, backslashes, colons,
NUL, control characters, `.`/`..`, or any byte sequence longer than 200
chars. Every resolved path is canonicalized and verified to remain under
`~/.claude/projects/` after symlink resolution. `CLAUDE_HOME` / `HOME`
overrides from the environment are ignored.

## Capability surface (sprint 52)

Tauri capabilities are limited to: `core:default`, `shell:allow-open`,
`dialog:allow-open`, `dialog:allow-save`, `notification:default`,
`opener:default`, `autostart:default`, `process:default`. `shell:allow-spawn`
and `shell:allow-execute` are explicitly NOT granted. A CSP is set in
`tauri.conf.json` restricting script/style/image sources to `self` and IPC.
