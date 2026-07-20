//! SSH connection lifecycle over russh 0.60. Reconciled against the Go oracle
//! `internal/ssh/connection_manager.go` (State guards ONLY the conn pointer; the
//! mutex is never held across I/O — old conn dropped after the lock is released).
//!
//! russh 0.48 → 0.60 adaptations:
//!   - keys moved: `russh_keys::*` → `russh::keys::*` (no separate crate).
//!   - `client::Handler` is a native async trait (no `#[async_trait]`);
//!     `check_server_key(&mut self, &ssh_key::PublicKey) -> Result<bool, Error>`.
//!   - pubkey auth takes `PrivateKeyWithHashAlg::new(Arc<PrivateKey>, hash_alg)`.
//!   - `authenticate_*` return `AuthResult`; success via `.success()`.
//!   - agent auth: `authenticate_publickey_with(user, PublicKey, hash_alg, &mut AgentClient)`.

use std::borrow::Cow;
use std::sync::{Arc, Mutex};

use russh::client;
use russh::keys::agent::client::AgentClient;
use russh::keys::ssh_key::{Algorithm, EcdsaCurve, HashAlg, PublicKey};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::Preferred;
use russh_sftp::client::SftpSession;

use super::agent_discovery;
use super::config_parser;
use super::known_hosts::{
    check_or_learn, default_known_hosts_path, is_algorithm_allowed, Decision, DecisionResult,
};
use super::retry::Dialer;
use super::types::{ConfigHostEntry, ConnectionConfig, ConnectionStatus};

// Host-key allowlist for negotiation (no ssh-rsa SHA-1, no DSS).
const SAFE_HOST_KEY_ALGOS: &[Algorithm] = &[
    Algorithm::Ed25519,
    Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 },
    Algorithm::Ecdsa { curve: EcdsaCurve::NistP384 },
    Algorithm::Ecdsa { curve: EcdsaCurve::NistP521 },
    Algorithm::Rsa { hash: Some(HashAlg::Sha512) },
    Algorithm::Rsa { hash: Some(HashAlg::Sha256) },
];

fn safe_preferred() -> Preferred {
    Preferred {
        key: Cow::Borrowed(SAFE_HOST_KEY_ALGOS),
        ..Preferred::DEFAULT
    }
}

// ─── host-key handler (the security boundary) ────────────────────────────────

struct SshHandler {
    host: String,
    port: u16,
    decision: Arc<Mutex<Option<DecisionResult>>>,
}

impl SshHandler {
    fn record(&self, decision: DecisionResult) {
        if let Ok(mut slot) = self.decision.lock() {
            *slot = Some(decision);
        }
    }
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    /// Accept ONLY Trusted/Learned. Reject (`Ok(false)`, NEVER `Ok(true)`) on an
    /// off-allowlist algorithm or a changed key; fail closed (`Ok(false)`) on any
    /// error. The stored decision lets `connect` surface a descriptive message.
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // Boundary #1: algorithm allowlist (blocks ssh-rsa SHA-1 / DSS).
        let algo = server_public_key.algorithm().as_str().to_string();
        if !is_algorithm_allowed(&algo) {
            self.record(DecisionResult::algorithm_rejected(algo));
            return Ok(false);
        }
        // Boundary #2: managed known_hosts TOFU + reject-on-change.
        let path = match default_known_hosts_path() {
            Ok(p) => p,
            Err(_) => return Ok(false),
        };
        let result = match check_or_learn(&path, &self.host, self.port, server_public_key) {
            Ok(r) => r,
            Err(_) => return Ok(false),
        };
        let accept = matches!(result.kind, Decision::TrustedExisting | Decision::LearnedNew);
        self.record(result);
        Ok(accept)
    }
}

// ─── connection + state ──────────────────────────────────────────────────────

pub struct Connection {
    _handle: client::Handle<SshHandler>,
    _sftp: SftpSession,
    pub remote_projects_path: String,
    _remote_todos_path: String,
    host: String,
}

/// Mirrors Go `State` — the mutex guards ONLY the conn pointer, never held
/// across I/O; the old connection is dropped after the lock is released.
#[derive(Default)]
pub struct State {
    conn: Mutex<Option<Connection>>,
}

impl State {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mirrors Go `GetStatus`.
    pub fn get_status(&self) -> ConnectionStatus {
        let guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        match &*guard {
            Some(c) => ConnectionStatus {
                state: "connected".to_string(),
                host: Some(c.host.clone()),
                error: None,
                remote_projects_path: Some(c.remote_projects_path.clone()),
                retry_attempt: None,
                max_retries: None,
            },
            None => ConnectionStatus::disconnected(),
        }
    }

