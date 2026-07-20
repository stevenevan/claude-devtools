//! Insights (W9): per-project usage analytics, error hotspot/cluster detection,
//! per-session file-dependency graphs, tool-call↔result linking, and
//! permission-rule mining. Ported from the Go `internal/insights/*` packages,
//! kept byte-parity with Go's `encoding/json` output.

pub mod error_hotspots;
pub mod file_graph;
pub mod permissions_analyzer;
pub mod tool_analytics;
pub mod tool_linking;
