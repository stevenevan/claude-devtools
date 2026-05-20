use super::super::types::AnnotationEntry;
use super::*;

fn temp_config() -> ConfigState {
    let tmp = std::env::temp_dir()
        .join(format!("cd-cfg-{}-{}", std::process::id(), now_millis() as u64));
    std::fs::create_dir_all(&tmp).unwrap();
    ConfigState::new_with_path(tmp.join("config.json"))
}

#[test]
fn annotation_crud_roundtrip() {
    let mut state = temp_config();
    assert!(state.get_annotations().is_empty());

    let entry = AnnotationEntry {
        id: "a1".to_string(),
        session_id: "s1".to_string(),
        project_id: "p1".to_string(),
        target_id: "t1".to_string(),
        text: "first".to_string(),
        color: "blue".to_string(),
        created_at: 1.0,
        updated_at: 1.0,
    };
    state.add_annotation(entry.clone());
    assert_eq!(state.get_annotations().len(), 1);
    assert_eq!(state.get_annotations()[0].text, "first");

    let updated =
        state.update_annotation("a1", Some("second".to_string()), Some("red".to_string()), 2.0);
    assert!(updated);
    assert_eq!(state.get_annotations()[0].text, "second");
    assert_eq!(state.get_annotations()[0].color, "red");
    assert_eq!(state.get_annotations()[0].updated_at, 2.0);

    assert!(!state.update_annotation("missing", Some("x".into()), None, 3.0));

    state.remove_annotation("a1");
    assert!(state.get_annotations().is_empty());
}

#[test]
fn import_annotations_resolves_conflict_by_newer_timestamp() {
    use super::super::types::{AnnotationExportBundle, BookmarkEntry};

    let mut state = temp_config();

    state.add_annotation(AnnotationEntry {
        id: "existing".to_string(),
        session_id: "s1".to_string(),
        project_id: "p1".to_string(),
        target_id: "t1".to_string(),
        text: "old".to_string(),
        color: "blue".to_string(),
        created_at: 1.0,
        updated_at: 10.0,
    });
    state.add_bookmark(BookmarkEntry {
        id: "bk1".to_string(),
        session_id: "s1".to_string(),
        project_id: "p1".to_string(),
        group_id: "g1".to_string(),
        note: None,
        created_at: 1.0,
    });

    let bundle = AnnotationExportBundle {
        version: 1,
        exported_at: 100.0,
        annotations: vec![
            AnnotationEntry {
                id: "incoming-newer".to_string(),
                session_id: "s1".to_string(),
                project_id: "p1".to_string(),
                target_id: "t1".to_string(),
                text: "new".to_string(),
                color: "green".to_string(),
                created_at: 5.0,
                updated_at: 20.0,
            },
            AnnotationEntry {
                id: "another-target".to_string(),
                session_id: "s1".to_string(),
                project_id: "p1".to_string(),
                target_id: "t2".to_string(),
                text: "fresh".to_string(),
                color: "red".to_string(),
                created_at: 50.0,
                updated_at: 50.0,
            },
        ],
        bookmarks: vec![
            BookmarkEntry {
                id: "bk-dup".to_string(),
                session_id: "s1".to_string(),
                project_id: "p1".to_string(),
                group_id: "g1".to_string(),
                note: None,
                created_at: 99.0,
            },
            BookmarkEntry {
                id: "bk-new".to_string(),
                session_id: "s2".to_string(),
                project_id: "p1".to_string(),
                group_id: "gX".to_string(),
                note: Some("note".to_string()),
                created_at: 99.0,
            },
        ],
    };

    let report = state.import_annotations_bundle(bundle);
    assert_eq!(report.annotations_updated, 1);
    assert_eq!(report.annotations_added, 1);
    assert_eq!(report.annotations_skipped, 0);
    assert_eq!(report.bookmarks_added, 1);
    assert_eq!(report.bookmarks_skipped, 1);

    let merged = state.get_annotations();
    let t1 = merged
        .iter()
        .find(|a| a.target_id == "t1")
        .expect("t1 present");
    assert_eq!(t1.text, "new");
    assert_eq!(t1.updated_at, 20.0);
}
