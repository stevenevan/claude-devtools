/// SSH connection manager — connect/disconnect lifecycle with russh.

use std::sync::Arc;

use russh::client;
use russh_keys::PublicKey;
use russh_sftp::client::SftpSession;

use super::agent_discovery;
use super::config_parser;
use super::types::{SshConfigHostEntry, SshConnectionConfig, SshConnectionStatus};

// =============================================================================
// SSH Client Handler (required by russh)
// =============================================================================

struct SshHandler;

#[async_trait::async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept all server keys (matches ssh2 behavior in the TS version)
        Ok(true)
    }
}

// =============================================================================
// SshConnection
// =============================================================================

pub struct SshConnection {
    _handle: client::Handle<SshHandler>,
    _sftp: SftpSession,
    pub remote_projects_path: String,
    _remote_todos_path: String,
    host: String,
}

// =============================================================================
// SshState
// =============================================================================

pub struct SshState {
    pub connection: Option<SshConnection>,
}

impl Default for SshState {
    fn default() -> Self {
        Self { connection: None }
    }
}

impl SshState {
    pub fn get_status(&self) -> SshConnectionStatus {
        match &self.connection {
            Some(conn) => SshConnectionStatus {
                state: "connected".to_string(),
                host: Some(conn.host.clone()),
                error: None,
                remote_projects_path: Some(conn.remote_projects_path.clone()),
            },
            None => SshConnectionStatus::disconnected(),
        }
    }

}

// =============================================================================
// Connect
// =============================================================================

pub async fn connect(config: &SshConnectionConfig) -> Result<SshConnection, String> {
    // Resolve SSH config for the host
    let ssh_config = config_parser::resolve_host(&config.host);

    let actual_host = ssh_config
        .as_ref()
        .and_then(|c| c.host_name.clone())
        .unwrap_or_else(|| config.host.clone());
    let actual_port = if config.port != 22 {
        config.port
    } else {
        ssh_config
            .as_ref()
            .and_then(|c| c.port)
            .unwrap_or(config.port)
    };
    let username = if config.username.is_empty() {
        ssh_config
            .as_ref()
            .and_then(|c| c.user.clone())
            .unwrap_or_else(|| std::env::var("USER").unwrap_or_else(|_| "root".to_string()))
    } else {
        config.username.clone()
    };

    // Build russh config
    let russh_config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(30)),
        ..Default::default()
    });

    // Connect
    let mut session = client::connect(russh_config, (actual_host.as_str(), actual_port), SshHandler)
        .await
        .map_err(|e| format!("SSH connection failed: {e}"))?;

    // Authenticate
    authenticate(&mut session, config, &ssh_config, &username)
        .await
        .map_err(|e| format!("SSH authentication failed: {e}"))?;

    // Open SFTP channel
    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH channel: {e}"))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {e}"))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to start SFTP session: {e}"))?;

    // Resolve remote projects path
    let remote_home = resolve_remote_home(&session).await;
    let remote_projects_path = find_remote_projects_path(&sftp, &username, remote_home.as_deref())
        .await;
    let remote_todos_path = if let Some(ref home) = remote_home {
        format!("{home}/.claude/todos")
    } else {
        format!("/home/{username}/.claude/todos")
    };

    Ok(SshConnection {
        _handle: session,
        _sftp: sftp,
        remote_projects_path,
        _remote_todos_path: remote_todos_path,
        host: config.host.clone(),
    })
}

/// Test a connection without persisting it.
pub async fn test_connection(
    config: &SshConnectionConfig,
) -> Result<(), String> {
    let conn = connect(config).await?;
    // Connection succeeded, drop it
    drop(conn);
    Ok(())
}

// =============================================================================
// Authentication
// =============================================================================

