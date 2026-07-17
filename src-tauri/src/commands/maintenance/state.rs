//! `MaintenanceState` + the shared gate/mute/throttle machinery for the W13
//! maintenance command layer. Ports the concurrency + SSH-gate + watcher-mute
//! discipline of Go's `MaintenanceService` (`internal/maintenanceservice`):
//!
//! - `op` (Go's `s.mu`) serializes the ssh-gate check + the mutation for every
//!   destructive op so two can't interleave.
//! - `running` + `cancel` reproduce Go's `s.cancel` (reject-if-busy for
//!   scan/policy; the cancel flag the policy pass polls between categories).
//! - `MuteGuard` emits `maintenance:mute-watcher {muted:true/false}` around the
//!   ops Go mutes, the `false` always firing on drop.
//! - `ssh_gate` refuses a mutation with `ERR_SSH_ACTIVE` when the SSH session is
//!   not `disconnected` (SEC-server-gate: the safe-delete engine is local-only).

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration as StdDuration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::cache::SessionCache;
use crate::config::root::app_data_dir;
use crate::config::state::ConfigState;
use crate::maintenance::category::cutoff_default;
use crate::maintenance::trash::{self, TrashReceipt};
use crate::ssh;

pub(crate) type SharedCache = Arc<Mutex<SessionCache>>;
/// The W14 seam: the scheduler surfaces enabled-but-not-auto-approved categories
/// as a pending-cleanup notification through this closure. For W13 it is wired to
/// a NO-OP in `main.rs`; W14 replaces it with the real NotificationService raise.
pub type RaisePending = Box<dyn Fn(&[String], i64) -> Result<(), String> + Send + Sync>;

/// SEC-server-gate. VERBATIM — the frontend matches this literally.
pub(crate) const ERR_SSH_ACTIVE: &str =
    "maintenance operates on the local machine only; disconnect the SSH session first";

/// Refuses a category/policy scan when the effective root is too broad. Mirrors
/// `errUnsafeRoot`.
pub(crate) const ERR_UNSAFE_ROOT: &str =
    "maintenance: effective claude root is too broad for cleanup scans";

/// Bounds how often `maintenance:scan-progress` is emitted (projects/ alone can
/// hold 900+ files). Mirrors `progressThrottle`.
pub(crate) const PROGRESS_THROTTLE: StdDuration = StdDuration::from_millis(150);

/// Go `nowMS() = time.Now().UnixNano() / 1e6`.
pub(crate) fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as f64 / 1e6)
        .unwrap_or(0.0)
}

/// The managed maintenance service state (`.manage(Arc<MaintenanceState>)`).
/// Mirrors the fields of Go's `MaintenanceService`.
pub struct MaintenanceState {
    /// Held across the ssh-gate check + the mutation for a destructive op
    /// (Go `s.mu`).
    op: Mutex<()>,
    /// Reject-if-busy flag for a scan/policy run (Go `s.cancel != nil`).
    running: AtomicBool,
    /// Cancel signal a policy pass polls between categories (Go's ctx cancel).
    pub(crate) cancel: Arc<AtomicBool>,
    pub(crate) config: Arc<ConfigState>,
    pub(crate) cache: SharedCache,
    pub(crate) ssh: Arc<ssh::State>,
    pub(crate) raise_pending: RaisePending,
    /// Stops the scheduler thread on shutdown (currently never set — the app runs
    /// to process exit; kept so a future shutdown wire can join cleanly).
    pub(crate) sched_stop: Arc<AtomicBool>,
}

