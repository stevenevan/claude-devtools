use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralConfig {
    pub launch_at_login: bool,
    pub show_dock_icon: bool,
    pub theme: String,
    pub default_tab: String,
    pub claude_root_path: Option<String>,
    pub auto_expand_ai_groups: bool,
    pub use_native_title_bar: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub show_timestamps: bool,
    pub compact_mode: bool,
    pub syntax_highlighting: bool,
    #[serde(default = "default_code_block_theme")]
    pub code_block_theme: String,
    #[serde(default = "default_true")]
    pub show_line_numbers: bool,
    #[serde(default)]
    pub word_wrap: bool,
}

fn default_code_block_theme() -> String {
    "default".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            show_dock_icon: true,
            theme: "dark".to_string(),
            default_tab: "dashboard".to_string(),
            claude_root_path: None,
            auto_expand_ai_groups: false,
            use_native_title_bar: false,
        }
    }
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            show_timestamps: true,
            compact_mode: false,
            syntax_highlighting: true,
            code_block_theme: default_code_block_theme(),
            show_line_numbers: true,
            word_wrap: false,
        }
    }
}
