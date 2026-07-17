//! Ports `settings_generations_test.go` — allowlisted restore round-trips.
//! `$HOME` is redirected to a temp dir (never the real `~/.claude`).

use crate::files::settings_write::test_home::{redirect_home, write_settings_file};

use super::{read_settings_generation, restore_settings_generation};

#[test]
fn restore_round_trip() {
    let h = redirect_home();
    let dir = h.claude_dir.clone();
    let settings_file = dir.join("settings.json");
    let bak_file = dir.join("settings.json.bak");
    let current = r#"{"theme":"dark","model":"opus"}"#;
    let generation = r#"{"theme":"light"}"#;
    write_settings_file(&dir, &settings_file, current);
    write_settings_file(&dir, &dir.join("settings.json.pre-ponytail"), generation);

    restore_settings_generation("settings.json.pre-ponytail").expect("restore");

    assert_eq!(std::fs::read_to_string(&settings_file).unwrap(), generation);
    assert_eq!(std::fs::read_to_string(&bak_file).unwrap(), current);
    drop(h);
}

// A corrupt CURRENT settings.json is exactly what restore exists to fix; it must
// succeed and preserve the corrupt bytes in .bak.
#[test]
fn restore_over_corrupt_current() {
    let h = redirect_home();
    let dir = h.claude_dir.clone();
    let settings_file = dir.join("settings.json");
    let bak_file = dir.join("settings.json.bak");
    let corrupt = "{not valid json";
    let generation = r#"{"theme":"light"}"#;
    write_settings_file(&dir, &settings_file, corrupt);
    write_settings_file(&dir, &bak_file, generation); // restore from .bak

    restore_settings_generation("settings.json.bak").expect("restore must fix a corrupt current");

    assert_eq!(std::fs::read_to_string(&settings_file).unwrap(), generation);
    assert_eq!(
        std::fs::read_to_string(&bak_file).unwrap(),
        corrupt,
        ".bak should preserve the corrupt bytes for recovery"
    );
    drop(h);
}

#[test]
fn restore_corrupt_generation_refused() {
    let h = redirect_home();
    let dir = h.claude_dir.clone();
    let settings_file = dir.join("settings.json");
    let current = r#"{"theme":"dark"}"#;
    write_settings_file(&dir, &settings_file, current);
    write_settings_file(&dir, &dir.join("settings.json.pre-ponytail"), "{bad");

    assert!(
        restore_settings_generation("settings.json.pre-ponytail").is_err(),
        "restoring a corrupt generation must error"
    );
    assert_eq!(
        std::fs::read_to_string(&settings_file).unwrap(),
        current,
        "settings.json must be untouched when the generation is corrupt"
    );
    drop(h);
}

#[test]
fn generation_allowlist() {
    let h = redirect_home();
    assert!(
        read_settings_generation("../../etc/passwd").is_err(),
        "non-allowlisted name must be refused"
    );
    assert!(
        restore_settings_generation("settings.json").is_err(),
        "restoring settings.json onto itself must be refused"
    );
    drop(h);
}
