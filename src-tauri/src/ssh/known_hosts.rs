//! Managed `known_hosts` — the HOST-KEY SECURITY BOUNDARY.
//!
//! Stores host fingerprints in `~/.claude/ssh/known_hosts` (mode 0600 on Unix).
//! First contact ⇒ TOFU (record the key). Subsequent contact ⇒ the recorded key
//! MUST match; a mismatch is `Decision::KeyChanged` and the caller MUST refuse.
//! An off-allowlist algorithm (ssh-rsa SHA-1, ssh-dss) is `AlgorithmRejected`.
//!
//! Reconciled EXACTLY against the Go oracle `internal/ssh/known_hosts.go`
//! (`allowedAlgorithms`, `DecisionResult`, TOFU-learn + reject-on-change).
//! russh 0.48 → 0.60: keys moved from `russh_keys::` to `russh::keys::`.
//! This module is a pure decision over a public key — testable without a socket.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use russh::keys::ssh_key::{HashAlg, PublicKey};

/// Mirrors Go `allowedAlgorithms` — blocks ssh-rsa (SHA-1) and ssh-dss.
pub const ALLOWED_HOST_KEY_ALGOS: &[&str] = &[
    "ssh-ed25519",
    "rsa-sha2-256",
    "rsa-sha2-512",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
];

/// Mirrors Go `Decision` (the kind discriminant).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Host fingerprint already present and matches.
    TrustedExisting,
    /// Host previously unknown; entry just written (TOFU).
    LearnedNew,
    /// Host previously recorded with a different key. REJECT (possible MITM).
    KeyChanged,
    /// Algorithm not on the allowlist.
    AlgorithmRejected,
}

/// Mirrors Go `DecisionResult` — kind plus optional detail strings.
#[derive(Debug, Clone)]
pub struct DecisionResult {
    pub kind: Decision,
    pub fingerprint_sha256: String,   // LearnedNew
    pub recorded_fingerprint: String, // KeyChanged
    pub offered_fingerprint: String,  // KeyChanged
    pub algorithm: String,            // AlgorithmRejected
}

impl DecisionResult {
    fn kind_only(kind: Decision) -> Self {
        Self {
            kind,
            fingerprint_sha256: String::new(),
            recorded_fingerprint: String::new(),
            offered_fingerprint: String::new(),
            algorithm: String::new(),
        }
    }

    pub fn algorithm_rejected(algorithm: String) -> Self {
        Self {
            algorithm,
            ..Self::kind_only(Decision::AlgorithmRejected)
        }
    }

    fn learned_new(fingerprint_sha256: String) -> Self {
        Self {
            fingerprint_sha256,
            ..Self::kind_only(Decision::LearnedNew)
        }
    }

    fn key_changed(recorded_fingerprint: String, offered_fingerprint: String) -> Self {
        Self {
            recorded_fingerprint,
            offered_fingerprint,
            ..Self::kind_only(Decision::KeyChanged)
        }
    }
}

/// Mirrors Go `IsAlgorithmAllowed`.
pub fn is_algorithm_allowed(algo: &str) -> bool {
    ALLOWED_HOST_KEY_ALGOS.iter().any(|a| *a == algo)
}

/// Mirrors Go `DefaultKnownHostsPath` — `~/.claude/ssh/known_hosts`.
pub fn default_known_hosts_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())?;
    Ok(home.join(".claude").join("ssh").join("known_hosts"))
}