impl MaintenanceState {
    pub fn new(
        config: Arc<ConfigState>,
        cache: SharedCache,
        ssh: Arc<ssh::State>,
        raise_pending: RaisePending,
    ) -> Self {
        Self {
            op: Mutex::new(()),
            running: AtomicBool::new(false),
            cancel: Arc::new(AtomicBool::new(false)),
            config,
            cache,
            ssh,
            raise_pending,
            sched_stop: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Poison-free lock of `op` (no invariant is held across a panic).
    pub(crate) fn lock_op(&self) -> MutexGuard<'_, ()> {
        self.op.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// SEC-server-gate: refuse a mutation while an SSH session is active. Mirrors
    /// `if s.sshActive() { return errSSHActive }`.
    pub(crate) fn ssh_gate(&self) -> Result<(), String> {
        if self.ssh.get_status().state != "disconnected" {
            return Err(ERR_SSH_ACTIVE.to_string());
        }
        Ok(())
    }

    pub(crate) fn effective_root(&self) -> String {
        self.config.get_claude_root_info().effective_path
    }

    pub(crate) fn app_data(&self) -> Result<String, String> {
        Ok(app_data_dir()?.to_string_lossy().into_owned())
    }

    /// [effective claude root, app-data dir], de-duping app-data when it nests
    /// inside the effective root. Mirrors `resolveRoots`.
    pub(crate) fn resolve_roots(&self) -> Result<Vec<String>, String> {
        let effective = self.effective_root();
        let app_data = self.app_data()?;
        let mut roots = vec![effective.clone()];
        // Outside iff app_data is NOT contained in effective (component-aware,
        // matching `filepath.Rel` "../" detection without the string-prefix bug).
        if !Path::new(&app_data).starts_with(&effective) {
            roots.push(app_data);
        }
        Ok(roots)
    }

    /// Persisted history cutoff or the 180-day default (no matcher is registered
    /// for "history"). Mirrors `historyCutoffDays`.
    pub(crate) fn history_cutoff_days(&self) -> i64 {
        self.config.get_maintenance_cutoff("history").unwrap_or(180)
    }

    /// Flattens config's per-project pinned sessions to a flat id list for the
    /// projects matcher's bulk-exclusion cross-reference. Mirrors `pinnedSessionIDs`.
    pub(crate) fn pinned_session_ids(&self) -> Vec<String> {
        let cfg = self.config.get_config();
        let mut out = Vec::new();
        for sessions in cfg.sessions.pinned_sessions.values() {
            for p in sessions {
                out.push(p.session_id.clone());
            }
        }
        out
    }

    /// Claims the single scan/policy run slot (reject-if-busy). Resets the cancel
    /// flag so a stale cancel from a prior run can't abort the new one. The guard
    /// releases both on drop (Go's deferred `s.cancel = nil`).
    pub(crate) fn claim_run(&self, busy_msg: &str) -> Result<RunGuard<'_>, String> {
        if self
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(busy_msg.to_string());
        }
        self.cancel.store(false, Ordering::SeqCst);
        Ok(RunGuard { state: self })
    }

    /// The gated, un-muted mutation wrapper (patch/create/write/apply/restore):
    /// serialize under `op`, ssh-gate, then run `f` with the effective root.
    pub(crate) fn gated<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&str) -> Result<T, String>,
    {
        let _op = self.lock_op();
        self.ssh_gate()?;
        f(&self.effective_root())
    }

    /// The shared body of every manager DELETE: gate, resolve the confined dest
    /// via `resolve`, mute the watcher, and trash the single path (never
    /// `os.Remove`). Mirrors DeleteAgent/DeleteInstructionFile/... exactly.
    pub(crate) fn delete_via_trash<F>(
        &self,
        app: &AppHandle,
        resolve: F,
    ) -> Result<TrashReceipt, String>
    where
        F: FnOnce(&str) -> Result<String, String>,
    {
        let _op = self.lock_op();
        self.ssh_gate()?;
        let dest = resolve(&self.effective_root())?;
        let roots = self.resolve_roots()?;
        let app_data = self.app_data()?;
        let _mute = MuteGuard::new(app);
        trash::trash_items(&roots, &app_data, std::slice::from_ref(&dest))
    }

    /// Invalidates the SessionCache for every project touched by a trash batch and
    /// emits `maintenance:trashed` once (not per file). Mirrors `evictTrashedProjects`.
    pub(crate) fn evict_trashed_projects(&self, app: &AppHandle, receipt: &TrashReceipt) {
        let prefix = format!(
            "{}{}",
            Path::new(&self.effective_root())
                .join("projects")
                .to_string_lossy(),
            std::path::MAIN_SEPARATOR,
        );
        let mut affected: BTreeSet<String> = BTreeSet::new();
        for item in &receipt.items {
            let Some(rel) = item.orig_path.strip_prefix(&prefix) else {
                continue;
            };
            let enc = rel.split(std::path::MAIN_SEPARATOR).next().unwrap_or("");
            if !enc.is_empty() {
                affected.insert(enc.to_string());
            }
        }
        if affected.is_empty() {
            return;
        }
        let list: Vec<String> = affected.into_iter().collect();
        if let Ok(mut cache) = self.cache.lock() {
            for enc in &list {
                cache.invalidate_project(enc);
            }
        }
        let _ = app.emit("maintenance:trashed", json!({ "projects": list }));
    }
}

/// Releases the scan/policy run slot on drop (Go's deferred `s.cancel = nil` +
/// `cancel()`).
pub(crate) struct RunGuard<'a> {
    state: &'a MaintenanceState,
}

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.state.cancel.store(false, Ordering::SeqCst);
        self.state.running.store(false, Ordering::SeqCst);
    }
}

