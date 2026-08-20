//! Deterministic benchmark for the bounded Codex inspector and maintenance readers.
//!
//! Usage:
//! `cargo run --release --bin codex-maintenance-bench --manifest-path src-tauri/Cargo.toml --`
//! `--codex-root src-tauri/tests/fixtures/codex --app-data-root`
//! `src-tauri/tests/fixtures/codex-maintenance --expected-manifest`
//! `src-tauri/tests/fixtures/codex/benchmark-manifest.json`

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use claude_devtools_lib::files::{
    checkpoint_recovery, codex_maintenance, codex_reader, codex_settings,
};
use claude_devtools_lib::types::codex_maintenance::MaintenanceCapabilityState;
use claude_devtools_lib::types::source::{Diagnostic, SourceKind, SourceState};
use serde::Deserialize;

const DEFAULT_ITERATIONS: usize = 30;
const DEFAULT_WARMUPS: usize = 3;
const P95_LIMIT_MS: u128 = 500;
const P99_LIMIT_MS: u128 = 1_000;
const PEAK_RSS_LIMIT_BYTES: u64 = 64 * 1024 * 1024;
const TRANSCRIPT_ID: &str = "sessions/2026/08/13/rollout-fixture.jsonl";
const TASK_GRAPH_ID: &str = "fixture-graph";
const TELEMETRY_ID: &str = "fixture.json";
const CHECKPOINT_SESSION_ID: &str = "session-1";
const CHECKPOINT_FILE_HASH: &str = "hash-1";
const CHECKPOINT_VERSION: u32 = 1;
const SUPPORTED_SHELL_SNAPSHOT: &str = "session-1.sh";
const UNSAFE_SHELL_SNAPSHOT: &str = "unsafe.sh";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureManifest {
    format: String,
    codex_cli_version: String,
    history_items: usize,
    history_page_items: usize,
    history_next_page_items: usize,
    history_search_items: usize,
    transcript_items: usize,
    transcript_page_items: usize,
    transcript_next_page_items: usize,
    transcript_detail_events: usize,
    task_graphs: usize,
    task_nodes: usize,
    shell_snapshots: usize,
    settings_sources: usize,
    telemetry_items: usize,
    file_history_items: usize,
    recovery_copies: usize,
    unsupported: UnsupportedDiagnostics,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnsupportedDiagnostics {
    usage: String,
    telemetry: String,
    file_history: String,
}

#[derive(Debug)]
struct BenchmarkArgs {
    codex_root: PathBuf,
    app_data_root: PathBuf,
    expected_manifest: PathBuf,
    iterations: usize,
    warmups: usize,
}

#[derive(Debug)]
struct PreparedFixture {
    history_next_cursor: String,
    transcript_next_cursor: String,
}

#[derive(Debug)]
struct OperationReport {
    label: &'static str,
    samples_ms: Vec<u128>,
    failures: usize,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("benchmark failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let manifest = load_manifest(&args.expected_manifest)?;
    if manifest.format != "codex-benchmark-v1" {
        return Err(format!(
            "expected manifest format codex-benchmark-v1, got {}",
            manifest.format
        ));
    }
    env::set_var("CODEX_HOME", &args.codex_root);
    env::set_var("CLAUDE_DEVTOOLS_DIR", &args.app_data_root);

    let prepared = prepare_fixture(&manifest)?;
    let mut reports = Vec::new();
    reports.push(measure_operation(
        "history.first",
        args.warmups,
        args.iterations,
        || {
            let page = codex_reader::read_history_page(None, 1, None)?;
            expect_count(
                "history first page",
                page.items.len(),
                manifest.history_page_items,
            )?;
            if page.next_cursor.is_none() {
                return Err("history first page did not provide a next cursor".to_string());
            }
            Ok(())
        },
    ));
    let history_next_cursor = prepared.history_next_cursor.clone();
    reports.push(measure_operation(
        "history.next",
        args.warmups,
        args.iterations,
        || {
            let page = codex_reader::read_history_page(Some(&history_next_cursor), 1, None)?;
            expect_count(
                "history next page",
                page.items.len(),
                manifest.history_next_page_items,
            )
        },
    ));
    reports.push(measure_operation(
        "history.search",
        args.warmups,
        args.iterations,
        || {
            let page = codex_reader::read_history_page(None, 1, Some("second"))?;
            expect_count(
                "history search",
                page.items.len(),
                manifest.history_search_items,
            )
        },
    ));
    reports.push(measure_operation(
        "transcripts.first",
        args.warmups,
        args.iterations,
        || {
            let page = codex_reader::list_transcripts(None, 1)?;
            expect_count(
                "transcript first page",
                page.items.len(),
                manifest.transcript_page_items,
            )?;
            if page.next_cursor.is_none() {
                return Err("transcript first page did not provide a next cursor".to_string());
            }
            Ok(())
        },
    ));
    let transcript_next_cursor = prepared.transcript_next_cursor.clone();
    reports.push(measure_operation(
        "transcripts.next",
        args.warmups,
        args.iterations,
        || {
            let page = codex_reader::list_transcripts(Some(&transcript_next_cursor), 1)?;
            expect_count(
                "transcript next page",
                page.items.len(),
                manifest.transcript_next_page_items,
            )
        },
    ));
    reports.push(measure_operation(
        "transcript.detail",
        args.warmups,
        args.iterations,
        || {
            let page = codex_reader::read_transcript(TRANSCRIPT_ID, None, 100)?;
            expect_count(
                "transcript detail",
                page.items.len(),
                manifest.transcript_detail_events,
            )
        },
    ));
    reports.push(measure_operation(
        "task-graphs.list",
        args.warmups,
        args.iterations,
        || {
            let list = codex_reader::list_task_graphs()?;
            expect_count("task graph list", list.items.len(), manifest.task_graphs)
        },
    ));
    reports.push(measure_operation(
        "task-graph.detail",
        args.warmups,
        args.iterations,
        || {
            let graph = codex_reader::read_task_graph(TASK_GRAPH_ID)?;
            expect_count("task graph detail", graph.nodes.len(), manifest.task_nodes)
        },
    ));
    reports.push(measure_operation(
        "maintenance.source-status",
        args.warmups,
        args.iterations,
        || {
            let status = codex_maintenance::source_status()?;
            if status.source_kind != SourceKind::Codex || status.state != SourceState::Available {
                return Err(format!(
                    "Codex source is not available: {:?} {:?}",
                    status.source_kind, status.state
                ));
            }
            Ok(())
        },
    ));
    reports.push(measure_operation(
        "maintenance.shell-list",
        args.warmups,
        args.iterations,
        || {
            let page = codex_maintenance::list_shell_snapshots(None, 100)?;
            expect_count(
                "shell snapshot list",
                page.items.len(),
                manifest.shell_snapshots,
            )
        },
    ));
    reports.push(measure_operation(
        "maintenance.shell-detail-supported",
        args.warmups,
        args.iterations,
        || {
            let detail = codex_maintenance::read_shell_snapshot(SUPPORTED_SHELL_SNAPSHOT)?;
            if detail.content.is_none() {
                return Err("supported shell snapshot was withheld".to_string());
            }
            Ok(())
        },
    ));
    reports.push(measure_operation(
        "maintenance.shell-detail-unsafe",
        args.warmups,
        args.iterations,
        || {
            let detail = codex_maintenance::read_shell_snapshot(UNSAFE_SHELL_SNAPSHOT)?;
            if detail.content.is_some() {
                return Err("unsafe shell snapshot was projected".to_string());
            }
            Ok(())
        },
    ));
    reports.push(measure_operation(
        "settings.discover",
        args.warmups,
        args.iterations,
        || {
            let root = &args.codex_root;
            let settings = codex_settings::discover_at(
                root,
                &codex_settings::CodexSettingsContext {
                    project_root: root.to_string_lossy().into_owned(),
                    working_directory: Some(root.to_string_lossy().into_owned()),
                    profile: Some("review".to_string()),
                },
                None,
            )?;
            expect_count(
                "settings sources",
                settings.sources.len(),
                manifest.settings_sources,
            )
        },
    ));
    reports.push(measure_operation(
        "maintenance.usage-unsupported",
        args.warmups,
        args.iterations,
        || {
            let summary = codex_maintenance::read_usage_summary()?;
            expect_unsupported(
                "usage summary",
                summary.state,
                &summary.diagnostics,
                &manifest.unsupported.usage,
            )
        },
    ));
    reports.push(measure_operation(
        "maintenance.telemetry-unsupported",
        args.warmups,
        args.iterations,
        || {
            let page = codex_maintenance::list_telemetry(None, 100)?;
            expect_count("telemetry list", page.items.len(), manifest.telemetry_items)?;
            expect_diagnostic(
                "telemetry list",
                &page.diagnostics,
                &manifest.unsupported.telemetry,
            )
        },
    ));
    reports.push(measure_operation(
        "maintenance.telemetry-detail-unsupported",
        args.warmups,
        args.iterations,
        || {
            let detail = codex_maintenance::read_telemetry(TELEMETRY_ID)?;
            expect_diagnostic(
                "telemetry detail",
                &detail.diagnostics,
                &manifest.unsupported.telemetry,
            )
        },
    ));
    reports.push(measure_operation(
        "maintenance.file-history-unsupported",
        args.warmups,
        args.iterations,
        || {
            let page = codex_maintenance::list_file_history(None, 100)?;
            expect_count(
                "file history list",
                page.items.len(),
                manifest.file_history_items,
            )?;
            expect_diagnostic(
                "file history list",
                &page.diagnostics,
                &manifest.unsupported.file_history,
            )
        },
    ));
    reports.push(measure_operation(
        "maintenance.checkpoint-unsupported",
        args.warmups,
        args.iterations,
        || {
            let detail = codex_maintenance::read_checkpoint(
                CHECKPOINT_SESSION_ID,
                CHECKPOINT_FILE_HASH,
                CHECKPOINT_VERSION,
            )?;
            if detail.content.is_some() {
                return Err("unsupported Codex checkpoint content was projected".to_string());
            }
            expect_diagnostic(
                "checkpoint detail",
                &detail.diagnostics,
                &manifest.unsupported.file_history,
            )
        },
    ));
    reports.push(measure_operation(
        "maintenance.origin-unsupported",
        args.warmups,
        args.iterations,
        || {
            let origins = codex_maintenance::resolve_checkpoint_origins(
                CHECKPOINT_SESSION_ID,
                &[CHECKPOINT_FILE_HASH.to_string()],
            )?;
            if origins
                .get(CHECKPOINT_FILE_HASH)
                .and_then(Option::as_ref)
                .is_some()
            {
                return Err(
                    "Codex checkpoint origin was inferred without a pinned contract".to_string(),
                );
            }
            Ok(())
        },
    ));
    reports.push(measure_operation(
        "maintenance.recovery-list",
        args.warmups,
        args.iterations,
        || {
            let copies = checkpoint_recovery::list(SourceKind::Codex)?;
            expect_count("recovery copies", copies.len(), manifest.recovery_copies)
        },
    ));

    let peak_rss = peak_rss_bytes();
    for report in &reports {
        println!(
            "operation={} iterations={} warmups={} failures={} p50_ms={} p95_ms={} p99_ms={}",
            report.label,
            args.iterations,
            args.warmups,
            report.failures,
            percentile(&report.samples_ms, 50),
            percentile(&report.samples_ms, 95),
            percentile(&report.samples_ms, 99),
        );
    }
    let peak_rss = peak_rss?;
    let failures: usize = reports.iter().map(|report| report.failures).sum();
    println!(
        "summary=codex-maintenance-bench fixture_format={} codex_cli_version={} failures={} peak_rss_bytes={} limits=p95:{}ms,p99:{}ms,peak_rss:{}bytes",
        manifest.format,
        manifest.codex_cli_version,
        failures,
        peak_rss,
        P95_LIMIT_MS,
        P99_LIMIT_MS,
        PEAK_RSS_LIMIT_BYTES,
    );
    if failures > 0 {
        return Err("one or more benchmark operations failed".to_string());
    }
    if reports.iter().any(|report| {
        percentile(&report.samples_ms, 95) > P95_LIMIT_MS
            || percentile(&report.samples_ms, 99) > P99_LIMIT_MS
    }) {
        return Err(format!(
            "latency threshold exceeded: p95 <= {P95_LIMIT_MS}ms and p99 <= {P99_LIMIT_MS}ms per operation"
        ));
    }
    if peak_rss > PEAK_RSS_LIMIT_BYTES {
        return Err(format!(
            "peak RSS threshold exceeded: {peak_rss} > {PEAK_RSS_LIMIT_BYTES} bytes"
        ));
    }
    Ok(())
}

fn prepare_fixture(manifest: &FixtureManifest) -> Result<PreparedFixture, String> {
    let status = codex_maintenance::source_status()?;
    if status.source_kind != SourceKind::Codex || status.state != SourceState::Available {
        return Err("benchmark Codex source is not available".to_string());
    }

    let history = codex_reader::read_history_page(None, 1, None)?;
    expect_count(
        "history fixture",
        history.total_matched.unwrap_or_default(),
        manifest.history_items,
    )?;
    expect_count(
        "history first page",
        history.items.len(),
        manifest.history_page_items,
    )?;
    let history_next_cursor = history
        .next_cursor
        .ok_or_else(|| "history fixture did not produce a next cursor".to_string())?;
    let history_next = codex_reader::read_history_page(Some(&history_next_cursor), 1, None)?;
    expect_count(
        "history next page",
        history_next.items.len(),
        manifest.history_next_page_items,
    )?;
    let history_search = codex_reader::read_history_page(None, 1, Some("second"))?;
    expect_count(
        "history search",
        history_search.items.len(),
        manifest.history_search_items,
    )?;

    let transcripts = codex_reader::list_transcripts(None, 1)?;
    expect_count(
        "transcript fixture",
        transcripts.total_matched.unwrap_or_default(),
        manifest.transcript_items,
    )?;
    expect_count(
        "transcript first page",
        transcripts.items.len(),
        manifest.transcript_page_items,
    )?;
    let transcript_next_cursor = transcripts
        .next_cursor
        .ok_or_else(|| "transcript fixture did not produce a next cursor".to_string())?;
    let transcript_next = codex_reader::list_transcripts(Some(&transcript_next_cursor), 1)?;
    expect_count(
        "transcript next page",
        transcript_next.items.len(),
        manifest.transcript_next_page_items,
    )?;
    let transcript_detail = codex_reader::read_transcript(TRANSCRIPT_ID, None, 100)?;
    expect_count(
        "transcript detail",
        transcript_detail.items.len(),
        manifest.transcript_detail_events,
    )?;

    let graphs = codex_reader::list_task_graphs()?;
    expect_count(
        "task graph fixture",
        graphs.items.len(),
        manifest.task_graphs,
    )?;
    let graph = codex_reader::read_task_graph(TASK_GRAPH_ID)?;
    expect_count(
        "task graph fixture nodes",
        graph.nodes.len(),
        manifest.task_nodes,
    )?;

    let shell = codex_maintenance::list_shell_snapshots(None, 100)?;
    expect_count(
        "shell snapshot fixture",
        shell.items.len(),
        manifest.shell_snapshots,
    )?;
    if codex_maintenance::read_shell_snapshot(SUPPORTED_SHELL_SNAPSHOT)?
        .content
        .is_none()
    {
        return Err("supported shell snapshot fixture was withheld".to_string());
    }
    if codex_maintenance::read_shell_snapshot(UNSAFE_SHELL_SNAPSHOT)?
        .content
        .is_some()
    {
        return Err("unsafe shell snapshot fixture was projected".to_string());
    }

    let root = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "CODEX_HOME was not configured".to_string())?;
    let settings = codex_settings::discover_at(
        &root,
        &codex_settings::CodexSettingsContext {
            project_root: root.to_string_lossy().into_owned(),
            working_directory: Some(root.to_string_lossy().into_owned()),
            profile: Some("review".to_string()),
        },
        None,
    )?;
    expect_count(
        "settings fixture",
        settings.sources.len(),
        manifest.settings_sources,
    )?;

    let usage = codex_maintenance::read_usage_summary()?;
    expect_unsupported(
        "usage fixture",
        usage.state,
        &usage.diagnostics,
        &manifest.unsupported.usage,
    )?;
    let telemetry = codex_maintenance::list_telemetry(None, 100)?;
    expect_count(
        "telemetry fixture",
        telemetry.items.len(),
        manifest.telemetry_items,
    )?;
    expect_diagnostic(
        "telemetry fixture",
        &telemetry.diagnostics,
        &manifest.unsupported.telemetry,
    )?;
    let telemetry_detail = codex_maintenance::read_telemetry(TELEMETRY_ID)?;
    expect_diagnostic(
        "telemetry detail fixture",
        &telemetry_detail.diagnostics,
        &manifest.unsupported.telemetry,
    )?;
    let file_history = codex_maintenance::list_file_history(None, 100)?;
    expect_count(
        "file history fixture",
        file_history.items.len(),
        manifest.file_history_items,
    )?;
    expect_diagnostic(
        "file history fixture",
        &file_history.diagnostics,
        &manifest.unsupported.file_history,
    )?;
    let checkpoint = codex_maintenance::read_checkpoint(
        CHECKPOINT_SESSION_ID,
        CHECKPOINT_FILE_HASH,
        CHECKPOINT_VERSION,
    )?;
    if checkpoint.content.is_some() {
        return Err("checkpoint fixture content was projected".to_string());
    }
    expect_diagnostic(
        "checkpoint fixture",
        &checkpoint.diagnostics,
        &manifest.unsupported.file_history,
    )?;
    let origins = codex_maintenance::resolve_checkpoint_origins(
        CHECKPOINT_SESSION_ID,
        &[CHECKPOINT_FILE_HASH.to_string()],
    )?;
    if origins
        .get(CHECKPOINT_FILE_HASH)
        .and_then(Option::as_ref)
        .is_some()
    {
        return Err("checkpoint fixture origin was inferred".to_string());
    }
    expect_count(
        "recovery fixture",
        checkpoint_recovery::list(SourceKind::Codex)?.len(),
        manifest.recovery_copies,
    )?;

    Ok(PreparedFixture {
        history_next_cursor,
        transcript_next_cursor,
    })
}

fn measure_operation<F>(
    label: &'static str,
    warmups: usize,
    iterations: usize,
    mut operation: F,
) -> OperationReport
where
    F: FnMut() -> Result<(), String>,
{
    let mut failures = 0;
    for index in 0..warmups {
        if let Err(error) = operation() {
            eprintln!("operation={label} phase=warmup index={index} error={error}");
            failures += 1;
        }
    }
    let mut samples_ms = Vec::with_capacity(iterations);
    for index in 0..iterations {
        let started = Instant::now();
        if let Err(error) = operation() {
            eprintln!("operation={label} phase=sample index={index} error={error}");
            failures += 1;
        }
        samples_ms.push(started.elapsed().as_millis());
    }
    OperationReport {
        label,
        samples_ms,
        failures,
    }
}

fn expect_count(label: &str, actual: usize, expected: usize) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{label} expected {expected} items, got {actual}"))
    }
}

