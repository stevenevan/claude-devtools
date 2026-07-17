//! Tauri command wrappers for the global-manager surfaces on `MaintenanceService`
//! (`agents.go` / `instructions.go` / `memory.go` / `skills.go`). Every method
//! threads the effective root; reads take no gate, writes serialize under `op` +
//! ssh-gate (no mute), and the DELETE methods resolve the confined path then
//! trash it (ssh-gated + muted) via `delete_via_trash`.

use std::fs;
use std::path::Path;

use super::service::Maint;
use crate::files::agents_write::{
    create_agent as create_agent_fn, patch_agent_frontmatter as patch_agent_fn,
    read_managed_agents, resolve_agent_path, AgentPatch, GlobalAgent,
};
use crate::files::memory::{list_memory_dirs as list_memory_dirs_fn, memory_integrity as memory_integrity_fn, MemoryDir, MemoryIndexFix, MemoryReport};
use crate::files::memory_write::{
    apply_memory_index_fix as apply_fix_fn, read_memory_file as read_memory_fn,
    resolve_memory_file_path, write_memory_file as write_memory_fn,
};
use crate::files::skills_inventory::{
    read_skill_doc as read_skill_fn, resolve_skill_dir_path, resolve_skill_link_path,
    skills_inventory as skills_inventory_fn, write_skill_doc as write_skill_fn,
    SkillInventoryEntry,
};
use crate::files::text_write::{
    list_instruction_files as list_instr_fn, read_text_file, resolve_instruction_path,
    write_text_file, InstructionFile,
};
use crate::maintenance::trash::TrashReceipt;

// ── agents.go ────────────────────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub fn list_managed_agents(state: Maint) -> Result<Vec<GlobalAgent>, String> {
    read_managed_agents(&state.effective_root())
}

#[tauri::command(rename_all = "camelCase")]
pub fn patch_agent_frontmatter(
    file_base: String,
    patch: AgentPatch,
    state: Maint,
) -> Result<(), String> {
    state.gated(|root| patch_agent_fn(root, &file_base, patch))
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_agent(name: String, description: String, state: Maint) -> Result<(), String> {
    state.gated(|root| create_agent_fn(root, &name, &description))
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_agent(
    file_base: String,
    app: tauri::AppHandle,
    state: Maint,
) -> Result<TrashReceipt, String> {
    state.delete_via_trash(&app, |root| resolve_agent_path(root, &file_base))
}

// ── instructions.go ──────────────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub fn list_instruction_files(state: Maint) -> Result<Vec<InstructionFile>, String> {
    list_instr_fn(&state.effective_root())
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_instruction_file(rel_path: String, state: Maint) -> Result<String, String> {
    let data = read_text_file(&state.effective_root(), &rel_path)?;
    Ok(String::from_utf8_lossy(&data).into_owned())
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_instruction_file(rel_path: String, content: String, state: Maint) -> Result<(), String> {
    state.gated(|root| write_text_file(root, &rel_path, content.as_bytes()))
}

/// SERVER-SIDE deletable allowlist (narrower than the editable allowlist): only
/// rules/commands/tools are deletable — CLAUDE.md/RTK.md never. Mirrors
/// `deletableInstructionPrefixes` / `isDeletableInstructionPath`.
fn is_deletable_instruction_path(rel_path: &str) -> bool {
    let cleaned = Path::new(rel_path);
    ["rules", "commands", "tools"].iter().any(|prefix| {
        cleaned == Path::new(prefix) || cleaned.starts_with(prefix)
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_instruction_file(
    rel_path: String,
    app: tauri::AppHandle,
    state: Maint,
) -> Result<TrashReceipt, String> {
    state.delete_via_trash(&app, |root| {
        if !is_deletable_instruction_path(&rel_path) {
            return Err(format!(
                "maintenanceservice: {rel_path:?} is not a deletable instruction file"
            ));
        }
        resolve_instruction_path(root, &rel_path)
    })
}

// ── memory.go ────────────────────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub fn list_memory_dirs(state: Maint) -> Result<Vec<MemoryDir>, String> {
    list_memory_dirs_fn(&state.effective_root())
}

#[tauri::command(rename_all = "camelCase")]
pub fn memory_integrity(dir_id: String, state: Maint) -> Result<MemoryReport, String> {
    memory_integrity_fn(&state.effective_root(), &dir_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_memory_file(dir_id: String, file_name: String, state: Maint) -> Result<String, String> {
    read_memory_fn(&state.effective_root(), &dir_id, &file_name)
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_memory_file(
    dir_id: String,
    file_name: String,
    content: String,
    state: Maint,
) -> Result<(), String> {
    state.gated(|root| write_memory_fn(root, &dir_id, &file_name, content.as_bytes()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn apply_memory_index_fix(
    dir_id: String,
    fix: MemoryIndexFix,
    state: Maint,
) -> Result<(), String> {
    state.gated(|root| apply_fix_fn(root, &dir_id, &fix))
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_memory_file(
    dir_id: String,
    file_name: String,
    app: tauri::AppHandle,
    state: Maint,
) -> Result<TrashReceipt, String> {
    state.delete_via_trash(&app, |root| resolve_memory_file_path(root, &dir_id, &file_name))
}

// ── skills.go ────────────────────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub fn skills_inventory(state: Maint) -> Result<Vec<SkillInventoryEntry>, String> {
    skills_inventory_fn(&state.effective_root())
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_skill_doc(skill_name: String, state: Maint) -> Result<String, String> {
    read_skill_fn(&state.effective_root(), &skill_name)
}

#[tauri::command(rename_all = "camelCase")]
pub fn write_skill_doc(skill_name: String, content: String, state: Maint) -> Result<(), String> {
    state.gated(|root| write_skill_fn(root, &skill_name, content.as_bytes()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn remove_skill_link(
    skill_name: String,
    app: tauri::AppHandle,
    state: Maint,
) -> Result<TrashReceipt, String> {
    state.delete_via_trash(&app, |root| resolve_skill_link_path(root, &skill_name))
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_skill(
    skill_name: String,
    app: tauri::AppHandle,
    state: Maint,
) -> Result<TrashReceipt, String> {
    state.delete_via_trash(&app, |root| {
        let dest = resolve_skill_dir_path(root, &skill_name)?;
        let lst = fs::symlink_metadata(&dest)
            .map_err(|e| format!("maintenanceservice: skill {skill_name:?}: {e}"))?;
        if lst.file_type().is_symlink() {
            return Err(format!(
                "maintenanceservice: skill {skill_name:?} is a symlink; use RemoveSkillLink to remove the link"
            ));
        }
        Ok(dest)
    })
}
