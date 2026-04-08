use serde::{Deserialize, Serialize};

use super::injections::*;

/// Context stats for a single AI group turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextStats {
    pub new_injections: Vec<ContextInjection>,
    pub accumulated_injections: Vec<ContextInjection>,
    pub total_estimated_tokens: u64,
    pub tokens_by_category: TokensByCategory,
    pub new_counts: NewCountsByCategory,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_number: Option<u32>,
}

/// Phase information for session context tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPhase {
    pub phase_number: u32,
    pub first_ai_group_id: String,
    pub last_ai_group_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compact_group_id: Option<String>,
}

/// Compaction token delta between phases.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionTokenDelta {
    pub pre_compaction_tokens: u64,
    pub post_compaction_tokens: u64,
    pub delta: i64,
}

/// Session-wide phase information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPhaseInfo {
    pub phases: Vec<ContextPhase>,
    pub compaction_count: u32,
    pub ai_group_phase_map: std::collections::HashMap<String, u32>,
    pub compaction_token_deltas: std::collections::HashMap<String, CompactionTokenDelta>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_stats_serializes() {
        let stats = ContextStats {
            new_injections: vec![],
            accumulated_injections: vec![],
            total_estimated_tokens: 0,
            tokens_by_category: TokensByCategory::default(),
            new_counts: NewCountsByCategory::default(),
            phase_number: Some(1),
        };
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"totalEstimatedTokens\":0"));
    }

    #[test]
    fn phase_info_serializes() {
        let info = ContextPhaseInfo {
            phases: vec![ContextPhase {
                phase_number: 1,
                first_ai_group_id: "ai-0".to_string(),
                last_ai_group_id: "ai-5".to_string(),
                compact_group_id: None,
            }],
            compaction_count: 0,
            ai_group_phase_map: std::collections::HashMap::new(),
            compaction_token_deltas: std::collections::HashMap::new(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"phaseNumber\":1"));
    }
}