async fn authenticate(
    session: &mut client::Handle<SshHandler>,
    config: &SshConnectionConfig,
    ssh_config: &Option<SshConfigHostEntry>,
    username: &str,
) -> Result<(), String> {
    match config.auth_method.as_str() {
        "password" => {
            let password = config
                .password
                .as_deref()
                .ok_or("Password required")?;
            let auth_ok = session
                .authenticate_password(username, password)
                .await
                .map_err(|e| e.to_string())?;
            if !auth_ok {
                return Err("Password authentication failed".to_string());
            }
        }
        "privateKey" => {
            let key_path = config
                .private_key_path
                .as_deref()
                .unwrap_or("~/.ssh/id_rsa");
            let expanded = expand_tilde(key_path);
            let key = russh_keys::load_secret_key(&expanded, None)
                .map_err(|e| format!("Cannot read private key at {expanded}: {e}"))?;
            let auth_ok = session
                .authenticate_publickey(username, Arc::new(key))
                .await
                .map_err(|e| e.to_string())?;
            if !auth_ok {
                return Err("Public key authentication failed".to_string());
            }
        }
        "agent" => {
            let _socket = agent_discovery::discover_agent_socket()
                .await
                .ok_or("SSH agent socket not found")?;
            let mut agent =
                russh_keys::agent::client::AgentClient::connect_env()
                    .await
                    .map_err(|e| format!("Cannot connect to SSH agent: {e}"))?;
            let identities = agent
                .request_identities()
                .await
                .map_err(|e| format!("Failed to list agent identities: {e}"))?;

            let mut authenticated = false;
            for identity in &identities {
                match session
                    .authenticate_publickey_with(username, identity.clone(), &mut agent)
                    .await
                {
                    Ok(true) => {
                        authenticated = true;
                        break;
                    }
                    _ => continue,
                }
            }
            if !authenticated {
                return Err(format!(
                    "Agent authentication failed ({} identities tried)",
                    identities.len()
                ));
            }
        }
        "auto" | _ => {
            // Try: config identity → agent → default keys
            // 1. Try SSH config identity file
            if ssh_config.as_ref().map(|c| c.has_identity_file).unwrap_or(false) {
                let default_keys = ["id_ed25519", "id_rsa", "id_ecdsa"];
                for key_name in &default_keys {
                    let key_path = dirs::home_dir()
                        .map(|h| h.join(".ssh").join(key_name))
                        .unwrap_or_default();
                    if let Ok(key) = russh_keys::load_secret_key(key_path.to_str().unwrap_or(""), None) {
                        if let Ok(true) = session
                            .authenticate_publickey(username, Arc::new(key))
                            .await
                        {
                            return Ok(());
                        }
                    }
                }
            }

            // 2. Try SSH agent
            if let Ok(mut agent) = russh_keys::agent::client::AgentClient::connect_env().await {
                if let Ok(identities) = agent.request_identities().await {
                    for identity in &identities {
                        if let Ok(true) = session
                            .authenticate_publickey_with(username, identity.clone(), &mut agent)
                            .await
                        {
                            return Ok(());
                        }
                    }
                }
            }

            // 3. Try default key files
            let default_keys = ["id_ed25519", "id_rsa", "id_ecdsa"];
            for key_name in &default_keys {
                let key_path = dirs::home_dir()
                    .map(|h| h.join(".ssh").join(key_name))
                    .unwrap_or_default();
                if let Ok(key) = russh_keys::load_secret_key(key_path.to_str().unwrap_or(""), None) {
                    if let Ok(true) = session
                        .authenticate_publickey(username, Arc::new(key))
                        .await
                    {
                        return Ok(());
                    }
                }
            }

            return Err("No authentication method succeeded".to_string());
        }
    }

    Ok(())
}

// =============================================================================
// Remote Path Resolution
// =============================================================================

async fn resolve_remote_home(session: &client::Handle<SshHandler>) -> Option<String> {
    let channel = session.channel_open_session().await.ok()?;
    channel
        .exec(true, "printf %s \"$HOME\"")
        .await
        .ok()?;

    let mut stdout = String::new();
    let mut stream = channel.into_stream();

    let mut buf = vec![0u8; 4096];
    loop {
        match tokio::io::AsyncReadExt::read(&mut stream, &mut buf).await {
            Ok(0) => break,
            Ok(n) => stdout.push_str(&String::from_utf8_lossy(&buf[..n])),
            Err(_) => break,
        }
    }

    let trimmed = stdout.trim().to_string();
    if trimmed.starts_with('/') {
        Some(trimmed)
    } else {
        None
    }
}

async fn find_remote_projects_path(
    sftp: &SftpSession,
    username: &str,
    remote_home: Option<&str>,
) -> String {
    let mut candidates = Vec::new();

    if let Some(home) = remote_home {
        candidates.push(format!("{home}/.claude/projects"));
    }
    candidates.push(format!("/home/{username}/.claude/projects"));
    candidates.push(format!("/Users/{username}/.claude/projects"));
    candidates.push("/root/.claude/projects".to_string());

    // Deduplicate
    candidates.dedup();

    for candidate in &candidates {
        if sftp.try_exists(candidate).await.unwrap_or(false) {
            return candidate.clone();
        }
    }

    // Fallback
    if let Some(home) = remote_home {
        format!("{home}/.claude/projects")
    } else {
        format!("/home/{username}/.claude/projects")
    }
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix('~') {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{rest}", home.display());
        }
    }
    path.to_string()
}
