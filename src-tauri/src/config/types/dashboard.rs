use serde::{Deserialize, Serialize};

// Dashboard layout (widget order + hidden ids) — sprint 32.

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardConfig {
    #[serde(default)]
    pub widget_order: Vec<String>,
    #[serde(default)]
    pub hidden_widgets: Vec<String>,
}

// Budget Config — spending thresholds (no alerting in sprint 18; see roadmap).

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetConfig {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub daily_budget_usd: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub weekly_budget_usd: Option<f64>,
}
