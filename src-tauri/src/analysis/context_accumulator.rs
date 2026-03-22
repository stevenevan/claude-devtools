/// Calculate context token attribution for each semantic step.

use crate::types::chunks::{SemanticStep, TokenBreakdown};
use crate::types::messages::ParsedMessage;

pub fn calculate_step_context(steps: &mut [SemanticStep], messages: &[ParsedMessage]) {
    for step in steps.iter_mut() {
        // Find source message for this step
        let msg = step
            .source_message_id
            .as_ref()
            .and_then(|id| messages.iter().find(|m| &m.uuid == id));

        if let Some(msg) = msg {
            if let Some(ref usage) = msg.usage {
                let cache_read = usage.cache_read_input_tokens.unwrap_or(0);
                let cache_creation = usage.cache_creation_input_tokens.unwrap_or(0);
                let input_tokens = usage.input_tokens;
                step.accumulated_context = Some(input_tokens + cache_read + cache_creation);
            }
        } else if let Some(ref tokens) = step.tokens {
            step.accumulated_context = Some(tokens.input + tokens.cached.unwrap_or(0));
        }

        step.context_tokens = Some(0);
        step.token_breakdown = Some(TokenBreakdown {
            input: 0,
            output: 0,
            cache_read: 0,
            cache_creation: 0,
        });
    }
}
