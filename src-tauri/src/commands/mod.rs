//! Tauri command layer (W12+). Thin `#[tauri::command]` wrappers over the domain
//! modules, kept out of `main.rs` so it stays under the file-size cap.
pub mod config;
pub mod files;
pub mod maintenance;
pub mod notify;
pub mod session;
