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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::chunks::{SemanticStepContent, SemanticStepTokens};
    use crate::types::messages::{ParsedMessageContent, TokenUsage};

    fn make_step(id: &str, source_msg_id: Option<&str>) -> SemanticStep {
        SemanticStep {
            id: id.to_string(),
            step_type: "output".to_string(),
            start_time: "2024-01-01T00:00:00Z".to_string(),
            end_time: None,
            duration_ms: 0.0,
            content: SemanticStepContent::default(),
            tokens: None,
            is_parallel: None,
            group_id: None,
            context: String::new(),
            agent_id: None,
            source_message_id: source_msg_id.map(|s| s.to_string()),
            effective_end_time: None,
            effective_duration_ms: None,
            is_gap_filled: None,
            context_tokens: None,
            accumulated_context: None,
            token_breakdown: None,
        }
    }

    fn make_msg(uuid: &str, input: u64, output: u64, cache_read: u64) -> ParsedMessage {
        ParsedMessage {
            uuid: uuid.to_string(),
            parent_uuid: None,
            message_type: "assistant".to_string(),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
            role: Some("assistant".to_string()),
            content: ParsedMessageContent::Text("".to_string()),
            usage: Some(TokenUsage {
                input_tokens: input,
                output_tokens: output,
                cache_read_input_tokens: Some(cache_read),
                cache_creation_input_tokens: None,
            }),
            model: None,
            cwd: None,
            git_branch: None,
            agent_id: None,
            is_sidechain: false,
            is_meta: false,
            user_type: None,
            tool_calls: vec![],
            tool_results: vec![],
            source_tool_use_id: None,
            source_tool_assistant_uuid: None,
            tool_use_result: None,
            is_compact_summary: None,
            request_id: None,
            subtype: None,
            event_data: None,
        }
    }

    #[test]
    fn test_empty_steps() {
        let mut steps: Vec<SemanticStep> = vec![];
        calculate_step_context(&mut steps, &[]);
        assert!(steps.is_empty());
    }

    #[test]
    fn test_context_from_source_message() {
        let mut steps = vec![make_step("s1", Some("a1"))];
        let msgs = vec![make_msg("a1", 500, 100, 50)];
        calculate_step_context(&mut steps, &msgs);
        // accumulated = input + cache_read + cache_creation = 500 + 50 + 0 = 550
        assert_eq!(steps[0].accumulated_context, Some(550));
        assert_eq!(steps[0].context_tokens, Some(0));
        assert!(steps[0].token_breakdown.is_some());
    }

    #[test]
    fn test_context_from_step_tokens_fallback() {
        let mut steps = vec![make_step("s1", None)];
        steps[0].tokens = Some(SemanticStepTokens {
            input: 200,
            output: 50,
            cached: Some(30),
        });
        calculate_step_context(&mut steps, &[]);
        // Fallback: input + cached = 200 + 30 = 230
        assert_eq!(steps[0].accumulated_context, Some(230));
    }

    #[test]
    fn test_context_no_source_no_tokens() {
        let mut steps = vec![make_step("s1", Some("nonexistent"))];
        calculate_step_context(&mut steps, &[]);
        // No source message found, no tokens → accumulated_context stays None
        assert!(steps[0].accumulated_context.is_none());
        // But token_breakdown is still set
        assert!(steps[0].token_breakdown.is_some());
    }

    #[test]
    fn test_multiple_steps_different_sources() {
        let mut steps = vec![
            make_step("s1", Some("a1")),
            make_step("s2", Some("a2")),
        ];
        let msgs = vec![
            make_msg("a1", 100, 50, 10),
            make_msg("a2", 200, 100, 20),
        ];
        calculate_step_context(&mut steps, &msgs);
        assert_eq!(steps[0].accumulated_context, Some(110)); // 100 + 10
        assert_eq!(steps[1].accumulated_context, Some(220)); // 200 + 20
    }
}
