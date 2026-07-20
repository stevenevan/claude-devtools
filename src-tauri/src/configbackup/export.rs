//! Ports `internal/configbackup/export.go` (W14) — zip a stored backup. Default
//! (include_secrets=false) strips secrets before packing: settings.json via
//! whole-JSON masking (`mask_settings_secrets`), every other captured text file
//! via per-line token redaction (`redact_secret_line`), so a credential pasted
//! into CLAUDE.md / an agent / a memory file never ships. The hooks-disabled
//! snapshot is never exported. Opt-in (include_secrets=true) packs verbatim and
//! flags the manifest. sha256s in the archive manifest are recomputed over the
//! SANITIZED bytes. Deflate, `/`-separated entry names, `manifest.json` last,
//! manifest 2-space indent. Guards reproduced verbatim (invariant #3).

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::configbackup::store::read_manifest;
use crate::configbackup::types::{config_backups_dir, validate_backup_id, FileEntry, Manifest};
use crate::files::agents_write::clean;
use crate::files::json_util::to_go_json_pretty;
use crate::files::secret_export::{mask_settings_secrets, redact_secret_line};

/// Packs backup `id` into a zip archive at `dest_path`. Mirrors `ExportBackup`.
pub fn export_backup(
    app_data_dir: &Path,
    id: &str,
    dest_path: &Path,
    include_secrets: bool,
) -> Result<(), String> {
    validate_backup_id(id)?;
    let backup_dir = config_backups_dir(app_data_dir).join(id);
    let manifest = read_manifest(&backup_dir)?;

    let out = File::create(dest_path)
        .map_err(|e| format!("configbackup: create export {}: {e}", dest_path.display()))?;
    let mut zw = ZipWriter::new(out);

    let mut export_manifest = Manifest {
        id: manifest.id.clone(),
        label: manifest.label.clone(),
        created_ms: manifest.created_ms,
        secrets_included: include_secrets,
        files: Vec::new(),
        skill_links: manifest.skill_links.clone(),
    };

    for entry in &manifest.files {
        let mut data = fs::read(backup_dir.join(&entry.rel_path))
            .map_err(|e| format!("configbackup: read backup file {:?}: {e}", entry.rel_path))?;
        if !include_secrets {
            data = sanitize_for_export(&entry.rel_path, data);
        }
        write_zip_entry(&mut zw, &entry.rel_path, &data)?;
        let sum = Sha256::digest(&data);
        export_manifest.files.push(FileEntry {
            rel_path: entry.rel_path.clone(),
            size: data.len() as i64,
            sha256: hex_encode(&sum),
        });
    }

    let manifest_bytes = to_go_json_pretty(&export_manifest)
        .map_err(|e| format!("configbackup: marshal export manifest: {e}"))?;
    write_zip_entry(&mut zw, "manifest.json", &manifest_bytes)?;
    zw.finish()
        .map_err(|e| format!("configbackup: finish export: {e}"))?;
    Ok(())
}

/// Strips secrets from one captured file's bytes: settings.json via whole-JSON
/// masking, every other file via per-line token redaction. Mirrors
/// `sanitizeForExport`.
fn sanitize_for_export(rel: &str, data: Vec<u8>) -> Vec<u8> {
    if clean(rel) == "settings.json" {
        if let Ok(masked) = mask_settings_secrets(&data) {
            return masked;
        }
        // A settings.json that won't parse falls through to line redaction.
    }
    redact_text_bytes(&data)
}

/// Redacts token-shaped secrets from every line, preserving line structure.
/// Returns the input unchanged when nothing matched. Mirrors `redactTextBytes`.
fn redact_text_bytes(data: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(data);
    let mut changed = false;
    let mut lines: Vec<String> = Vec::new();
    for line in text.split('\n') {
        let (red, ok) = redact_secret_line(line);
        if ok {
            changed = true;
        }
        lines.push(red);
    }
    if !changed {
        return data.to_vec();
    }
    lines.join("\n").into_bytes()
}

/// Writes one file into the archive under a forward-slash name. Mirrors
/// `writeZipEntry`.
fn write_zip_entry(zw: &mut ZipWriter<File>, rel_path: &str, data: &[u8]) -> Result<(), String> {
    let name = rel_path.replace('\\', "/"); // filepath.ToSlash
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    zw.start_file(name, options)
        .map_err(|e| format!("configbackup: create zip entry {:?}: {e}", rel_path))?;
    zw.write_all(data)
        .map_err(|e| format!("configbackup: write zip entry {:?}: {e}", rel_path))?;
    Ok(())
}

/// Lowercase hex, mirroring Go's `hex.EncodeToString`.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod export_tests;
