//! Small local benchmark for the bounded Codex maintenance readers.
//!
//! Usage: `cargo run --release --bin codex-maintenance-bench --manifest-path
//! src-tauri/Cargo.toml`. It performs 100 read-only iterations by default.

use std::time::Instant;

use claude_devtools_lib::files::checkpoint_recovery;
use claude_devtools_lib::files::codex_maintenance;
use claude_devtools_lib::types::source::SourceKind;

const ITERATIONS: usize = 100;
const P95_LIMIT_MS: u128 = 500;
const P99_LIMIT_MS: u128 = 1_000;
const RSS_DELTA_LIMIT_BYTES: u64 = 64 * 1024 * 1024;

fn main() {
    let mut samples = Vec::with_capacity(ITERATIONS);
    let mut failures = 0;
    let rss_before = rss_bytes();
    let mut dataset_cardinality = (0usize, 0usize, 0usize);
    for _ in 0..ITERATIONS {
        let started = Instant::now();
        report(
            "source status",
            codex_maintenance::source_status(),
            &mut failures,
        );
        report(
            "usage summary",
            codex_maintenance::read_usage_summary(),
            &mut failures,
        );
        let telemetry = codex_maintenance::list_telemetry(None, 100);
        if let Ok(page) = &telemetry {
            dataset_cardinality.0 = page.items.len();
            if let Some(item) = page.items.first() {
                report(
                    "telemetry detail",
                    codex_maintenance::read_telemetry(&item.id),
                    &mut failures,
                );
            }
        }
        report("telemetry listing", telemetry, &mut failures);
        let file_history = codex_maintenance::list_file_history(None, 100);
        if let Ok(page) = &file_history {
            dataset_cardinality.1 = page.items.len();
            if let Some(group) = page.items.first() {
                if let Some(version) = group.versions.last().copied() {
                    report(
                        "checkpoint detail",
                        codex_maintenance::read_checkpoint(
                            &group.session_uuid,
                            &group.file_hash,
                            version,
                        ),
                        &mut failures,
                    );
                    report(
                        "checkpoint origin resolution",
                        codex_maintenance::resolve_checkpoint_origins(
                            &group.session_uuid,
                            std::slice::from_ref(&group.file_hash),
                        ),
                        &mut failures,
                    );
                }
            }
        }
        report("file-history listing", file_history, &mut failures);
        report(
            "shell snapshot listing",
            codex_maintenance::list_shell_snapshots(None, 100),
            &mut failures,
        );
        let recovery = checkpoint_recovery::list(SourceKind::Codex);
        if let Ok(copies) = &recovery {
            dataset_cardinality.2 = copies.len();
        }
        report("recovery-copy listing", recovery, &mut failures);
        samples.push(started.elapsed().as_millis());
    }
    samples.sort_unstable();
    let p50 = percentile(&samples, 50);
    let p95 = percentile(&samples, 95);
    let p99 = percentile(&samples, 99);
    let rss_delta = rss_bytes().saturating_sub(rss_before);
    println!(
        "codex-maintenance-bench command=cargo-run-release iterations={ITERATIONS} limits=page100,scan5000,scan_bytes33554432 failures={failures} telemetry_items={} file_history_groups={} recovery_copies={} p50_ms={p50} p95_ms={p95} p99_ms={p99} rss_delta_bytes={rss_delta}",
        dataset_cardinality.0,
        dataset_cardinality.1,
        dataset_cardinality.2
    );
    if failures > 0 {
        eprintln!("benchmark failed because one or more reader operations failed");
        std::process::exit(1);
    }
    if p95 > P95_LIMIT_MS || p99 > P99_LIMIT_MS || rss_delta > RSS_DELTA_LIMIT_BYTES {
        eprintln!(
            "benchmark threshold exceeded: p95 <= {P95_LIMIT_MS}ms, p99 <= {P99_LIMIT_MS}ms, RSS delta <= {RSS_DELTA_LIMIT_BYTES} bytes"
        );
        std::process::exit(1);
    }
}

fn report<T>(label: &str, result: Result<T, String>, failures: &mut usize) {
    if let Err(error) = result {
        eprintln!("{label} failed: {error}");
        *failures += 1;
    }
}

fn percentile(samples: &[u128], percentile: usize) -> u128 {
    if samples.is_empty() {
        return 0;
    }
    let index = ((samples.len() - 1) * percentile).div_ceil(100);
    samples[index.min(samples.len() - 1)]
}

#[cfg(unix)]
fn rss_bytes() -> u64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    let result = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if result != 0 {
        return 0;
    }
    let usage = unsafe { usage.assume_init() };
    #[cfg(target_os = "macos")]
    {
        usage.ru_maxrss as u64
    }
    #[cfg(not(target_os = "macos"))]
    {
        (usage.ru_maxrss as u64).saturating_mul(1024)
    }
}

#[cfg(not(unix))]
fn rss_bytes() -> u64 {
    0
}
