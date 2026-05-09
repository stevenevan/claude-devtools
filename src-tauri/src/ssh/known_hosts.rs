//! Managed known_hosts for the claude-devtools SSH client (sprint 55).
//!
//! Stores host fingerprints in `~/.claude/ssh/known_hosts` (mode 0600 on
//! Unix). On first contact with a host: TOFU — the key is recorded. On a
//! subsequent connection: the recorded key must match. A mismatch is
//! reported as `Decision::KeyChanged` and the caller MUST refuse the
//! connection (no auto-update; user must edit the file by hand).
//!
//! The format mirrors OpenSSH's `known_hosts`:
//!   <host>[,<host>...] <algorithm> <base64-public-key>
//! one entry per line.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use russh_keys::ssh_key::{HashAlg, PublicKey};

pub const ALLOWED_HOST_KEY_ALGOS: &[&str] = &[
    "ssh-ed25519",
    "rsa-sha2-256",
    "rsa-sha2-512",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Host fingerprint already present and matches.
    TrustedExisting,
    /// Host previously unknown; entry just written (TOFU).
    LearnedNew { fingerprint_sha256: String },
    /// Host previously recorded with a different key. Reject the connection.
    KeyChanged {
        recorded_fingerprint: String,
        offered_fingerprint: String,
    },
    /// Algorithm not on the allowlist.
    AlgorithmRejected { algorithm: String },
}

pub fn default_known_hosts_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())?;
    Ok(home.join(".claude").join("ssh").join("known_hosts"))
}

pub fn fingerprint_sha256(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

fn algorithm_name(key: &PublicKey) -> String {
    key.algorithm().as_str().to_string()
}

pub fn is_algorithm_allowed(algo: &str) -> bool {
    ALLOWED_HOST_KEY_ALGOS.iter().any(|a| *a == algo)
}

fn read_recorded_entries(path: &Path, host: &str, port: u16) -> std::io::Result<Vec<String>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = fs::read_to_string(path)?;
    let key_for_host = canonical_host(host, port);
    Ok(contents
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let mut parts = trimmed.split_whitespace();
            let host_part = parts.next()?;
            let algo = parts.next()?;
            let key_b64 = parts.next()?;
            if host_part.split(',').any(|h| h == key_for_host) {
                Some(format!("{algo} {key_b64}"))
            } else {
                None
            }
        })
        .collect())
}

fn canonical_host(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

#[cfg(unix)]
fn ensure_secure_perms(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)?.permissions();
    perms.set_mode(0o600);
    fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
fn ensure_secure_perms(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn append_entry(path: &Path, host_label: &str, algo: &str, key_b64: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let line = format!("{host_label} {algo} {key_b64}\n");
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())?;
    drop(file);
    ensure_secure_perms(path)?;
    Ok(())
}

pub fn check_or_learn(
    path: &Path,
    host: &str,
    port: u16,
    key: &PublicKey,
) -> Result<Decision, String> {
    let algo = algorithm_name(key);
    if !is_algorithm_allowed(&algo) {
        return Ok(Decision::AlgorithmRejected { algorithm: algo });
    }

    let offered_fp = fingerprint_sha256(key);
    let offered_b64 = key
        .to_openssh()
        .map_err(|e| format!("failed to encode key: {e}"))?;
    let offered_b64 = offered_b64
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "key serialization missing base64 payload".to_string())?
        .to_string();

    let recorded = read_recorded_entries(path, host, port)
        .map_err(|e| format!("known_hosts read failed: {e}"))?;

    for entry in &recorded {
        let mut parts = entry.split_whitespace();
        let rec_algo = parts.next().unwrap_or("");
        let rec_key = parts.next().unwrap_or("");
        if rec_algo == algo && rec_key == offered_b64 {
            return Ok(Decision::TrustedExisting);
        }
        if rec_algo == algo {
            return Ok(Decision::KeyChanged {
                recorded_fingerprint: format!("{rec_algo}:{}", &rec_key[..rec_key.len().min(20)]),
                offered_fingerprint: offered_fp,
            });
        }
    }

    let host_label = canonical_host(host, port);
    append_entry(path, &host_label, &algo, &offered_b64)
        .map_err(|e| format!("known_hosts write failed: {e}"))?;
    Ok(Decision::LearnedNew {
        fingerprint_sha256: offered_fp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("claude-known-hosts-{}-{name}", std::process::id()));
        let _ = fs::remove_file(&p);
        p
    }

    const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz4o8ZUf/Indr+vUVU";
    const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIBitTeUKfHilLBLrZxnP4UADYUkLwlGMR4WhFZ1XKXG8";

    fn parse(b64: &str) -> PublicKey {
        russh_keys::parse_public_key_base64(b64).expect("parse key")
    }

    #[test]
    fn algorithm_allowlist_blocks_ssh_rsa_sha1() {
        assert!(!is_algorithm_allowed("ssh-rsa"));
        assert!(!is_algorithm_allowed("ssh-dss"));
        assert!(is_algorithm_allowed("ssh-ed25519"));
        assert!(is_algorithm_allowed("rsa-sha2-256"));
        assert!(is_algorithm_allowed("ecdsa-sha2-nistp256"));
    }

    #[test]
    fn learns_new_host_then_recognizes_it() {
        let path = temp_path("learn");
        let key = parse(KEY_A);

        let d1 = check_or_learn(&path, "example.com", 22, &key).unwrap();
        match d1 {
            Decision::LearnedNew { .. } => {}
            other => panic!("expected LearnedNew, got {other:?}"),
        }

        let d2 = check_or_learn(&path, "example.com", 22, &key).unwrap();
        assert_eq!(d2, Decision::TrustedExisting);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn rejects_changed_key() {
        let path = temp_path("changed");
        let key1 = parse(KEY_A);
        let key2 = parse(KEY_B);

        let _ = check_or_learn(&path, "host.example", 22, &key1).unwrap();
        let d2 = check_or_learn(&path, "host.example", 22, &key2).unwrap();
        match d2 {
            Decision::KeyChanged { .. } => {}
            other => panic!("expected KeyChanged, got {other:?}"),
        }
        let _ = fs::remove_file(&path);
    }
}
