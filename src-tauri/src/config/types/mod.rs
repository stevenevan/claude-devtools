mod app;
mod dashboard;
mod general;
mod http;
mod merge;
mod notifications;
mod sessions;
mod ssh;

pub use app::{AppConfig, CustomTheme, PluginsConfig, ShortcutsConfig, ThemesConfig};
pub use dashboard::{BudgetConfig, DashboardConfig};
pub use general::{DisplayConfig, GeneralConfig};
pub use http::{ClaudeRootInfo, HttpServerConfig};
pub use merge::{merge_config_with_defaults, normalize_claude_root_path};
pub use notifications::{NotificationConfig, NotificationTrigger};
pub use sessions::{
    AnnotationEntry, AnnotationExportBundle, BookmarkEntry, FilterPreset, HiddenSession,
    ImportReport, PinnedSession, SessionsConfig,
};
pub use ssh::{SshConnectionProfile, SshLastConnection, SshPersistConfig};
