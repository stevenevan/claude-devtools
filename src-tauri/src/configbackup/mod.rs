//! `configbackup` — config export/import ported from `internal/configbackup`
//! (W14). Capture allowlisted config into a store, zip export (secret-stripped
//! by default), and import behind the trust gate (zip-slip guard, byte caps,
//! hooks-strip → hooks-disabled.json). Reuses `crate::files` masking + settings
//! writer + hook-group appender. Guards reproduced guard-for-guard (invariant #3).
pub mod capture;
pub mod export;
pub mod import;
pub mod restore;
pub mod store;
pub mod types;
