//! Analysis engine (W5): the chunk-building pipeline that turns `ParsedMessage[]`
//! into `SessionDetail { chunks, metrics, processes }`. Ported from the old Rust
//! `analysis/*` and reconciled against the slimmed current Go `internal/analysis`
//! (the SessionDetail golden = `cmd/cli show-session` is the arbiter).
//!
//! The old Rust analysis also held analytics/insights (error_hotspots,
//! tool_analytics, file_graph, tokenizer, …) — those are Cycle C, not recovered.
pub mod chunk_builder;
pub mod chunk_factory;
pub mod context_accumulator;
pub mod process_linker;
pub mod semantic_step_extractor;
pub mod semantic_step_grouper;
pub mod state_machine;
pub mod summarizer;
pub mod timeline_gap_filling;
pub mod tool_execution_builder;
