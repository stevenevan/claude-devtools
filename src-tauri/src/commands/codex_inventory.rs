//! Tauri boundary for the source-aware Codex instructions, agents, and skills
//! inventory.
//!
//! The renderer supplies only a global scope or a backend-issued project id.
//! A short-lived server-owned snapshot binds opaque record ids to validated
//! roots and relative paths for detail and write calls.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::commands::session as session_commands;
use crate::config::codex_context::{normalize_project_context, ResolvedCodexProjectContext};
use crate::config::root;
use crate::files::codex_agents::{self, AgentRecord};
use crate::files::codex_instructions::{self, InstructionRecord};
use crate::files::codex_inventory::{MAX_DETAIL_BYTES, MAX_INVENTORY_ITEMS, MAX_RESPONSE_BYTES};
use crate::files::codex_skills::{self, SkillRecord};
use crate::files::codex_text_write;
use crate::ssh::State as SshState;
use crate::types::codex_inventory::{
    CodexAgentDetail, CodexAgentList, CodexInstructionDetail, CodexInstructionList,
    CodexInventoryScope, CodexRecordKind, CodexSkillDetail, CodexSkillList, CodexTextApplyResult,
    CodexTextPreviewResult,
};

const SNAPSHOT_TTL: Duration = Duration::from_secs(300);
const MAX_RECORD_ID_BYTES: usize = 128;

#[derive(Debug)]
pub struct CodexInventoryState {
    snapshot: Mutex<Snapshot>,
}

#[derive(Debug)]
struct Snapshot {
    expires_at: Instant,
    entries: HashMap<String, SnapshotEntry>,
}

#[derive(Debug, Clone)]
struct SnapshotEntry {
    scope: CodexInventoryScope,
    kind: CodexRecordKind,
    record: SnapshotRecord,
}

#[derive(Debug, Clone)]
enum SnapshotRecord {
    Instruction(InstructionRecord),
    Agent(AgentRecord),
    Skill(SkillRecord),
}

struct ResolvedScope {
    codex_home: PathBuf,
    project_context: Option<ResolvedCodexProjectContext>,
}

impl CodexInventoryState {
    pub fn new() -> Self {
        Self {
            snapshot: Mutex::new(Snapshot {
                expires_at: Instant::now(),
                entries: HashMap::new(),
            }),
        }
    }

    fn replace(
        &self,
        scope: &CodexInventoryScope,
        kind: CodexRecordKind,
        records: impl IntoIterator<Item = SnapshotRecord>,
    ) -> Result<(), String> {
        let mut snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "codex inventory: snapshot lock is poisoned".to_string())?;
        if snapshot.expires_at <= Instant::now() {
            snapshot.entries.clear();
        }
        snapshot
            .entries
            .retain(|_, entry| entry.scope != scope.clone() || entry.kind != kind);
        for record in records {
            let id = record_id(&record).to_string();
            snapshot.entries.insert(
                id,
                SnapshotEntry {
                    scope: scope.clone(),
                    kind,
                    record,
                },
            );
        }
        snapshot.expires_at = Instant::now() + SNAPSHOT_TTL;
        if snapshot.entries.len() > MAX_INVENTORY_ITEMS * 3 {
            let overflow = snapshot.entries.len() - MAX_INVENTORY_ITEMS * 3;
            let ids: Vec<String> = snapshot.entries.keys().take(overflow).cloned().collect();
            for id in ids {
                snapshot.entries.remove(&id);
            }
        }
        Ok(())
    }

    fn get(
        &self,
        scope: &CodexInventoryScope,
        kind: CodexRecordKind,
        id: &str,
    ) -> Result<SnapshotRecord, String> {
        let mut snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "codex inventory: snapshot lock is poisoned".to_string())?;
        if snapshot.expires_at <= Instant::now() {
            snapshot.entries.clear();
            return Err(refresh_snapshot_error());
        }
        let entry = snapshot
            .entries
            .get(id)
            .ok_or_else(refresh_snapshot_error)?;
        if entry.kind != kind || &entry.scope != scope {
            return Err(refresh_snapshot_error());
        }
        Ok(entry.record.clone())
    }

    fn invalidate(&self) -> Result<(), String> {
        let mut snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "codex inventory: snapshot lock is poisoned".to_string())?;
        snapshot.entries.clear();
        snapshot.expires_at = Instant::now();
        Ok(())
    }
}

