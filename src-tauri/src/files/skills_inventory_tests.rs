//! Ports `internal/files/skills_inventory_test.go` — the canonical symlink-safety
//! assertions. The two Go cases that round-trip through `maintenance.TrashItems`/
//! `RestoreTrash` are adapted to exercise the exported resolver + a hand-rolled
//! rename (the maintenance module is out of scope this week), still pinning the
//! load-bearing invariant: `resolve_skill_link_path` returns the LINK entry, so a
//! trash move relocates the link — NEVER the out-of-root target.
//! `tempfile` is not a dep → use `std::env::temp_dir()` + a unique, canonicalized
//! subdir (never touches real `~/.claude` files).

use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

const ALPHA_SKILL_MD: &str =
    "---\nname: alpha\ndescription: The alpha skill for testing\n---\n\n# Alpha\n\nThe alpha skill body.\n";

struct SkillsFixture {
    root: String,        // the EffectivePath-style claude root
    realrepo: String,    // out-of-root dir gamma points at (must survive a link move)
    gamma_target: String, // the raw symlink text of gamma (relative, out-of-root)
    beta_target: String, // the raw symlink text of beta (== shared, in-root)
}

fn make_temp_base() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("skills-test-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    fs::canonicalize(&dir).unwrap()
}

/// Lays down: a REAL skill dir alpha (SKILL.md + references/), a real utility dir
/// shared (no SKILL.md), an IN-ROOT symlink beta -> shared, an OUT-OF-ROOT
/// relative symlink gamma -> ../../realrepo, and a .DS_Store dotfile to skip.
fn build_skills_fixture() -> SkillsFixture {
    let base = make_temp_base();
    let root = base.join("claude");
    let skills = root.join("skills");

    let alpha = skills.join("alpha");
    fs::create_dir_all(alpha.join("references")).unwrap();
    fs::write(alpha.join("SKILL.md"), ALPHA_SKILL_MD).unwrap();
    fs::write(alpha.join("references").join("ref.md"), "reference body\n").unwrap();

    let shared = skills.join("shared");
    fs::create_dir_all(&shared).unwrap();
    fs::write(shared.join("helper.txt"), "helper\n").unwrap();

    symlink(&shared, skills.join("beta")).unwrap();

    let realrepo = base.join("realrepo");
    fs::create_dir_all(&realrepo).unwrap();
    fs::write(realrepo.join("sentinel.txt"), "do not touch\n").unwrap();
    let gamma_target = Path::new("..").join("..").join("realrepo");
    symlink(&gamma_target, skills.join("gamma")).unwrap();

    fs::write(skills.join(".DS_Store"), "junk\n").unwrap();

    SkillsFixture {
        root: root.to_string_lossy().into_owned(),
        realrepo: realrepo.to_string_lossy().into_owned(),
        gamma_target: gamma_target.to_string_lossy().into_owned(),
        beta_target: shared.to_string_lossy().into_owned(),
    }
}

fn find_entry(entries: &[SkillInventoryEntry], name: &str) -> SkillInventoryEntry {
    entries
        .iter()
        .find(|e| e.name == name)
        .cloned()
        .unwrap_or_else(|| panic!("entry {name} not found in inventory"))
}

#[test]
fn skills_inventory_classifies_entries() {
    let fx = build_skills_fixture();

    let entries = skills_inventory(&fx.root).expect("SkillsInventory");
    assert_eq!(
        entries.len(),
        4,
        "want 4 entries (alpha, beta, gamma, shared), got {entries:?}"
    );
    for e in &entries {
        assert_ne!(e.name, ".DS_Store", "dotfile .DS_Store must be skipped");
    }

    let alpha = find_entry(&entries, "alpha");
    assert!(!alpha.is_symlink, "alpha is a real dir");
    assert!(alpha.has_skill_md, "alpha has a SKILL.md");
    assert!(alpha.has_references, "alpha has references/");
    assert_eq!(alpha.description, "The alpha skill for testing");

    let beta = find_entry(&entries, "beta");
    assert!(beta.is_symlink, "beta is a symlink");
    assert_eq!(beta.symlink_target, fx.beta_target);
    assert!(
        !beta.has_references,
        "beta resolves to shared (no references)"
    );

    let gamma = find_entry(&entries, "gamma");
    assert!(gamma.is_symlink, "gamma is a symlink");
    assert_eq!(gamma.symlink_target, fx.gamma_target);

    let shared = find_entry(&entries, "shared");
    assert!(!shared.is_symlink, "shared is a real dir");
    assert!(!shared.has_skill_md, "shared has no SKILL.md");
}

