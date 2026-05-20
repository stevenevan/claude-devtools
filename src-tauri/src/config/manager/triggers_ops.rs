use serde_json::Value;

use super::ConfigState;
use super::super::triggers;
use super::super::types::{AppConfig, NotificationTrigger};
use super::merge_helpers::merge_trigger_updates;

impl ConfigState {
    pub fn add_trigger(&mut self, trigger: NotificationTrigger) -> Result<AppConfig, String> {
        if self
            .config
            .notifications
            .triggers
            .iter()
            .any(|t| t.id == trigger.id)
        {
            return Err(format!("Trigger with ID \"{}\" already exists", trigger.id));
        }

        triggers::validate_trigger(&trigger).map_err(|errs| errs.join(", "))?;

        self.config.notifications.triggers.push(trigger);
        self.save_config();
        Ok(self.get_config())
    }

    pub fn update_trigger(
        &mut self,
        trigger_id: &str,
        updates: &Value,
    ) -> Result<AppConfig, String> {
        let idx = self
            .config
            .notifications
            .triggers
            .iter()
            .position(|t| t.id == trigger_id)
            .ok_or_else(|| format!("Trigger with ID \"{trigger_id}\" not found"))?;

        let mut updated = self.config.notifications.triggers[idx].clone();
        if let Some(obj) = updates.as_object() {
            merge_trigger_updates(&mut updated, obj);
        }

        if updated.mode.is_empty() {
            updated.mode = triggers::infer_mode(&updated);
        }

        triggers::validate_trigger(&updated).map_err(|errs| errs.join(", "))?;

        self.config.notifications.triggers[idx] = updated;
        self.save_config();
        Ok(self.get_config())
    }

    pub fn remove_trigger(&mut self, trigger_id: &str) -> Result<AppConfig, String> {
        let trigger = self
            .config
            .notifications
            .triggers
            .iter()
            .find(|t| t.id == trigger_id)
            .ok_or_else(|| format!("Trigger with ID \"{trigger_id}\" not found"))?;

        if trigger.is_builtin == Some(true) {
            return Err("Cannot remove built-in triggers. Disable them instead.".to_string());
        }

        self.config
            .notifications
            .triggers
            .retain(|t| t.id != trigger_id);
        self.save_config();
        Ok(self.get_config())
    }

    pub fn get_triggers(&self) -> Vec<NotificationTrigger> {
        self.config.notifications.triggers.clone()
    }
}
