use std::collections::HashSet;

use super::ConfigState;
use super::super::types::{BookmarkEntry, HiddenSession, PinnedSession, SshLastConnection};
use super::merge_helpers::now_millis;

impl ConfigState {
    // =========================================================================
    // Session Pinning
    // =========================================================================

    pub fn pin_session(&mut self, project_id: &str, session_id: &str) {
        let pins = self
            .config
            .sessions
            .pinned_sessions
            .entry(project_id.to_string())
            .or_default();

        if pins.iter().any(|p| p.session_id == session_id) {
            return;
        }

        pins.insert(
            0,
            PinnedSession {
                session_id: session_id.to_string(),
                pinned_at: now_millis(),
            },
        );
        self.save_config();
    }

    pub fn unpin_session(&mut self, project_id: &str, session_id: &str) {
        if let Some(pins) = self.config.sessions.pinned_sessions.get_mut(project_id) {
            pins.retain(|p| p.session_id != session_id);
            if pins.is_empty() {
                self.config.sessions.pinned_sessions.remove(project_id);
            }
            self.save_config();
        }
    }

    // =========================================================================
    // Session Hiding
    // =========================================================================

    pub fn hide_session(&mut self, project_id: &str, session_id: &str) {
        let hidden = self
            .config
            .sessions
            .hidden_sessions
            .entry(project_id.to_string())
            .or_default();

        if hidden.iter().any(|h| h.session_id == session_id) {
            return;
        }

        hidden.insert(
            0,
            HiddenSession {
                session_id: session_id.to_string(),
                hidden_at: now_millis(),
            },
        );
        self.save_config();
    }

    pub fn unhide_session(&mut self, project_id: &str, session_id: &str) {
        if let Some(hidden) = self.config.sessions.hidden_sessions.get_mut(project_id) {
            hidden.retain(|h| h.session_id != session_id);
            if hidden.is_empty() {
                self.config.sessions.hidden_sessions.remove(project_id);
            }
            self.save_config();
        }
    }

    pub fn hide_sessions(&mut self, project_id: &str, session_ids: &[String]) {
        let hidden = self
            .config
            .sessions
            .hidden_sessions
            .entry(project_id.to_string())
            .or_default();

        let existing: HashSet<&str> = hidden.iter().map(|h| h.session_id.as_str()).collect();
        let now = now_millis();

        let mut new_entries: Vec<HiddenSession> = session_ids
            .iter()
            .filter(|id| !existing.contains(id.as_str()))
            .map(|id| HiddenSession {
                session_id: id.clone(),
                hidden_at: now,
            })
            .collect();

        if new_entries.is_empty() {
            return;
        }

        new_entries.append(hidden);
        *hidden = new_entries;
        self.save_config();
    }

    pub fn unhide_sessions(&mut self, project_id: &str, session_ids: &[String]) {
        if let Some(hidden) = self.config.sessions.hidden_sessions.get_mut(project_id) {
            let to_remove: HashSet<&str> = session_ids.iter().map(|s| s.as_str()).collect();
            hidden.retain(|h| !to_remove.contains(h.session_id.as_str()));
            if hidden.is_empty() {
                self.config.sessions.hidden_sessions.remove(project_id);
            }
            self.save_config();
        }
    }

    // =========================================================================
    // SSH Last Connection
    // =========================================================================

    pub fn update_ssh_last_connection(&mut self, last_connection: Option<SshLastConnection>) {
        self.config.ssh.last_connection = last_connection;
        self.save_config();
    }

    // =========================================================================
    // Bookmarks
    // =========================================================================

    pub fn add_bookmark(&mut self, entry: BookmarkEntry) {
        self.config.sessions.bookmarks.push(entry);
        self.save_config();
    }

    pub fn remove_bookmark(&mut self, bookmark_id: &str) {
        self.config.sessions.bookmarks.retain(|b| b.id != bookmark_id);
        self.save_config();
    }

    pub fn get_bookmarks(&self) -> &[BookmarkEntry] {
        &self.config.sessions.bookmarks
    }
}
