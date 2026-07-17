/// Steps: thinking, tool_call, tool_result, output, subagent, interruption.

use crate::types::chunks::{Process, SemanticStep, SemanticStepContent, SemanticStepTokens};
use crate::types::jsonl::ContentBlock;
use crate::types::messages::{ParsedMessage, ParsedMessageContent};

pub fn extract_semantic_steps(
    responses: &[ParsedMessage],
    processes: &[Process],
) -> Vec<SemanticStep> {
    let mut steps = Vec::new();
    let mut counter = 0u32;

    for msg in responses {
        if msg.message_type == "assistant" {
            if let ParsedMessageContent::Blocks(ref blocks) = msg.content {
                for block in blocks {
                    match block {
                        ContentBlock::Thinking { thinking, .. } => {
                            let tokens = count_tokens(thinking);
                            steps.push(SemanticStep {
                                id: format!("{}-thinking-{}", msg.uuid, counter),
                                step_type: "thinking".to_string(),
                                start_time: msg.timestamp.clone(),
                                end_time: None,
                                duration_ms: 0.0,
                                content: SemanticStepContent {
                                    thinking_text: Some(thinking.clone()),
                                    token_count: Some(tokens),
                                    ..Default::default()
                                },
                                tokens: Some(SemanticStepTokens {
                                    input: 0,
                                    output: tokens,
                                    cached: None,
                                }),
                                context: context_for(msg),
                                agent_id: msg.agent_id.clone(),
                                source_message_id: Some(msg.uuid.clone()),
                                ..Default::default()
                            });
                            counter += 1;
                        }
                        ContentBlock::ToolUse { id, name, input } => {
                            let call_str =
                                format!("{}{}", name, serde_json::to_string(input).unwrap_or_default());
                            let tokens = count_tokens(&call_str);
                            steps.push(SemanticStep {
                                id: id.clone(),
                                step_type: "tool_call".to_string(),
                                start_time: msg.timestamp.clone(),
                                end_time: None,
                                duration_ms: 0.0,
                                content: SemanticStepContent {
                                    tool_name: Some(name.clone()),
                                    tool_input: Some(input.clone()),
                                    source_model: msg.model.clone(),
                                    ..Default::default()
                                },
                                tokens: Some(SemanticStepTokens {
                                    input: tokens,
                                    output: 0,
                                    cached: None,
                                }),
                                context: context_for(msg),
                                agent_id: msg.agent_id.clone(),
                                source_message_id: Some(msg.uuid.clone()),
                                ..Default::default()
                            });
                        }
                        ContentBlock::Text { text } => {
                            if !text.is_empty() {
                                let tokens = count_tokens(text);
                                steps.push(SemanticStep {
                                    id: format!("{}-output-{}", msg.uuid, counter),
                                    step_type: "output".to_string(),
                                    start_time: msg.timestamp.clone(),
                                    end_time: None,
                                    duration_ms: 0.0,
                                    content: SemanticStepContent {
                                        output_text: Some(text.clone()),
                                        token_count: Some(tokens),
                                        ..Default::default()
                                    },
                                    tokens: Some(SemanticStepTokens {
                                        input: 0,
                                        output: tokens,
                                        cached: None,
                                    }),
                                    context: context_for(msg),
                                    agent_id: msg.agent_id.clone(),
                                    source_message_id: Some(msg.uuid.clone()),
                                    ..Default::default()
                                });
                                counter += 1;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        // Tool results from internal user messages
        if msg.message_type == "user" && !msg.tool_results.is_empty() {
            for result in &msg.tool_results {
                let content_str = match &result.content {
                    serde_json::Value::String(s) => s.clone(),
                    other => serde_json::to_string(other).unwrap_or_default(),
                };
                let tokens = count_tokens(&content_str);
                steps.push(SemanticStep {
                    id: result.tool_use_id.clone(),
                    step_type: "tool_result".to_string(),
                    start_time: msg.timestamp.clone(),
                    end_time: None,
                    duration_ms: 0.0,
                    content: SemanticStepContent {
                        tool_result_content: Some(content_str),
                        is_error: Some(result.is_error),
                        tool_use_result: msg.tool_use_result.clone(),
                        token_count: Some(tokens),
                        ..Default::default()
                    },
                    context: context_for(msg),
                    agent_id: msg.agent_id.clone(),
                    ..Default::default()
                });
            }
        }

        // Interruption detection
        if msg.message_type == "user" {
            if let ParsedMessageContent::Blocks(ref blocks) = msg.content {
                for block in blocks {
                    if let ContentBlock::Text { text } = block {
                        if text.contains("[Request interrupted by user]")
                            || text.contains("[Request interrupted by user for tool use]")
                        {
                            steps.push(SemanticStep {
                                id: format!("{}-interruption-{}", msg.uuid, counter),
                                step_type: "interruption".to_string(),
                                start_time: msg.timestamp.clone(),
                                end_time: None,
                                duration_ms: 0.0,
                                content: SemanticStepContent {
                                    interruption_text: Some(text.clone()),
                                    ..Default::default()
                                },
                                context: context_for(msg),
                                agent_id: msg.agent_id.clone(),
                                ..Default::default()
                            });
                            counter += 1;
                        }
                    }
                }
            }

            // User-rejected tool use
            if let Some(ref tur) = msg.tool_use_result {
                if tur.as_str() == Some("User rejected tool use") {
                    steps.push(SemanticStep {
                        id: format!("{}-interruption-{}", msg.uuid, counter),
                        step_type: "interruption".to_string(),
                        start_time: msg.timestamp.clone(),
                        end_time: None,
                        duration_ms: 0.0,
                        content: SemanticStepContent {
                            interruption_text: Some("Request interrupted by user".to_string()),
                            ..Default::default()
                        },
                        context: context_for(msg),
                        agent_id: msg.agent_id.clone(),
                        ..Default::default()
                    });
                    counter += 1;
                }
            }
        }
    }

    // Add subagent steps
    for process in processes {
        steps.push(SemanticStep {
            id: process.id.clone(),
            step_type: "subagent".to_string(),
            start_time: process.start_time.clone(),
            end_time: Some(process.end_time.clone()),
            duration_ms: process.duration_ms,
            content: SemanticStepContent {
                subagent_id: Some(process.id.clone()),
                subagent_description: process.description.clone(),
                ..Default::default()
            },
            tokens: Some(SemanticStepTokens {
                input: process.metrics.input_tokens,
                output: process.metrics.output_tokens,
                cached: Some(process.metrics.cache_read_tokens),
            }),
            is_parallel: Some(process.is_parallel),
            context: "subagent".to_string(),
            agent_id: Some(process.id.clone()),
            ..Default::default()
        });
    }

    steps.sort_by(|a, b| a.start_time.cmp(&b.start_time));
    steps
}

fn context_for(msg: &ParsedMessage) -> String {
    if msg.agent_id.is_some() {
        "subagent".to_string()
    } else {
        "main".to_string()
    }
}

/// Estimate token count: ~1 token per 4 characters.
fn count_tokens(s: &str) -> u64 {
    if s.is_empty() {
        0
    } else {
        ((s.len() as f64) / 4.0).ceil() as u64
    }
}

// Default impl for SemanticStep and SemanticStepContent
impl Default for SemanticStep {
    fn default() -> Self {
        Self {
            id: String::new(),
            step_type: String::new(),
            start_time: String::new(),
            end_time: None,
            duration_ms: 0.0,
            content: SemanticStepContent::default(),
            tokens: None,
            is_parallel: None,
            group_id: None,
            context: "main".to_string(),
            agent_id: None,
            source_message_id: None,
            effective_end_time: None,
            effective_duration_ms: None,
            is_gap_filled: None,
            context_tokens: None,
            accumulated_context: None,
            token_breakdown: None,
        }
    }
}

impl Default for SemanticStepContent {
    fn default() -> Self {
        Self {
            thinking_text: None,
            tool_name: None,
            tool_input: None,
            tool_result_content: None,
            is_error: None,
            tool_use_result: None,
            token_count: None,
            subagent_id: None,
            subagent_description: None,
            output_text: None,
            source_model: None,
            interruption_text: None,
        }
    }
}
