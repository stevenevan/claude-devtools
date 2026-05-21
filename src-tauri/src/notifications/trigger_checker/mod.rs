/// TriggerChecker — checks tool_result, tool_use, and token_threshold triggers.

mod checks;
mod extraction;
mod tokens;
mod tool_maps;

pub use checks::{check_token_threshold_trigger, check_tool_result_trigger, check_tool_use_trigger};
pub use tokens::estimate_tokens;
pub use tool_maps::{build_tool_result_map, build_tool_use_map, ToolResultInfo, ToolUseInfo};

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