#[test]
fn write_skill_doc_refuses_symlink_and_missing_skill_md() {
    let fx = build_skills_fixture();

    assert!(
        write_skill_doc(&fx.root, "gamma", b"nope\n").is_err(),
        "WriteSkillDoc through a symlinked skill must be refused"
    );
    // The out-of-root target must be wholly untouched by the refused write.
    assert!(
        Path::new(&fx.realrepo).join("sentinel.txt").exists(),
        "refused symlink write must not touch the out-of-root target"
    );

    assert!(
        write_skill_doc(&fx.root, "shared", b"nope\n").is_err(),
        "WriteSkillDoc into a dir with no SKILL.md must be refused"
    );
    assert!(
        !Path::new(&fx.root)
            .join("skills")
            .join("shared")
            .join("SKILL.md")
            .exists(),
        "no SKILL.md may be fabricated in a non-skill dir"
    );
}

#[test]
fn write_skill_doc_round_trips_alpha() {
    let fx = build_skills_fixture();
    let skill_md = Path::new(&fx.root)
        .join("skills")
        .join("alpha")
        .join("SKILL.md");

    let new_content = "---\nname: alpha\ndescription: edited\n---\n\n# Edited\n\nnew body.\n";
    write_skill_doc(&fx.root, "alpha", new_content.as_bytes()).expect("WriteSkillDoc");

    let got = fs::read_to_string(&skill_md).expect("read SKILL.md");
    assert_eq!(got, new_content, "SKILL.md not written byte-faithfully");

    let mut bak_os = skill_md.clone().into_os_string();
    bak_os.push(".bak");
    let bak = fs::read_to_string(PathBuf::from(bak_os)).expect("read .bak");
    assert_eq!(bak, ALPHA_SKILL_MD, ".bak must be the original");
}

#[test]
fn resolve_skill_link_path_moves_link_not_target() {
    let fx = build_skills_fixture();

    let dest = resolve_skill_link_path(&fx.root, "gamma").expect("ResolveSkillLinkPath");
    let dest_path = Path::new(&dest);

    // CRITICAL: the resolved path is the LINK entry (NEVER canonicalized). A
    // canonicalized result would be realrepo (a real dir); this must be a symlink.
    let lst = fs::symlink_metadata(dest_path).expect("lstat gamma");
    assert!(
        lst.file_type().is_symlink(),
        "resolved link path must be the symlink, not its canonicalized target"
    );

    // Simulate the trash move: rename the link entry out of skills/.
    let moved = Path::new(&fx.realrepo)
        .parent()
        .unwrap()
        .join("gamma-trashed");
    fs::rename(dest_path, &moved).expect("rename link");

    // The out-of-root target is untouched.
    assert!(Path::new(&fx.realrepo).is_dir(), "realrepo must survive");
    let sentinel =
        fs::read_to_string(Path::new(&fx.realrepo).join("sentinel.txt")).expect("read sentinel");
    assert_eq!(sentinel, "do not touch\n");

    // The moved entry is still a symlink with the original raw target.
    let moved_lst = fs::symlink_metadata(&moved).expect("lstat moved");
    assert!(
        moved_lst.file_type().is_symlink(),
        "moved entry must still be a link, not a copied dir"
    );
    let target = fs::read_link(&moved).expect("readlink moved");
    assert_eq!(target.to_string_lossy(), fx.gamma_target);
}

#[test]
fn resolve_skill_dir_path_returns_real_dir_for_alpha() {
    let fx = build_skills_fixture();

    let dest = resolve_skill_dir_path(&fx.root, "alpha").expect("ResolveSkillDirPath");
    let lst = fs::symlink_metadata(&dest).expect("lstat alpha");
    assert!(!lst.file_type().is_symlink(), "alpha entry is a real dir");
    assert!(lst.is_dir(), "alpha entry is a directory");

    // References survive under the resolved dir (what a delete/restore round-trips).
    let ref_file = Path::new(&dest).join("references").join("ref.md");
    assert_eq!(fs::read_to_string(&ref_file).unwrap(), "reference body\n");
}
