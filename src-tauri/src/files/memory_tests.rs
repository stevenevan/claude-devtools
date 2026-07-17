//! Ports `internal/files/memory_test.go` — the read/integrity + write cases for
//! the memory family (Go tests both memory.go and memory_write.go in one file).
//! `tempfile` is not a dep → use `std::env::temp_dir()` + a unique, canonicalized
//! subdir (never touches real `~/.claude` files).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::files::memory_write::{apply_memory_index_fix, read_memory_file, write_memory_file};

// validEncodedID passes is_valid_project_id (leading "-", encoded path).
const VALID_ENCODED_ID: &str = "-tmp-fixture-proj";

// MEMORY_INDEX is the fixture MEMORY.md: fact_a/fact_c/fact_d are valid entries,
// missing.md is a DANGLING-INDEX entry. fact_b.md is deliberately absent from the
// index so it is the ONLY orphan.
const MEMORY_INDEX: &str = "# Memory Index\n\n## Feedback\n- [fact_a.md](fact_a.md) — Fact A description\n\n## Project\n- [fact_c.md](fact_c.md) — Fact C\n- [fact_d.md](fact_d.md) — Fact D\n- [missing.md](missing.md) — dangling entry\n";

const FACT_A: &str = "---\nname: fact-a\ndescription: Fact A description\ntype: feedback\n---\n\nBody of A with a [[does-not-exist]] dangling link.\n";
const FACT_B: &str = "---\nname: fact-b\ndescription: Fact B description\ntype: feedback\n---\n\nBody of B (orphan — on disk, not in the index).\n";
const FACT_C: &str = "---\nname: dupe-name\ndescription: Fact C\ntype: project\n---\n\nBody of C.\n";
const FACT_D: &str = "---\nname: dupe-name\ndescription: Fact D\ntype: project\n---\n\nBody of D.\n";

fn make_temp_root() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("memory-test-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

/// Lays down `<root>/projects/<validEncodedID>/memory/` with the MEMORY.md index
/// + fact files exercising all four finding kinds. Returns (root, dirID, memDir).
fn build_memory_fixture() -> (String, String, String) {
    let root = make_temp_root();
    let dir_id = format!("project:{VALID_ENCODED_ID}");
    let mem_dir = root.join("projects").join(VALID_ENCODED_ID).join("memory");
    fs::create_dir_all(&mem_dir).unwrap();
    for (name, content) in [
        ("MEMORY.md", MEMORY_INDEX),
        ("fact_a.md", FACT_A),
        ("fact_b.md", FACT_B),
        ("fact_c.md", FACT_C),
        ("fact_d.md", FACT_D),
    ] {
        fs::write(mem_dir.join(name), content).unwrap();
    }
    (
        root.to_string_lossy().into_owned(),
        dir_id,
        mem_dir.to_string_lossy().into_owned(),
    )
}

fn finding_by_kind<'a>(findings: &'a [MemoryFinding], kind: &str) -> Option<&'a MemoryFinding> {
    findings.iter().find(|f| f.kind == kind)
}

#[test]
fn memory_integrity_finds_all_four_kinds() {
    let (root, dir_id, _) = build_memory_fixture();
    let report = memory_integrity(&root, &dir_id).expect("MemoryIntegrity");

    let orphan = finding_by_kind(&report.findings, "orphan-file").expect("orphan-file finding");
    assert_eq!(orphan.file, "fact_b.md");
    let fix = orphan.fix.as_ref().expect("orphan fix");
    assert_eq!(fix.op, "add");

    let dang_idx =
        finding_by_kind(&report.findings, "dangling-index").expect("dangling-index finding");
    let dfix = dang_idx.fix.as_ref().expect("dangling-index fix");
    assert_eq!(dfix.op, "remove");
    // The remove Line must be a VERBATIM MEMORY.md line so removal is byte-exact.
    assert!(
        MEMORY_INDEX.contains(&dfix.line),
        "dangling-index Fix.Line is not a verbatim MEMORY.md line"
    );
    assert_eq!(dang_idx.file, "missing.md");

    let dang_link =
        finding_by_kind(&report.findings, "dangling-link").expect("dangling-link finding");
    assert!(dang_link.fix.is_none(), "dangling-link Fix must be nil");

    let dup = finding_by_kind(&report.findings, "duplicate-slug").expect("duplicate-slug finding");
    assert!(dup.fix.is_none(), "duplicate-slug Fix must be nil");
}

#[test]
fn memory_integrity_ignores_backups_and_dotfiles() {
    let (root, dir_id, mem_dir) = build_memory_fixture();
    for name in [
        "fact_a.md.bak",
        "fact_a.md.tmp",
        ".DS_Store",
        ".consolidate-lock",
    ] {
        fs::write(Path::new(&mem_dir).join(name), "junk").unwrap();
    }

    let report = memory_integrity(&root, &dir_id).expect("MemoryIntegrity");
    for f in &report.findings {
        if f.kind == "orphan-file" {
            assert_eq!(f.file, "fact_b.md", "only fact_b.md may be an orphan");
        }
    }
}