/// Emits `maintenance:mute-watcher {muted:true}` on construction and
/// `{muted:false}` on drop, so the file watcher stays muted across a batch even
/// if the mutation errors mid-way (Go's `defer emitEvent(... muted:false)`).
pub(crate) struct MuteGuard {
    app: AppHandle,
}

impl MuteGuard {
    pub(crate) fn new(app: &AppHandle) -> Self {
        let _ = app.emit("maintenance:mute-watcher", json!({ "muted": true }));
        Self { app: app.clone() }
    }
}

impl Drop for MuteGuard {
    fn drop(&mut self) {
        let _ = self.app.emit("maintenance:mute-watcher", json!({ "muted": false }));
    }
}

/// Rejects "/", the home dir, and any ancestor of home. Mirrors `refuseSystemRoot`.
pub(crate) fn refuse_system_root(root: &str) -> Result<(), String> {
    let clean = Path::new(root);
    if clean.parent().is_none() {
        return Err(ERR_UNSAFE_ROOT.to_string()); // filesystem root
    }
    let home = match dirs::home_dir() {
        Some(h) if !h.as_os_str().is_empty() => h,
        _ => return Ok(()),
    };
    // `home` starts_with `clean` covers both `clean == home` and `clean` being an
    // ancestor of home; a sibling/descendant is safe.
    if home.starts_with(clean) {
        return Err(ERR_UNSAFE_ROOT.to_string());
    }
    Ok(())
}

/// A category's cutoff resolved the SAME way ScanCategory does: persisted override
/// else the matcher default. Mirrors `policyCutoffDays`.
pub(crate) fn policy_cutoff_days(config: &ConfigState, id: &str) -> i64 {
    config
        .get_maintenance_cutoff(id)
        .unwrap_or_else(|| cutoff_default(id))
}

/// Collects the `enabledPlugins` keys marked true in `<root>/settings.json`.
/// Read from the effective root (not hardcoded ~/.claude). Best-effort. Mirrors
/// `readEnabledPlugins`.
pub(crate) fn read_enabled_plugins(root: &str) -> Vec<String> {
    let Ok(data) = fs::read(Path::new(root).join("settings.json")) else {
        return Vec::new();
    };
    let Ok(settings) = serde_json::from_slice::<Value>(&data) else {
        return Vec::new();
    };
    let Some(ep) = settings.get("enabledPlugins").and_then(Value::as_object) else {
        return Vec::new();
    };
    ep.iter()
        .filter(|(_, v)| v.as_bool() == Some(true))
        .map(|(k, _)| k.clone())
        .collect()
}

/// Extracts absolute binary paths referenced by `<root>/settings.json` —
/// statusLine.command plus every nested hooks command. Best-effort. Mirrors
/// `readActiveBinaries`.
pub(crate) fn read_active_binaries(root: &str) -> Vec<String> {
    let Ok(data) = fs::read(Path::new(root).join("settings.json")) else {
        return Vec::new();
    };
    let Ok(settings) = serde_json::from_slice::<Value>(&data) else {
        return Vec::new();
    };
    let mut commands: Vec<String> = Vec::new();
    if let Some(c) = settings
        .get("statusLine")
        .and_then(|s| s.get("command"))
        .and_then(Value::as_str)
    {
        commands.push(c.to_string());
    }
    collect_command_strings(settings.get("hooks"), &mut commands);

    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut out = Vec::new();
    for c in &commands {
        for tok in c.split_whitespace() {
            let tok = tok.trim_matches(['"', '\'']);
            if Path::new(tok).is_absolute() && seen.insert(tok.to_string()) {
                out.push(tok.to_string());
            }
        }
    }
    out
}

/// Recursively gathers every "command" string in a settings hooks subtree.
/// Mirrors `collectCommandStrings`.
fn collect_command_strings(v: Option<&Value>, out: &mut Vec<String>) {
    match v {
        Some(Value::Object(map)) => {
            for (k, val) in map {
                if k == "command" {
                    if let Some(s) = val.as_str() {
                        out.push(s.to_string());
                    }
                }
                collect_command_strings(Some(val), out);
            }
        }
        Some(Value::Array(arr)) => {
            for e in arr {
                collect_command_strings(Some(e), out);
            }
        }
        _ => {}
    }
}

/// Whether `path` canonically matches one of the binaries the live settings.json
/// references (UX gate; root-confinement in the trash primitive is the real
/// boundary). Mirrors `isActiveBinary`.
pub(crate) fn is_active_binary(root: &str, path: &str) -> bool {
    let target = canon_path_or_clean(path);
    read_active_binaries(root)
        .iter()
        .any(|a| canon_path_or_clean(a) == target)
}

fn canon_path_or_clean(path: &str) -> String {
    match fs::canonicalize(path) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(_) => Path::new(path).to_string_lossy().into_owned(),
    }
}
