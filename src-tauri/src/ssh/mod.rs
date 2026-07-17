//! SSH remote mode (W11). Ported from the Go oracle `internal/ssh/*` +
//! `internal/sshservice`. Recovered from the pre-2994b0f Rust and adapted from
//! russh 0.48 → 0.60 (keys moved to `russh::keys`; native async Handler trait;
//! `PrivateKeyWithHashAlg` for pubkey auth; `AuthResult::success()`).
//!
//! No Tauri import here — main.rs wires the 8 commands and injects the
//! `app.emit` status closure into `connect_with_retry`.

pub mod agent_discovery;
pub mod config_parser;
pub mod connection_manager;
pub mod known_hosts;
pub mod retry;
pub mod sftp_provider;
pub mod types;

pub use config_parser::{get_config_hosts, resolve_host};
pub use connection_manager::{connect, test_connection, Connection, NetDialer, State};
pub use retry::{connect_with_retry, default_retry_config, Dialer, RetryConfig};
pub use types::{ConfigHostEntry, ConnectionConfig, ConnectionStatus, LastConnection};
