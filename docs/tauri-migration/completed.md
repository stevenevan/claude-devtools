# Tauri migration complete

The 16-week documented desktop migration is complete.

- Tauri 2 and the Rust backend are the only active runtime.
- The renderer uses `DesktopAPI` and Tauri IPC exclusively.
- Rust parity fixtures live at `src-tauri/tests/fixtures/parity`.
- Root commands use Bun and Tauri; `bun run qa` runs frontend, Rust, and safety gates.
- Production CSP excludes development loopback origins. Development-only CSP permits the Vite loopback connection.
- Renderer telemetry is validated and redacted at the Rust command boundary.

Historical weekly briefs remain as migration records only.
