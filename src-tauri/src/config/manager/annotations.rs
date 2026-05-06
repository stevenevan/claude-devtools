use super::ConfigState;
use super::now_millis;
use crate::config::types::{
    AnnotationEntry, AnnotationExportBundle, BookmarkEntry, FilterPreset, ImportReport,
};

impl ConfigState {
    // =========================================================================
    // Annotations
    // =========================================================================

    pub fn add_annotation(&mut self, entry: AnnotationEntry) {
        self.config.sessions.annotations.push(entry);
        self.save_config();
    }

    pub fn update_annotation(
        &mut self,
        annotation_id: &str,
        text: Option<String>,
        color: Option<String>,
        updated_at: f64,
    ) -> bool {
        let Some(entry) = self
            .config
            .sessions
            .annotations
            .iter_mut()
            .find(|a| a.id == annotation_id)
        else {
            return false;
        };
        if let Some(t) = text {
            entry.text = t;
        }
        if let Some(c) = color {
            entry.color = c;
        }
        entry.updated_at = updated_at;
        self.save_config();
        true
    }

    pub fn remove_annotation(&mut self, annotation_id: &str) {
        self.config
            .sessions
            .annotations
            .retain(|a| a.id != annotation_id);
        self.save_config();
    }

    pub fn get_annotations(&self) -> &[AnnotationEntry] {
        &self.config.sessions.annotations
    }

    // =========================================================================
    // Session Tags
    // =========================================================================

    pub fn set_session_tags(&mut self, session_id: &str, tags: Vec<String>) {
        if tags.is_empty() {
            self.config.sessions.session_tags.remove(session_id);
        } else {
            self.config.sessions.session_tags.insert(session_id.to_string(), tags);
        }
        self.save_config();
    }

    pub fn get_session_tags(&self, session_id: &str) -> Vec<String> {
        self.config.sessions.session_tags.get(session_id).cloned().unwrap_or_default()
    }

    // =========================================================================
    // Session Groups
    // =========================================================================

    pub fn create_session_group(&mut self, name: &str) -> bool {
        if self.config.sessions.session_groups.contains_key(name) {
            return false;
        }
        self.config
            .sessions
            .session_groups
            .insert(name.to_string(), vec![]);
        self.save_config();
        true
    }

    pub fn delete_session_group(&mut self, name: &str) {
        self.config.sessions.session_groups.remove(name);
        self.save_config();
    }

    pub fn add_to_session_group(&mut self, name: &str, session_id: &str) {
        let entry = self
            .config
            .sessions
            .session_groups
            .entry(name.to_string())
            .or_default();
        if !entry.iter().any(|s| s == session_id) {
            entry.push(session_id.to_string());
            self.save_config();
        }
    }

    pub fn remove_from_session_group(&mut self, name: &str, session_id: &str) {
        if let Some(entry) = self.config.sessions.session_groups.get_mut(name) {
            entry.retain(|s| s != session_id);
            self.save_config();
        }
    }

    pub fn get_session_groups(&self) -> &std::collections::HashMap<String, Vec<String>> {
        &self.config.sessions.session_groups
    }

    // =========================================================================
    // Filter Presets
    // =========================================================================

    pub fn add_filter_preset(&mut self, preset: FilterPreset) {
        self.config.sessions.filter_presets.push(preset);
        self.save_config();
    }

    pub fn remove_filter_preset(&mut self, preset_id: &str) {
        self.config
            .sessions
            .filter_presets
            .retain(|p| p.id != preset_id);
        if self.config.sessions.default_filter_preset_id.as_deref() == Some(preset_id) {
            self.config.sessions.default_filter_preset_id = None;
        }
        self.save_config();
    }

    pub fn rename_filter_preset(&mut self, preset_id: &str, name: &str) -> bool {
        let Some(preset) = self
            .config
            .sessions
            .filter_presets
            .iter_mut()
            .find(|p| p.id == preset_id)
        else {
            return false;
        };
        preset.name = name.to_string();
        self.save_config();
        true
    }

    pub fn set_default_filter_preset(&mut self, preset_id: Option<String>) {
        if let Some(ref id) = preset_id {
            if !self.config.sessions.filter_presets.iter().any(|p| &p.id == id) {
                return;
            }
        }
        self.config.sessions.default_filter_preset_id = preset_id;
        self.save_config();
    }

    // =========================================================================
    // Annotation/Bookmark Export/Import
    // =========================================================================

    pub fn export_annotations_bundle(
        &self,
        session_ids: &[String],
    ) -> AnnotationExportBundle {
        let session_set: std::collections::HashSet<&str> =
            session_ids.iter().map(|s| s.as_str()).collect();
        let want_all = session_set.is_empty();

        let annotations: Vec<AnnotationEntry> = self
            .config
            .sessions
            .annotations
            .iter()
            .filter(|a| want_all || session_set.contains(a.session_id.as_str()))
            .cloned()
            .collect();
        let bookmarks: Vec<BookmarkEntry> = self
            .config
            .sessions
            .bookmarks
            .iter()
            .filter(|b| want_all || session_set.contains(b.session_id.as_str()))
            .cloned()
            .collect();

        AnnotationExportBundle {
            version: 1,
            exported_at: now_millis(),
            annotations,
            bookmarks,
        }
    }

    pub fn import_annotations_bundle(
        &mut self,
        bundle: AnnotationExportBundle,
    ) -> ImportReport {
        let mut report = ImportReport::default();

        for incoming in bundle.annotations {
            let existing_idx = self
                .config
                .sessions
                .annotations
                .iter()
                .position(|a| a.session_id == incoming.session_id && a.target_id == incoming.target_id);
            match existing_idx {
                Some(idx) => {
                    let existing = &self.config.sessions.annotations[idx];
                    if incoming.updated_at > existing.updated_at {
                        self.config.sessions.annotations[idx] = incoming;
                        report.annotations_updated += 1;
                    } else {
                        report.annotations_skipped += 1;
                    }
                }
                None => {
                    self.config.sessions.annotations.push(incoming);
                    report.annotations_added += 1;
                }
            }
        }

        for incoming in bundle.bookmarks {
            let exists = self
                .config
                .sessions
                .bookmarks
                .iter()
                .any(|b| b.session_id == incoming.session_id && b.group_id == incoming.group_id);
            if exists {
                report.bookmarks_skipped += 1;
            } else {
                self.config.sessions.bookmarks.push(incoming);
                report.bookmarks_added += 1;
            }
        }

        self.save_config();
        report
    }
}