impl Default for CodexInventoryState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_codex_instructions(
    scope: CodexInventoryScope,
    inventory: State<'_, Arc<CodexInventoryState>>,
) -> Result<CodexInstructionList, String> {
    let resolved = resolve_scope(&scope)?;
    let mut discovered = codex_instructions::discover(
        &resolved.codex_home,
        &scope,
        resolved.project_context.as_ref(),
    )?;
    cap_instruction_response(&mut discovered.view, &mut discovered.records)?;
    inventory.replace(
        &scope,
        CodexRecordKind::Instruction,
        discovered
            .records
            .into_iter()
            .map(SnapshotRecord::Instruction),
    )?;
    Ok(discovered.view)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_codex_instruction(
    scope: CodexInventoryScope,
    record_id: String,
    max_bytes: Option<usize>,
    inventory: State<'_, Arc<CodexInventoryState>>,
) -> Result<CodexInstructionDetail, String> {
    let record_id = validate_record_id(&record_id)?;
    let record = inventory.get(&scope, CodexRecordKind::Instruction, record_id)?;
    let SnapshotRecord::Instruction(record) = record else {
        return Err("codex inventory: selected record is not an instruction".to_string());
    };
    codex_instructions::read_detail(&record, detail_limit(max_bytes)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_codex_instruction(
    scope: CodexInventoryScope,
    record_id: String,
    content: String,
    expected_revision: String,
    inventory: State<'_, Arc<CodexInventoryState>>,
    ssh: State<'_, Arc<SshState>>,
) -> Result<CodexTextPreviewResult, String> {
    let record_id = validate_record_id(&record_id)?;
    crate::commands::codex_settings::ensure_local(&ssh)?;
    let record = inventory.get(&scope, CodexRecordKind::Instruction, record_id)?;
    let SnapshotRecord::Instruction(record) = record else {
        return Err("codex inventory: selected record is not an instruction".to_string());
    };
    codex_text_write::preview(
        CodexRecordKind::Instruction,
        record_id,
        &record.root,
        &record.relative,
        &content,
        &expected_revision,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn apply_codex_instruction(
    scope: CodexInventoryScope,
    record_id: String,
    content: String,
    expected_revision: String,
    inventory: State<'_, Arc<CodexInventoryState>>,
    ssh: State<'_, Arc<SshState>>,
) -> Result<CodexTextApplyResult, String> {
    let record_id = validate_record_id(&record_id)?;
    crate::commands::codex_settings::ensure_local(&ssh)?;
    let record = inventory.get(&scope, CodexRecordKind::Instruction, record_id)?;
    let SnapshotRecord::Instruction(record) = record else {
        return Err("codex inventory: selected record is not an instruction".to_string());
    };
    let result = codex_text_write::apply(
        CodexRecordKind::Instruction,
        record_id,
        &record.root,
        &record.relative,
        &content,
        &expected_revision,
    )?;
    inventory.invalidate()?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_codex_agents(
    scope: CodexInventoryScope,
    inventory: State<'_, Arc<CodexInventoryState>>,
) -> Result<CodexAgentList, String> {
    let resolved = resolve_scope(&scope)?;
    let mut discovered = codex_agents::discover(
        &resolved.codex_home,
        &scope,
        resolved.project_context.as_ref(),
    )?;
    cap_agent_response(&mut discovered.view, &mut discovered.records)?;
    inventory.replace(
        &scope,
        CodexRecordKind::Agent,
        discovered.records.into_iter().map(SnapshotRecord::Agent),
    )?;
    Ok(discovered.view)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_codex_agent(
    scope: CodexInventoryScope,
    record_id: String,
    max_bytes: Option<usize>,
    inventory: State<'_, Arc<CodexInventoryState>>,
) -> Result<CodexAgentDetail, String> {
    let record_id = validate_record_id(&record_id)?;
    let record = inventory.get(&scope, CodexRecordKind::Agent, record_id)?;
    let SnapshotRecord::Agent(record) = record else {
        return Err("codex inventory: selected record is not an agent".to_string());
    };
    codex_agents::read_detail(&record, detail_limit(max_bytes)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_codex_agent(
    scope: CodexInventoryScope,
    record_id: String,
    content: String,
    expected_revision: String,
    inventory: State<'_, Arc<CodexInventoryState>>,
    ssh: State<'_, Arc<SshState>>,
) -> Result<CodexTextPreviewResult, String> {
    let record_id = validate_record_id(&record_id)?;
    crate::commands::codex_settings::ensure_local(&ssh)?;
    let record = inventory.get(&scope, CodexRecordKind::Agent, record_id)?;
    let SnapshotRecord::Agent(record) = record else {
        return Err("codex inventory: selected record is not an agent".to_string());
    };
    codex_text_write::preview_with_transform(
        CodexRecordKind::Agent,
        record_id,
        &record.root,
        &record.relative,
        &content,
        &expected_revision,
        |current| codex_agents::render_developer_instructions(current, &content),
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn apply_codex_agent(
    scope: CodexInventoryScope,
    record_id: String,
    content: String,
    expected_revision: String,
    inventory: State<'_, Arc<CodexInventoryState>>,
    ssh: State<'_, Arc<SshState>>,
) -> Result<CodexTextApplyResult, String> {
    let record_id = validate_record_id(&record_id)?;
    crate::commands::codex_settings::ensure_local(&ssh)?;
    let record = inventory.get(&scope, CodexRecordKind::Agent, record_id)?;
    let SnapshotRecord::Agent(record) = record else {
        return Err("codex inventory: selected record is not an agent".to_string());
    };
    let result = codex_text_write::apply_with_transform(
        CodexRecordKind::Agent,
        record_id,
        &record.root,
        &record.relative,
        &content,
        &expected_revision,
        |current| codex_agents::render_developer_instructions(current, &content),
    )?;
    inventory.invalidate()?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_codex_skills(
    scope: CodexInventoryScope,
    inventory: State<'_, Arc<CodexInventoryState>>,
) -> Result<CodexSkillList, String> {
    let resolved = resolve_scope(&scope)?;
    let mut discovered = codex_skills::discover(
        &resolved.codex_home,
        &scope,
        resolved.project_context.as_ref(),
    )?;
    cap_skill_response(&mut discovered.view, &mut discovered.records)?;
    inventory.replace(
        &scope,
        CodexRecordKind::Skill,
        discovered.records.into_iter().map(SnapshotRecord::Skill),
    )?;
    Ok(discovered.view)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_codex_skill(
    scope: CodexInventoryScope,
    record_id: String,
    max_bytes: Option<usize>,
    inventory: State<'_, Arc<CodexInventoryState>>,
) -> Result<CodexSkillDetail, String> {
    let record_id = validate_record_id(&record_id)?;
    let record = inventory.get(&scope, CodexRecordKind::Skill, record_id)?;
    let SnapshotRecord::Skill(record) = record else {
        return Err("codex inventory: selected record is not a skill".to_string());
    };
    codex_skills::read_detail(&record, detail_limit(max_bytes)?)
}

fn resolve_scope(scope: &CodexInventoryScope) -> Result<ResolvedScope, String> {
    let codex_home = root::codex_dir()?;
    if !codex_home.is_absolute() {
        return Err("codex inventory: resolved CODEX_HOME must be absolute".to_string());
    }
    let project_context = match scope {
        CodexInventoryScope::Global => None,
        CodexInventoryScope::Project { project_id } => {
            if project_id.is_empty() || project_id.len() > 512 {
                return Err("codex inventory: project id is invalid".to_string());
            }
            let project = session_commands::get_projects()?
                .into_iter()
                .find(|project| project.id == *project_id)
                .ok_or_else(|| {
                    "codex inventory: project id was not issued by the backend".to_string()
                })?;
            Some(normalize_project_context(
                &project.path,
                None,
                None,
                "codex inventory",
            )?)
        }
    };
    Ok(ResolvedScope {
        codex_home,
        project_context,
    })
}

fn validate_record_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > MAX_RECORD_ID_BYTES
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("codex inventory: record id is invalid".to_string());
    }
    Ok(id)
}

fn detail_limit(value: Option<usize>) -> Result<usize, String> {
    let value = value.unwrap_or(MAX_DETAIL_BYTES);
    if value == 0 || value > MAX_DETAIL_BYTES {
        return Err(format!(
            "codex inventory: detail limit must be between 1 and {MAX_DETAIL_BYTES} bytes"
        ));
    }
    Ok(value)
}

fn refresh_snapshot_error() -> String {
    "codex inventory: selected record is expired or not in the latest list; refresh the inventory"
        .to_string()
}

fn record_id(record: &SnapshotRecord) -> &str {
    match record {
        SnapshotRecord::Instruction(record) => &record.source.identity.id,
        SnapshotRecord::Agent(record) => &record.summary.identity.id,
        SnapshotRecord::Skill(record) => &record.summary.identity.id,
    }
}

fn cap_instruction_response(
    view: &mut CodexInstructionList,
    records: &mut Vec<InstructionRecord>,
) -> Result<(), String> {
    while response_bytes(view)? > MAX_RESPONSE_BYTES {
        if view.items.pop().is_none() {
            return Err(
                "codex inventory: instruction response exceeds the bounded size".to_string(),
            );
        }
        records.pop();
        view.summary.scan_limited = true;
        view.summary.omitted_count = view.summary.omitted_count.saturating_add(1);
    }
    Ok(())
}

fn cap_agent_response(
    view: &mut CodexAgentList,
    records: &mut Vec<AgentRecord>,
) -> Result<(), String> {
    while response_bytes(view)? > MAX_RESPONSE_BYTES {
        if view.items.pop().is_none() {
            return Err("codex inventory: agent response exceeds the bounded size".to_string());
        }
        records.pop();
        view.summary.scan_limited = true;
        view.summary.omitted_count = view.summary.omitted_count.saturating_add(1);
    }
    Ok(())
}

fn cap_skill_response(
    view: &mut CodexSkillList,
    records: &mut Vec<SkillRecord>,
) -> Result<(), String> {
    while response_bytes(view)? > MAX_RESPONSE_BYTES {
        if view.items.pop().is_none() {
            return Err("codex inventory: skill response exceeds the bounded size".to_string());
        }
        records.pop();
        view.summary.scan_limited = true;
        view.summary.omitted_count = view.summary.omitted_count.saturating_add(1);
    }
    Ok(())
}

fn response_bytes<T: Serialize>(value: &T) -> Result<usize, String> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|error| format!("codex inventory: serialize bounded response: {error}"))
}