    /// Mirrors Go `SetConn` — swap under lock, drop the old conn after release.
    pub fn set_conn(&self, conn: Option<Connection>) {
        let old = {
            let mut guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::replace(&mut *guard, conn)
        };
        drop(old);
    }

    /// Mirrors Go `ClearConn`.
    pub fn clear_conn(&self) {
        self.set_conn(None);
    }
}

// ─── dialer + entry points ───────────────────────────────────────────────────

/// Production `Dialer` (mirrors Go `NetDialer`). russh does its own TCP dial.
pub struct NetDialer;

impl Dialer for NetDialer {
    type Conn = Connection;
    async fn connect(&self, config: &ConnectionConfig) -> Result<Connection, String> {
        connect(config).await
    }
}

/// Mirrors Go `TestConnection` — connect via the dialer, then drop.
pub async fn test_connection<D: Dialer>(config: &ConnectionConfig, dialer: &D) -> Result<(), String> {
    let _conn = dialer.connect(config).await?;
    Ok(())
}

fn resolve_target(
    config: &ConnectionConfig,
    ssh_config: &Option<ConfigHostEntry>,
) -> (String, u16, String) {
    let host = ssh_config
        .as_ref()
        .and_then(|c| c.host_name.clone())
        .unwrap_or_else(|| config.host.clone());
    let port = if config.port != 22 {
        config.port
    } else {
        ssh_config.as_ref().and_then(|c| c.port).unwrap_or(config.port)
    };
    let username = if config.username.is_empty() {
        ssh_config
            .as_ref()
            .and_then(|c| c.user.clone())
            .unwrap_or_else(|| std::env::var("USER").unwrap_or_else(|_| "root".to_string()))
    } else {
        config.username.clone()
    };
    (host, port, username)
}

