pub mod redact;

pub use redact::{REDACTED_MARKER, Redact};

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tracing::Subscriber;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_PREFIX: &str = "devtools";
const LOG_FILE_SUFFIX: &str = "jsonl";
const LOG_RETENTION_DAYS: u64 = 7;
const LOG_FILE_MAX_BYTES: u64 = 50 * 1024 * 1024;
const DEFAULT_FILTER: &str = "info";
const FILTER_ENV: &str = "CLAUDE_DEVTOOLS_LOG";

pub fn init() {
    let Some(log_dir) = resolve_log_dir() else {
        return;
    };
    install_to_dir(&log_dir);
}

pub fn install_to_dir(log_dir: &Path) {
    let Some((subscriber, guard)) = build_subscriber(log_dir) else {
        return;
    };
    if tracing::subscriber::set_global_default(subscriber).is_ok() {
        std::mem::forget(guard);
    }
}

fn build_subscriber(
    log_dir: &Path,
) -> Option<(impl Subscriber + Send + Sync + for<'a> LookupSpan<'a>, WorkerGuard)> {
    if let Err(e) = std::fs::create_dir_all(log_dir) {
        eprintln!("[logging] failed to create log dir {}: {e}", log_dir.display());
        return None;
    }

    enforce_size_cap(log_dir);
    enforce_retention(log_dir);

    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(LOG_FILE_PREFIX)
        .filename_suffix(LOG_FILE_SUFFIX)
        .build(log_dir)
        .ok()?;
    let redacting = redact::RedactingWriter::new(file_appender);
    let (non_blocking, guard) = tracing_appender::non_blocking(redacting);

    let filter =
        EnvFilter::try_from_env(FILTER_ENV).unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));

    let subscriber = tracing_subscriber::registry().with(filter).with(
        tracing_subscriber::fmt::layer()
            .json()
            .with_writer(NonBlockingMakeWriter(non_blocking))
            .with_ansi(false)
            .with_target(true)
            .with_current_span(false)
            .with_span_list(false),
    );

    Some((subscriber, guard))
}

fn resolve_log_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".claude").join(LOG_DIR_NAME))
}

fn enforce_retention(log_dir: &Path) {
    let cutoff = SystemTime::now() - Duration::from_secs(LOG_RETENTION_DAYS * 24 * 60 * 60);
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_managed_log(&path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified < cutoff {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn enforce_size_cap(log_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_managed_log(&path) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() >= LOG_FILE_MAX_BYTES {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn is_managed_log(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    name.starts_with(LOG_FILE_PREFIX) && name.ends_with(LOG_FILE_SUFFIX)
}

struct NonBlockingMakeWriter(tracing_appender::non_blocking::NonBlocking);

impl<'a> MakeWriter<'a> for NonBlockingMakeWriter {
    type Writer = tracing_appender::non_blocking::NonBlocking;

    fn make_writer(&'a self) -> Self::Writer {
        self.0.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use tempfile::tempdir;

    fn read_log_contents(dir: &Path) -> String {
        let mut out = String::new();
        let Ok(entries) = std::fs::read_dir(dir) else {
            return out;
        };
        for entry in entries.flatten() {
            if !is_managed_log(&entry.path()) {
                continue;
            }
            let Ok(mut f) = std::fs::File::open(entry.path()) else {
                continue;
            };
            let _ = f.read_to_string(&mut out);
        }
        out
    }

    #[test]
    fn build_subscriber_creates_log_dir() {
        let dir = tempdir().expect("tempdir");
        let nested = dir.path().join("nested");
        let (_subscriber, _guard) = build_subscriber(&nested).expect("subscriber built");
        assert!(nested.exists());
    }

    #[test]
    fn json_log_redacts_secret_payload() {
        let dir = tempdir().expect("tempdir");
        let (subscriber, guard) = build_subscriber(dir.path()).expect("subscriber built");

        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(
                target: "redaction_test",
                "captured token=sk-leak1234567890abcdef"
            );
        });

        drop(guard);
        std::thread::sleep(Duration::from_millis(300));

        let body = read_log_contents(dir.path());
        assert!(body.contains("redaction_test"), "event missing from log: {body}");
        assert!(!body.contains("sk-leak"), "secret leaked into log: {body}");
        assert!(
            body.contains(REDACTED_MARKER),
            "missing redaction marker: {body}"
        );
    }

    #[test]
    fn retention_keeps_recent_files() {
        let dir = tempdir().expect("tempdir");
        let recent = dir.path().join("devtools.recent.jsonl");
        std::fs::write(&recent, b"recent\n").expect("write recent");
        enforce_retention(dir.path());
        assert!(recent.exists());
    }

    #[test]
    fn size_cap_removes_oversize_files() {
        let dir = tempdir().expect("tempdir");
        let big = dir.path().join("devtools.big.jsonl");
        let f = std::fs::File::create(&big).expect("create");
        f.set_len(LOG_FILE_MAX_BYTES + 1).expect("set_len");
        drop(f);
        enforce_size_cap(dir.path());
        assert!(!big.exists(), "oversize log not removed");
    }

    #[test]
    fn is_managed_log_matches_prefix_and_suffix() {
        let base = Path::new("/tmp");
        assert!(is_managed_log(&base.join("devtools.jsonl")));
        assert!(is_managed_log(&base.join("devtools.2026-05-22.jsonl")));
        assert!(!is_managed_log(&base.join("other.jsonl")));
        assert!(!is_managed_log(&base.join("devtools.log")));
    }
}