#[test]
fn apply_memory_index_fix_add_orphan() {
    let (root, dir_id, mem_dir) = build_memory_fixture();
    let index_path = Path::new(&mem_dir).join("MEMORY.md");

    let report = memory_integrity(&root, &dir_id).expect("MemoryIntegrity");
    let orphan = finding_by_kind(&report.findings, "orphan-file").expect("orphan finding");
    let fix = orphan.fix.clone().expect("orphan fix");

    apply_memory_index_fix(&root, &dir_id, &fix).expect("ApplyMemoryIndexFix(add)");

    let got = fs::read_to_string(&index_path).expect("read index");
    let want = format!("{MEMORY_INDEX}{}\n", fix.line);
    assert_eq!(got, want, "index after add not byte-exact");
    assert!(got.starts_with(MEMORY_INDEX), "all prior bytes preserved");
    let added = got.matches('\n').count() as i64 - MEMORY_INDEX.matches('\n').count() as i64;
    assert_eq!(added, 1, "index must gain exactly 1 line");
}

#[test]
fn apply_memory_index_fix_remove_dangling() {
    let (root, dir_id, mem_dir) = build_memory_fixture();
    let index_path = Path::new(&mem_dir).join("MEMORY.md");

    let report = memory_integrity(&root, &dir_id).expect("MemoryIntegrity");
    let dang = finding_by_kind(&report.findings, "dangling-index").expect("dangling-index finding");
    let fix = dang.fix.clone().expect("dangling fix");

    apply_memory_index_fix(&root, &dir_id, &fix).expect("ApplyMemoryIndexFix(remove)");

    let got = fs::read_to_string(&index_path).expect("read index");
    let want = MEMORY_INDEX.replacen(&format!("{}\n", fix.line), "", 1);
    assert_eq!(got, want, "index after remove not byte-exact");
    assert!(!got.contains("missing.md"), "removed dangling line must be gone");
}

#[test]
fn apply_memory_index_fix_rejects_stale() {
    let (root, dir_id, _) = build_memory_fixture();
    // A fabricated fix that matches no finding must be refused.
    let bogus = MemoryIndexFix {
        op: "add".to_string(),
        line: "- [evil.md](evil.md) — injected".to_string(),
    };
    assert!(
        apply_memory_index_fix(&root, &dir_id, &bogus).is_err(),
        "must reject a fix with no matching finding"
    );
}

#[test]
fn write_memory_file_round_trips() {
    let (root, dir_id, mem_dir) = build_memory_fixture();

    let edited = "---\nname: fact-a-edited\ndescription: edited\ntype: feedback\n---\n\nedited body\n";
    write_memory_file(&root, &dir_id, "fact_a.md", edited.as_bytes()).expect("WriteMemoryFile");

    let got = read_memory_file(&root, &dir_id, "fact_a.md").expect("ReadMemoryFile");
    assert_eq!(got, edited, "fact file not byte-faithful");

    // .bak preserves the original bytes.
    let bak = fs::read_to_string(Path::new(&mem_dir).join("fact_a.md.bak")).expect("read .bak");
    assert_eq!(bak, FACT_A, ".bak must be the original");

    // Frontmatter re-parses to the edited name.
    let report = memory_integrity(&root, &dir_id).expect("MemoryIntegrity");
    let name = report
        .files
        .iter()
        .find(|f| f.file_name == "fact_a.md")
        .map(|f| f.name.clone())
        .unwrap_or_default();
    assert_eq!(name, "fact-a-edited");
}

#[test]
fn resolve_memory_dir_rejects_bad_ids() {
    let (root, _, _) = build_memory_fixture();
    for dir_id in [
        "bogus:x",
        "project:../evil",
        "agent:../x",
        "project:evil-no-dash",
    ] {
        assert!(
            resolve_memory_dir(&root, dir_id).is_err(),
            "ResolveMemoryDir({dir_id}) must be rejected"
        );
    }
}

#[test]
fn resolve_memory_dir_rejects_missing_dir() {
    let (root, _, _) = build_memory_fixture();
    // A valid-looking project ID whose projects/<encoded> parent doesn't exist
    // must be rejected (confine-parent-must-exist, no scan).
    assert!(
        resolve_memory_dir(&root, "project:-tmp-does-not-exist-xyz").is_err(),
        "ResolveMemoryDir for a non-existent dir must be rejected"
    );
}

#[test]
fn memory_writes_refused_under_consolidation_lock() {
    let (root, dir_id, mem_dir) = build_memory_fixture();
    fs::write(Path::new(&mem_dir).join(".consolidate-lock"), b"").unwrap();

    assert!(
        write_memory_file(&root, &dir_id, "fact_a.md", b"nope\n").is_err(),
        "WriteMemoryFile must refuse while .consolidate-lock is present"
    );
    let fix = MemoryIndexFix {
        op: "add".to_string(),
        line: "- [x.md](x.md) — x".to_string(),
    };
    assert!(
        apply_memory_index_fix(&root, &dir_id, &fix).is_err(),
        "ApplyMemoryIndexFix must refuse while .consolidate-lock is present"
    );
}
