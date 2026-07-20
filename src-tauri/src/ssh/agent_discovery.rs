//! SSH agent socket discovery — env var → launchctl (macOS) → well-known paths.
//! Reconciled against the Go oracle `internal/ssh/agent_discovery.go`.
//!
//! The Linux `/run/user/{uid}` candidates need the current uid. Go uses
//! `os.Getuid()`; without adding a `libc`/`nix` dependency, we read the uid from
//! the owner of the home directory (`MetadataExt::uid`), which equals the
//! process uid in normal setups.

use std::path::PathBuf;

/// Mirrors Go `DiscoverAgentSocket` — returns the socket path, or `None`.
pub async fn discover_agent_socket() -> Option<String> {
    // 1. SSH_AUTH_SOCK env var.
    if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
        if tokio::fs::metadata(&sock).await.is_ok() {
            return Some(sock);
        }
    }

    // 2. macOS: launchctl knows the socket even when the GUI app didn't inherit env.
    #[cfg(target_os = "macos")]
    {
        if let Some(sock) = query_launchctl().await {
            return Some(sock);
        }
    }

    // 3. Well-known paths.
    let home = dirs::home_dir()?;
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        candidates.push(
            home.join("Library")
                .join("Group Containers")
                .join("2BUA8C4S2C.com.1password")
                .join("agent.sock"),
        );
    }
    candidates.push(home.join(".1password").join("agent.sock"));
    candidates.push(home.join(".ssh").join("agent.sock"));

    #[cfg(target_os = "linux")]
    {
        if let Some(uid) = current_uid() {
            candidates.push(PathBuf::from(format!("/run/user/{uid}/ssh-agent.socket")));
            candidates.push(PathBuf::from(format!("/run/user/{uid}/keyring/ssh")));
        }
    }

    for path in &candidates {
        if tokio::fs::metadata(path).await.is_ok() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    None
}

#[cfg(target_os = "macos")]
async fn query_launchctl() -> Option<String> {
    let output = tokio::process::Command::new("/bin/launchctl")
        .args(["getenv", "SSH_AUTH_SOCK"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let sock = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if sock.is_empty() {
        return None;
    }
    if tokio::fs::metadata(&sock).await.is_ok() {
        Some(sock)
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn current_uid() -> Option<u32> {
    use std::os::unix::fs::MetadataExt;
    let home = dirs::home_dir()?;
    std::fs::metadata(&home).ok().map(|m| m.uid())
}
