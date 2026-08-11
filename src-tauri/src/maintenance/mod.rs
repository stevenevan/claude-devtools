//! `maintenance` — the maintenance engine ported from `internal/maintenance`
//! (W13). Category matchers, disk scan, TrashItems (never hard-delete), plain
//! delete, history prune, binary rollback, health snapshot, retention RunPolicy.
//! Confinement reuses `crate::files::pathutil::confine`; guards reproduced
//! guard-for-guard (invariant #3).
pub mod cat_backups;
pub mod cat_caches;
pub mod cat_filehistory;
pub mod cat_junk;
pub mod cat_logs;
pub mod cat_plans;
pub mod cat_plugins;
pub mod cat_projects;
pub mod cat_runtime;
pub mod cat_transcripts;
pub mod category;
pub mod cleanup_run;
pub mod health;
pub mod history;
pub mod plaindelete;
pub mod rollback;
pub mod scan;
pub mod simple_cleanup;
pub mod trash;
pub mod types;
