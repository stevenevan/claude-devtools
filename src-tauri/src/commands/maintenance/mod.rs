//! Tauri command layer for `MaintenanceService` (W13). Exposes the Go
//! `internal/maintenanceservice` surface — scan/trash/history/rollback/health,
//! the retention-policy engine, the in-app scheduler, and the global managers
//! (agents/instructions/memory/skills) — as `#[tauri::command]`s over the ported
//! pure `crate::maintenance::*` + `crate::files::*` fns. The 7 config-backup
//! methods are W14. `state` holds the concurrency + ssh-gate + watcher-mute
//! machinery; the command wrappers are thin.

mod cleanup;
mod configbackup;
mod managers;
mod scheduler;
mod service;
mod state;

#[cfg(test)]
mod tests;

pub use state::MaintenanceState;

// Glob re-exports so the `#[tauri::command]` helper macros (`__cmd__*` /
// `__tauri_command_name_*`) reach `generate_handler!` at the `maintenance_cmds`
// path — a named `pub use` re-exports the fn but not its sibling macros.
pub use cleanup::*;
pub use configbackup::*;
pub use managers::*;
pub use scheduler::*;
pub use service::*;