fn enforce_host_key_decision(
    decision: Option<DecisionResult>,
    host: &str,
    port: u16,
) -> Result<(), String> {
    if let Some(d) = decision {
        match d.kind {
            Decision::KeyChanged => {
                return Err(format!(
                    "SSH host key changed for {host}:{port} — possible MITM. \
                     recorded={} offered={}. \
                     Edit ~/.claude/ssh/known_hosts manually to recover.",
                    d.recorded_fingerprint, d.offered_fingerprint
                ));
            }
            Decision::AlgorithmRejected => {
                return Err(format!(
                    "SSH host key algorithm {} is not on the allowlist",
                    d.algorithm
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Mirrors Go `Connect` — dial, verify host key, authenticate, open SFTP,
/// resolve the remote projects path.
pub async fn connect(config: &ConnectionConfig) -> Result<Connection, String> {
    let ssh_config = config_parser::resolve_host(&config.host);
    let (actual_host, actual_port, username) = resolve_target(config, &ssh_config);

    let russh_config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(120)),
        preferred: safe_preferred(),
        ..Default::default()
    });

    let decision_slot = Arc::new(Mutex::new(None));
    let handler = SshHandler {
        host: actual_host.clone(),
        port: actual_port,
        decision: Arc::clone(&decision_slot),
    };

    let connect_result =
        client::connect(russh_config, (actual_host.as_str(), actual_port), handler).await;

    // Surface the security decision first (a rejected key aborts the handshake,
    // so connect_result is Err — but we override with a descriptive message).
    let decision = decision_slot
        .lock()
        .ok()
        .and_then(|g| g.clone());
    enforce_host_key_decision(decision, &actual_host, actual_port)?;

    let mut session = connect_result.map_err(|e| format!("SSH connection failed: {e}"))?;

    authenticate(&mut session, config, &ssh_config, &username)
        .await
        .map_err(|e| format!("SSH authentication failed: {e}"))?;

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

    let remote_home = resolve_remote_home(&session).await;
    let remote_projects_path =
        find_remote_projects_path(&sftp, &username, remote_home.as_deref()).await;
    let remote_todos_path = match &remote_home {
        Some(home) => format!("{home}/.claude/todos"),
        None => format!("/home/{username}/.claude/todos"),
    };

    Ok(Connection {
        _handle: session,
        _sftp: sftp,
        remote_projects_path,
        _remote_todos_path: remote_todos_path,
        host: config.host.clone(),
    })
}

// ─── authentication ──────────────────────────────────────────────────────────

async fn authenticate(
    session: &mut client::Handle<SshHandler>,
    config: &ConnectionConfig,
    ssh_config: &Option<ConfigHostEntry>,
    username: &str,
) -> Result<(), String> {
    match config.auth_method.as_str() {
        "password" => auth_password(session, config, username).await,
        "privateKey" => auth_private_key(session, config, username).await,
        "agent" => auth_agent(session, username).await,
        _ => auth_auto(session, ssh_config, username).await,
    }
}

async fn auth_password(
    session: &mut client::Handle<SshHandler>,
    config: &ConnectionConfig,
    username: &str,
) -> Result<(), String> {
    let password = config.password.as_deref().ok_or("Password required")?;
    let ok = session
        .authenticate_password(username, password)
        .await
        .map_err(|e| e.to_string())?
        .success();
    if ok {
        Ok(())
    } else {
        Err("Password authentication failed".to_string())
    }
}

async fn auth_private_key(
    session: &mut client::Handle<SshHandler>,
    config: &ConnectionConfig,
    username: &str,
) -> Result<(), String> {
    let key_path = config.private_key_path.as_deref().unwrap_or("~/.ssh/id_rsa");
    let expanded = expand_tilde(key_path);
    let key = load_secret_key(&expanded, None)
        .map_err(|e| format!("Cannot read private key at {expanded}: {e}"))?;
    let pk = PrivateKeyWithHashAlg::new(Arc::new(key), None);
    let ok = session
        .authenticate_publickey(username, pk)
        .await
        .map_err(|e| e.to_string())?
        .success();
    if ok {
        Ok(())
    } else {
        Err("Public key authentication failed".to_string())
    }
}

async fn auth_agent(
    session: &mut client::Handle<SshHandler>,
    username: &str,
) -> Result<(), String> {
    let socket = agent_discovery::discover_agent_socket()
        .await
        .ok_or("SSH agent socket not found")?;
    let mut agent = AgentClient::connect_uds(&socket)
        .await
        .map_err(|e| format!("Cannot connect to SSH agent: {e}"))?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("Failed to list agent identities: {e}"))?;

    for identity in &identities {
        let pubkey = identity.public_key().into_owned();
        if let Ok(result) = session
            .authenticate_publickey_with(username, pubkey, None, &mut agent)
            .await
        {
            if result.success() {
                return Ok(());
            }
        }
    }
    Err(format!(
        "Agent authentication failed ({} identities tried)",
        identities.len()
    ))
}

async fn auth_auto(
    session: &mut client::Handle<SshHandler>,
    ssh_config: &Option<ConfigHostEntry>,
    username: &str,
) -> Result<(), String> {
    // 1. Config identity file → default key files.
    if ssh_config.as_ref().map(|c| c.has_identity_file).unwrap_or(false)
        && try_default_keys(session, username).await
    {
        return Ok(());
    }

    // 2. SSH agent.
    if let Ok(mut agent) = AgentClient::connect_env().await {
        if let Ok(identities) = agent.request_identities().await {
            for identity in &identities {
                let pubkey = identity.public_key().into_owned();
                if let Ok(result) = session
                    .authenticate_publickey_with(username, pubkey, None, &mut agent)
                    .await
                {
                    if result.success() {
                        return Ok(());
                    }
                }
            }
        }
    }

    // 3. Default key files.
    if try_default_keys(session, username).await {
        return Ok(());
    }

    Err("No authentication method succeeded".to_string())
}

async fn try_default_keys(session: &mut client::Handle<SshHandler>, username: &str) -> bool {
    for name in ["id_ed25519", "id_rsa", "id_ecdsa"] {
        let path = match dirs::home_dir() {
            Some(h) => h.join(".ssh").join(name),
            None => continue,
        };
        if let Ok(key) = load_secret_key(&path, None) {
            let pk = PrivateKeyWithHashAlg::new(Arc::new(key), None);
            if let Ok(result) = session.authenticate_publickey(username, pk).await {
                if result.success() {
                    return true;
                }
            }
        }
    }
    false
}

// ─── remote path resolution ──────────────────────────────────────────────────

async fn resolve_remote_home(session: &client::Handle<SshHandler>) -> Option<String> {
    let channel = session.channel_open_session().await.ok()?;
    channel.exec(true, "printf %s \"$HOME\"").await.ok()?;

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
    candidates.dedup();

    for candidate in &candidates {
        if sftp.try_exists(candidate.as_str()).await.unwrap_or(false) {
            return candidate.clone();
        }
    }

    match remote_home {
        Some(home) => format!("{home}/.claude/projects"),
        None => format!("/home/{username}/.claude/projects"),
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
