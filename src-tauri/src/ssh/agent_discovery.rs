/// SSH agent socket discovery — platform-specific.

use std::path::PathBuf;

/// Discover the SSH agent socket path.
pub async fn discover_agent_socket() -> Option<String> {
    // 1. Check SSH_AUTH_SOCK env var
    if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
        if tokio::fs::metadata(&sock).await.is_ok() {
            return Some(sock);
        }
    }

    // 2. macOS: query launchctl for the socket (GUI apps don't inherit shell env)
    #[cfg(target_os = "macos")]
    {
        if let Some(sock) = query_launchctl().await {
            return Some(sock);
        }
    }

    // 3. Try known socket paths
    let home = dirs::home_dir()?;
    let mut known_paths: Vec<PathBuf> = Vec::new();

    // 1Password SSH agent
    #[cfg(target_os = "macos")]
    {
        known_paths.push(
            home.join("Library")
                .join("Group Containers")
                .join("2BUA8C4S2C.com.1password")
                .join("agent.sock"),
        );
    }
    known_paths.push(home.join(".1password").join("agent.sock"));
    known_paths.push(home.join(".ssh").join("agent.sock"));

    // Linux system paths
    #[cfg(target_os = "linux")]
    {
        if let Some(uid) = get_uid() {
            known_paths.push(PathBuf::from(format!("/run/user/{uid}/ssh-agent.socket")));
            known_paths.push(PathBuf::from(format!("/run/user/{uid}/keyring/ssh")));
        }
    }

    for path in &known_paths {
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
fn get_uid() -> Option<u32> {
    Some(unsafe { libc::getuid() })
}