fn fingerprint_sha256(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

fn algorithm_name(key: &PublicKey) -> String {
    key.algorithm().as_str().to_string()
}

fn canonical_host(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
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

/// Mirrors Go `CheckOrLearn` — the primary security boundary. The caller MUST
/// refuse when `kind == Decision::KeyChanged` (or `AlgorithmRejected`).
pub fn check_or_learn(
    path: &Path,
    host: &str,
    port: u16,
    key: &PublicKey,
) -> Result<DecisionResult, String> {
    let algo = algorithm_name(key);
    if !is_algorithm_allowed(&algo) {
        return Ok(DecisionResult::algorithm_rejected(algo));
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
            return Ok(DecisionResult::kind_only(Decision::TrustedExisting));
        }
        if rec_algo == algo {
            let truncated = &rec_key[..rec_key.len().min(20)];
            return Ok(DecisionResult::key_changed(
                format!("{rec_algo}:{truncated}"),
                offered_fp,
            ));
        }
    }

    let host_label = canonical_host(host, port);
    append_entry(path, &host_label, &algo, &offered_b64)
        .map_err(|e| format!("known_hosts write failed: {e}"))?;
    Ok(DecisionResult::learned_new(offered_fp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::parse_public_key_base64;

    const ED_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIDs3ahoj3iva3ImzzJRUzDbwtFAIDjEwDOkond1qSDm6";
    const ED_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIL2nksHrATJlGe9trsyyBnA9XsukGB9B1kTu1j9oWFOT";
    const RSA: &str = "AAAAB3NzaC1yc2EAAAADAQABAAABAQC7HzQ7/s14l8bsw9dosuqH9LPUohaziaXaNo5ZrMxJGprbzfGbOu91pgWkDDtoEIlXgsvBAIS02mwPRa6p4IoKV5OP4OYyS6gin1F6n0ra6PlHpgmQjhLDvaV/hBUgVoXXqRFS6h6y8xWT153FHuZ1qajX0QxocrlPsQnGvgqwEOVm21CnlWb5NuUIBrQqMTmeCgPQdw8HSwmE8Gx4iKcP0TDrUxBJocY/lnSmVAZIr3gXQxB1lWi9xOjcN+xsRYWsAszempbNzPAzf6uqDAWyrQ5Df53qnAZjIlICDdCM0vxHVPr/IhAGzCSa5cfUzN4dL6gKg6XVHyuKKNbx6clz";

    fn parse(b64: &str) -> PublicKey {
        parse_public_key_base64(b64).expect("parse key")
    }

    fn temp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "claude-known-hosts-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_file(&p);
        p
    }

    // GOLDEN: the algorithm allowlist — ssh-ed25519 allowed; ssh-rsa/ssh-dss blocked.
    #[test]
    fn algorithm_allowlist_blocks_sha1_and_dss() {
        assert!(!is_algorithm_allowed("ssh-rsa"));
        assert!(!is_algorithm_allowed("ssh-dss"));
        assert!(is_algorithm_allowed("ssh-ed25519"));
        assert!(is_algorithm_allowed("rsa-sha2-256"));
        assert!(is_algorithm_allowed("ecdsa-sha2-nistp256"));
    }

    // GOLDEN: TOFU-learn then recognise (LearnedNew → TrustedExisting).
    #[test]
    fn learns_new_host_then_recognizes_it() {
        let path = temp_path("learn");
        let key = parse(ED_A);

        let d1 = check_or_learn(&path, "example.com", 22, &key).unwrap();
        assert_eq!(d1.kind, Decision::LearnedNew);

        let d2 = check_or_learn(&path, "example.com", 22, &key).unwrap();
        assert_eq!(d2.kind, Decision::TrustedExisting);
        let _ = fs::remove_file(&path);
    }

    // GOLDEN (MITM PARITY): a changed key for the same host → KeyChanged.
    #[test]
    fn rejects_changed_key() {
        let path = temp_path("changed");
        let key1 = parse(ED_A);
        let key2 = parse(ED_B);

        let _ = check_or_learn(&path, "host.example", 22, &key1).unwrap();
        let d2 = check_or_learn(&path, "host.example", 22, &key2).unwrap();
        assert_eq!(d2.kind, Decision::KeyChanged);
        let _ = fs::remove_file(&path);
    }

    // GOLDEN: an off-allowlist algorithm (ssh-rsa/SHA-1) → AlgorithmRejected,
    // regardless of known_hosts state.
    #[test]
    fn rejects_off_allowlist_algorithm() {
        let path = temp_path("rsa-algo");
        let key = parse(RSA);
        let d = check_or_learn(&path, "rsa.example", 22, &key).unwrap();
        assert_eq!(d.kind, Decision::AlgorithmRejected);
        assert_eq!(d.algorithm, "ssh-rsa");
        // Nothing should have been written for a rejected algorithm.
        assert!(!path.exists());
    }
}
