//! Ported from `internal/maintenance/cat_backups_test.go` (the `scanBackupBinaries`
//! case; `TestRollbackBinary` belongs to `rollback.rs`, owned by another agent).

use std::collections::HashMap;
use std::path::Path;

use chrono::Utc;

use crate::maintenance::category::maint_test_support::*;
use crate::maintenance::category::scan_category;
use crate::maintenance::types::{Candidate, CategorySpec};

#[test]
fn test_scan_backup_binaries() {
    let tmp = TempDir::new("backups");
    let root = tmp.path();
    let active = root.join("status-line");
    write_file(&active, "ACTIVE-BYTES");
    // identical backup (same bytes) and a distinct backup (different bytes).
    write_file(&root.join("status-line.bin.bak"), "ACTIVE-BYTES");
    write_file(&root.join("status-line.pre-x.bak"), "OLD-DIFFERENT");
    // a hook backup under hooks/
    write_file(&root.join("hooks").join("caveman.v1.0.0.bak"), "hook");

    let spec = CategorySpec {
        id: "backup-binaries".to_string(),
        root: root.to_string_lossy().into_owned(),
        now: Utc::now(),
        active: vec![active.to_string_lossy().into_owned()],
        ..Default::default()
    };
    let cands = scan_category(&spec).unwrap();

    let active_str = active.to_string_lossy().into_owned();
    let mut by_name: HashMap<String, Candidate> = HashMap::new();
    for c in &cands {
        assert_ne!(c.path, active_str, "active binary must never be a candidate");
        let base = Path::new(&c.path).file_name().unwrap().to_string_lossy().into_owned();
        by_name.insert(base, c.clone());
    }
    assert_eq!(cands.len(), 3, "3 backup candidates: {by_name:?}");
    assert_eq!(by_name["status-line.bin.bak"].meta["identical"], "true");
    assert_eq!(by_name["status-line.pre-x.bak"].meta["identical"], "false");
    assert_eq!(by_name["status-line.bin.bak"].group, "status-line");
}
