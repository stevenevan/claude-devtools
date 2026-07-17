//! Ports `internal/maintenance/cleanup_run_test.go`. The category scanning runs
//! through the REAL `scan_category` matchers (integration); only the destructive
//! steps (trash/empty/list/prune/analyze) are faked closures. Fixtures use the
//! shared `maint_test_support` temp dirs anchored at a fixed `test_now`.

use super::*;
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;

use chrono::{DateTime, Duration, Utc};

use crate::config::state::types::{RetentionCategory, RetentionPolicy};
use crate::maintenance::category::cutoff_default;
use crate::maintenance::category::maint_test_support::{
    days_before, set_mtime, test_now, write_aged, write_file, TempDir,
};
use crate::maintenance::category::scan_category;
use crate::maintenance::types::CategorySpec;

// ── recorder + option builders ───────────────────────────────────────────────

fn enabled_cat() -> RetentionCategory {
    RetentionCategory {
        enabled: true,
        auto_approved: false,
    }
}
fn disabled_cat() -> RetentionCategory {
    RetentionCategory {
        enabled: false,
        auto_approved: false,
    }
}

fn policy(cats: &[(&str, RetentionCategory)], expiry_days: i64) -> RetentionPolicy {
    let mut map = BTreeMap::new();
    for (id, c) in cats {
        map.insert((*id).to_string(), *c);
    }
    RetentionPolicy {
        categories: map,
        trash_expiry_days: expiry_days,
        schedule_interval: "off".to_string(),
    }
}

/// Captures the injected-closure calls (paths trashed, ids emptied) + the
/// interleaved op order so a test can assert "expiry ran after the categories".
#[derive(Default)]
struct RecorderState {
    trash_calls: Vec<Vec<String>>,
    empty_calls: Vec<Vec<String>>,
    ops: Vec<&'static str>,
}

fn base_opts(
    root: &str,
    app_data: &str,
    now: DateTime<Utc>,
    pol: RetentionPolicy,
    rec: Rc<RefCell<RecorderState>>,
) -> RunPolicyOptions {
    let r_trash = rec.clone();
    let r_empty = rec;
    RunPolicyOptions {
        root: root.to_string(),
        app_data_dir: app_data.to_string(),
        policy: pol,
        now,
        dry_run: false,
        cutoff_for: Box::new(|id| cutoff_default(id)),
        enrich: None,
        progress: None,
        trash: Box::new(move |paths| {
            let mut s = r_trash.borrow_mut();
            s.trash_calls.push(paths.to_vec());
            s.ops.push("trash");
            Ok(())
        }),
        empty_trash: Box::new(move |ids| {
            let mut s = r_empty.borrow_mut();
            s.empty_calls.push(ids.to_vec());
            s.ops.push("empty");
            Ok(())
        }),
        list_trash: Box::new(|| Ok(Vec::new())),
        prune_history: Box::new(|| Ok(0)),
        analyze_history: Box::new(|| Ok(0)),
    }
}

fn any_path_contains(calls: &[Vec<String>], needle: &str) -> bool {
    calls.iter().flatten().any(|p| p.contains(needle))
}

fn no_cancel() -> impl Fn() -> bool {
    || false
}

// ── tests ────────────────────────────────────────────────────────────────────

/// Every ENABLED trash-governed category yields exactly one trash() call, a
/// DISABLED one yields none, and the plain-delete ids are NEVER trashed even
/// when enabled.
#[test]
fn test_run_policy_trashes_enabled_categories() {
    let tmp = TempDir::new("run-enabled");
    let root = tmp.path();
    let app_tmp = TempDir::new("run-enabled-app");
    let app_data = app_tmp.path().to_string_lossy().into_owned();
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);

    // Enabled: transcripts (aged past 90d), plans (always a candidate).
    write_aged(
        &root.join("transcripts").join("ses_a.jsonl"),
        "aaaa",
        days_before(now_local, 100),
    );
    write_file(&root.join("plans").join("foo.md"), "plan");

    // Disabled: file-history uuid dir aged past 30d (dir mtime backdated too).
    let fh_dir = root.join("file-history").join("uuid1");
    write_aged(&fh_dir.join("snap.txt"), "x", days_before(now_local, 40));
    set_mtime(&fh_dir, days_before(now_local, 40));

    // Plain-delete: logs enabled in the policy but must be skipped defensively.
    write_file(&root.join("logs").join("app.log"), "log");

    // Sanity: the disabled category HAS a candidate (so "not trashed" is real).
    let sanity = CategorySpec {
        id: "file-history".to_string(),
        root: root.to_string_lossy().into_owned(),
        now,
        cutoff: Some((now_local - Duration::days(30)).with_timezone(&Utc)),
        ..Default::default()
    };
    let fh_cands = scan_category(&sanity).unwrap();
    assert_eq!(fh_cands.len(), 1, "fixture: file-history should have 1 candidate");

    let pol = policy(
        &[
            ("transcripts", enabled_cat()),
            ("plans", enabled_cat()),
            ("file-history", disabled_cat()),
            ("logs", enabled_cat()), // plain-delete — must be skipped
        ],
        30,
    );
    let rec = Rc::new(RefCell::new(RecorderState::default()));
    let opts = base_opts(&root.to_string_lossy(), &app_data, now, pol, rec.clone());
    let (report, result) = run_policy(&opts, &no_cancel());
    assert!(result.is_ok(), "unexpected error: {result:?}");

    let logs_prefix = root.join("logs").to_string_lossy().into_owned();
    let s = rec.borrow();
    assert_eq!(
        s.trash_calls.len(),
        2,
        "want 2 trash calls (transcripts, plans)"
    );
    assert_eq!(report.categories.len(), 2, "want 2 reported categories");
    assert!(
        any_path_contains(&s.trash_calls, "transcripts/ses_a.jsonl"),
        "transcripts candidate was not trashed"
    );
    assert!(
        !any_path_contains(&s.trash_calls, "file-history"),
        "disabled file-history category was trashed"
    );
    assert!(
        !any_path_contains(&s.trash_calls, &logs_prefix),
        "plain-delete logs category was trashed (HIGH-1 violation)"
    );
}