fn expect_unsupported(
    label: &str,
    state: MaintenanceCapabilityState,
    diagnostics: &[Diagnostic],
    expected_code: &str,
) -> Result<(), String> {
    if state != MaintenanceCapabilityState::Unsupported {
        return Err(format!("{label} state was {state:?}, expected Unsupported"));
    }
    expect_diagnostic(label, diagnostics, expected_code)
}

fn expect_diagnostic(
    label: &str,
    diagnostics: &[Diagnostic],
    expected_code: &str,
) -> Result<(), String> {
    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == expected_code)
    {
        Ok(())
    } else {
        Err(format!("{label} did not report diagnostic {expected_code}"))
    }
}

fn load_manifest(path: &Path) -> Result<FixtureManifest, String> {
    let bytes = fs::read(path).map_err(|error| format!("read expected manifest: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("parse expected manifest: {error}"))
}

fn parse_args() -> Result<BenchmarkArgs, String> {
    let values: Vec<String> = env::args().skip(1).collect();
    let mut codex_root = None;
    let mut app_data_root = None;
    let mut expected_manifest = None;
    let mut iterations = DEFAULT_ITERATIONS;
    let mut warmups = DEFAULT_WARMUPS;
    let mut index = 0;
    while index < values.len() {
        let flag = values[index].as_str();
        if flag == "--help" || flag == "-h" {
            println!("{}", usage());
            std::process::exit(0);
        }
        let value = |index: &mut usize, flag: &str| -> Result<String, String> {
            *index += 1;
            values
                .get(*index)
                .cloned()
                .ok_or_else(|| format!("{flag} requires a value"))
        };
        match flag {
            "--codex-root" => codex_root = Some(value(&mut index, flag)?),
            "--app-data-root" => app_data_root = Some(value(&mut index, flag)?),
            "--expected-manifest" => expected_manifest = Some(value(&mut index, flag)?),
            "--iterations" => {
                iterations = value(&mut index, flag)?
                    .parse()
                    .map_err(|error| format!("invalid --iterations: {error}"))?;
                if iterations == 0 {
                    return Err("--iterations must be greater than zero".to_string());
                }
            }
            "--warmups" => {
                warmups = value(&mut index, flag)?
                    .parse()
                    .map_err(|error| format!("invalid --warmups: {error}"))?;
            }
            _ => return Err(format!("unknown argument {flag}\n{}", usage())),
        }
        index += 1;
    }
    let codex_root = existing_directory(
        codex_root.ok_or_else(required("--codex-root"))?,
        "Codex root",
    )?;
    let app_data_root = existing_directory(
        app_data_root.ok_or_else(required("--app-data-root"))?,
        "app-data root",
    )?;
    let expected_manifest = existing_file(
        expected_manifest.ok_or_else(required("--expected-manifest"))?,
        "expected manifest",
    )?;
    Ok(BenchmarkArgs {
        codex_root,
        app_data_root,
        expected_manifest,
        iterations,
        warmups,
    })
}

fn required(flag: &'static str) -> impl FnOnce() -> String {
    move || format!("{flag} is required")
}

fn existing_directory(value: String, label: &str) -> Result<PathBuf, String> {
    let path = resolve_path(&value);
    let canonical =
        fs::canonicalize(&path).map_err(|error| format!("{label} is unavailable: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!(
            "{label} is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn existing_file(value: String, label: &str) -> Result<PathBuf, String> {
    let path = resolve_path(&value);
    let canonical =
        fs::canonicalize(&path).map_err(|error| format!("{label} is unavailable: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("{label} is not a file: {}", canonical.display()));
    }
    Ok(canonical)
}

fn resolve_path(value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .expect("benchmark current directory")
            .join(path)
    }
}

fn usage() -> &'static str {
    "usage: codex-maintenance-bench --codex-root PATH --app-data-root PATH --expected-manifest PATH [--iterations N] [--warmups N]"
}

fn percentile(samples: &[u128], percentile: usize) -> u128 {
    if samples.is_empty() {
        return 0;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let index = ((sorted.len() - 1) * percentile).div_ceil(100);
    sorted[index.min(sorted.len() - 1)]
}

#[cfg(unix)]
fn peak_rss_bytes() -> Result<u64, String> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    let result = unsafe { libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) };
    if result != 0 {
        return Err("peak RSS measurement is unavailable".to_string());
    }
    let usage = unsafe { usage.assume_init() };
    #[cfg(target_os = "macos")]
    let bytes = usage.ru_maxrss as u64;
    #[cfg(not(target_os = "macos"))]
    let bytes = (usage.ru_maxrss as u64).saturating_mul(1024);
    if bytes == 0 {
        return Err("peak RSS measurement returned zero".to_string());
    }
    Ok(bytes)
}

#[cfg(not(unix))]
fn peak_rss_bytes() -> Result<u64, String> {
    Err("peak RSS measurement is unavailable on this platform".to_string())
}
