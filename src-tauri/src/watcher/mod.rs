mod lifecycle;
mod parsers;
mod types;

pub use lifecycle::{resolve_claude_dir, start_watcher, stop_watcher};
pub use types::{FileChangeEvent, WatcherState};

#[cfg(test)]
mod tests;