/// Expiry runs LAST and empties ONLY receipts older than the window; a same-pass
/// receipt survives.
#[test]
fn test_run_policy_trash_expiry() {
    let tmp = TempDir::new("expiry");
    let root = tmp.path();
    let app_tmp = TempDir::new("expiry-app");
    let app_data = app_tmp.path().to_string_lossy().into_owned();
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);
    write_aged(
        &root.join("transcripts").join("ses_a.jsonl"),
        "aaaa",
        days_before(now_local, 100),
    );

    let receipts = vec![
        TrashReceiptView {
            id: "old-id".to_string(),
            trashed_at: (now_local - Duration::days(40)).with_timezone(&Utc),
        },
        TrashReceiptView {
            id: "new-id".to_string(),
            trashed_at: now, // same-pass
        },
    ];

    let pol = policy(&[("transcripts", enabled_cat())], 30);
    let rec = Rc::new(RefCell::new(RecorderState::default()));
    let mut opts = base_opts(&root.to_string_lossy(), &app_data, now, pol, rec.clone());
    opts.list_trash = Box::new(move || Ok(receipts.clone()));

    let (report, result) = run_policy(&opts, &no_cancel());
    assert!(result.is_ok(), "unexpected error: {result:?}");

    assert_eq!(report.trash_expiry_count, 1, "want TrashExpiryCount 1");
    let s = rec.borrow();
    assert_eq!(s.empty_calls, vec![vec!["old-id".to_string()]]);
    assert_eq!(
        s.ops,
        vec!["trash", "empty"],
        "expiry must run AFTER category trashing"
    );
}

/// A 0 window is floored to 1 day so a same-pass receipt is never purged.
#[test]
fn test_run_policy_expiry_clamps_zero_window() {
    let tmp = TempDir::new("clamp");
    let root = tmp.path();
    let app_tmp = TempDir::new("clamp-app");
    let app_data = app_tmp.path().to_string_lossy().into_owned();
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);

    let receipts = vec![
        TrashReceiptView {
            id: "old-id".to_string(),
            trashed_at: (now_local - Duration::days(40)).with_timezone(&Utc),
        },
        TrashReceiptView {
            id: "fresh-id".to_string(),
            trashed_at: now,
        },
    ];

    let pol = policy(&[("transcripts", enabled_cat())], 0); // clamped to 1 inside
    let rec = Rc::new(RefCell::new(RecorderState::default()));
    let mut opts = base_opts(&root.to_string_lossy(), &app_data, now, pol, rec.clone());
    opts.list_trash = Box::new(move || Ok(receipts.clone()));

    let (report, result) = run_policy(&opts, &no_cancel());
    assert!(result.is_ok(), "unexpected error: {result:?}");
    assert_eq!(report.trash_expiry_count, 1, "want 1 expired (old only)");
    assert_eq!(
        rec.borrow().empty_calls,
        vec![vec!["old-id".to_string()]],
        "a same-pass receipt must survive a 0 window"
    );
}

