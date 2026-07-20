//! `config::state` — the full config manager ported from `internal/config`
//! (W12). `types` + `triggers` + `validation` are the DTO/validation surface;
//! `manager` owns `ConfigState` (lazy load, atomic persist, getters/setters).
pub mod manager;
pub mod triggers;
pub mod types;
pub mod validation;

pub use manager::{new_uuid, ConfigState};