/// An enabled "history" category routes to prune_history (exec) / analyze_history
/// (dry), NEVER scan_category.
#[test]
fn test_run_policy_history_special_case() {
    let tmp = TempDir::new("history");
    let root = tmp.path().to_string_lossy().into_owned();
    let app_tmp = TempDir::new("history-app");
    let app_data = app_tmp.path().to_string_lossy().into_owned();
    let now = test_now().with_timezone(&Utc);
    let pol = policy(&[("history", enabled_cat())], 30);

    let prune_calls = Rc::new(Cell::new(0i64));
    let analyze_calls = Rc::new(Cell::new(0i64));
    let rec = Rc::new(RefCell::new(RecorderState::default()));
    let mut opts = base_opts(&root, &app_data, now, pol, rec.clone());
    let pc = prune_calls.clone();
    opts.prune_history = Box::new(move || {
        pc.set(pc.get() + 1);
        Ok(7)
    });
    let ac = analyze_calls.clone();
    opts.analyze_history = Box::new(move || {
        ac.set(ac.get() + 1);
        Ok(0)
    });

    // Execute: prune called, analyze not.
    let (report, result) = run_policy(&opts, &no_cancel());
    assert!(result.is_ok(), "unexpected error: {result:?}");
    assert_eq!(prune_calls.get(), 1, "exec must prune");
    assert_eq!(analyze_calls.get(), 0, "exec must not analyze");
    assert_eq!(report.categories.len(), 1);
    assert_eq!(report.categories[0].id, "history");
    assert_eq!(report.categories[0].count, 7);
    assert_eq!(rec.borrow().trash_calls.len(), 0, "history skips the trash loop");

    // Dry-run: analyze called, prune not.
    prune_calls.set(0);
    analyze_calls.set(0);
    opts.dry_run = true;
    let (_r2, result2) = run_policy(&opts, &no_cancel());
    assert!(result2.is_ok(), "unexpected error: {result2:?}");
    assert_eq!(analyze_calls.get(), 1, "dry-run must analyze");
    assert_eq!(prune_calls.get(), 0, "dry-run must not prune");
}

/// A cancel mid-pass leaves already-processed categories done and returns the
/// partial report + Cancelled.
#[test]
fn test_run_policy_cancel_between_categories() {
    let tmp = TempDir::new("cancel");
    let root = tmp.path();
    let app_tmp = TempDir::new("cancel-app");
    let app_data = app_tmp.path().to_string_lossy().into_owned();
    let now_local = test_now();
    let now = now_local.with_timezone(&Utc);
    // Two enabled categories; sorted order is plans < transcripts.
    write_file(&root.join("plans").join("foo.md"), "plan");
    write_aged(
        &root.join("transcripts").join("ses_a.jsonl"),
        "aaaa",
        days_before(now_local, 100),
    );

    let pol = policy(
        &[("plans", enabled_cat()), ("transcripts", enabled_cat())],
        30,
    );
    let cancel = Rc::new(Cell::new(false));
    let rec = Rc::new(RefCell::new(RecorderState::default()));
    let mut opts = base_opts(&root.to_string_lossy(), &app_data, now, pol, rec.clone());
    // Cancel right after the first category (plans) is trashed.
    let rec_t = rec.clone();
    let cancel_t = cancel.clone();
    opts.trash = Box::new(move |paths| {
        {
            let mut s = rec_t.borrow_mut();
            s.trash_calls.push(paths.to_vec());
            s.ops.push("trash");
        }
        cancel_t.set(true);
        Ok(())
    });
    opts.empty_trash = Box::new(|ids| panic!("expiry must not run after cancel, got {ids:?}"));

    let cancel_c = cancel.clone();
    let (report, result) = run_policy(&opts, &move || cancel_c.get());
    assert!(
        matches!(result, Err(PolicyError::Cancelled)),
        "want Cancelled, got {result:?}"
    );

    let s = rec.borrow();
    assert_eq!(
        s.trash_calls.len(),
        1,
        "only the first category should have trashed"
    );
    assert_eq!(report.categories.len(), 1);
    assert_eq!(report.categories[0].id, "plans");
    assert!(
        !any_path_contains(&s.trash_calls, "transcripts"),
        "transcripts must not be trashed after cancel"
    );
}

/// RunPolicy derives spec.cutoff from cutoff_for (the single source) — editing
/// the cutoff moves the executed window, so preview == execution.
#[test]
fn test_run_policy_cutoff_through_single_source() {
    let tmp = TempDir::new("cutoff");
    let root = tmp.path();
    let app_tmp = TempDir::new("cutoff-app");
    let app_data = app_tmp.path().to_string_lossy().into_owned();
    let now = test_now().with_timezone(&Utc);
    write_file(&root.join("transcripts").join("ses_a.jsonl"), "aaaa");

    let pol = policy(&[("transcripts", enabled_cat())], 30);
    let root_str = root.to_string_lossy().into_owned();

    let run = |days: i64| -> Option<DateTime<Utc>> {
        let captured: Rc<Cell<Option<DateTime<Utc>>>> = Rc::new(Cell::new(None));
        let rec = Rc::new(RefCell::new(RecorderState::default()));
        let mut opts = base_opts(&root_str, &app_data, now, pol.clone(), rec);
        opts.dry_run = true;
        opts.cutoff_for = Box::new(move |_id| days);
        let cap = captured.clone();
        opts.enrich = Some(Box::new(move |id, spec| {
            if id == "transcripts" {
                cap.set(spec.cutoff);
            }
        }));
        let (_report, result) = run_policy(&opts, &no_cancel());
        assert!(result.is_ok(), "unexpected error: {result:?}");
        captured.get()
    };

    assert_eq!(
        run(45),
        Some(now - Duration::days(45)),
        "cutoff for 45d"
    );
    assert_eq!(
        run(10),
        Some(now - Duration::days(10)),
        "edited cutoff to 10d must move the window"
    );
}
