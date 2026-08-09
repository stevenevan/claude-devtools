use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

use crate::config::root;
use crate::discovery::{path_decoder, project_scanner, subproject_registry::SubprojectRegistry};

use super::session_scan::{scan_session_light, DeduplicatedAssistantUsage};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCostSummary {
    pub current_month: SimpleCostPeriod,
    pub previous_month: SimpleCostPeriod,
    pub current_month_daily_points: Vec<SimpleCostDailyPoint>,
    pub current_month_project_totals: Vec<SimpleCostProjectTotal>,
    pub current_month_activity_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCostPeriod {
    pub month: String,
    pub approximate_cost_usd: f64,
    pub completeness: SimpleCostCompleteness,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCostCompleteness {
    pub is_complete: bool,
    pub activity_count: u32,
    pub priceable_activity_count: u32,
    pub unpriceable_activity_count: u32,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCostDailyPoint {
    pub date: String,
    pub approximate_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimpleCostProjectTotal {
    pub project_name: String,
    pub approximate_cost_usd: f64,
}

struct ScannedLightSession {
    project_name: String,
    assistant_usage: Vec<DeduplicatedAssistantUsage>,
    diagnostic: Option<String>,
}

#[derive(Default)]
struct CostPeriodAccumulator {
    approximate_cost_usd: f64,
    activity_count: u32,
    priceable_activity_count: u32,
    unpriceable_activity_count: u32,
    diagnostics: BTreeSet<String>,
}

impl CostPeriodAccumulator {
    fn add_record(&mut self, usage: &DeduplicatedAssistantUsage) {
        self.activity_count = self.activity_count.saturating_add(1);
        match usage.priced_usage_usd {
            Some(cost) if cost.is_finite() => {
                let next = self.approximate_cost_usd + cost;
                if next.is_finite() {
                    self.approximate_cost_usd = next;
                    self.priceable_activity_count = self.priceable_activity_count.saturating_add(1);
                } else {
                    self.diagnostics
                        .insert("period cost became non-finite".to_string());
                    self.unpriceable_activity_count =
                        self.unpriceable_activity_count.saturating_add(1);
                }
            }
            _ => {
                self.unpriceable_activity_count = self.unpriceable_activity_count.saturating_add(1);
            }
        }
    }

    fn add_diagnostic(&mut self, diagnostic: &str) {
        self.diagnostics.insert(diagnostic.to_string());
    }

    fn into_period(mut self, month: String) -> SimpleCostPeriod {
        if self.unpriceable_activity_count > 0 {
            self.diagnostics.insert("unpriceable activity".to_string());
        }
        let completeness = SimpleCostCompleteness {
            is_complete: self.unpriceable_activity_count == 0 && self.diagnostics.is_empty(),
            activity_count: self.activity_count,
            priceable_activity_count: self.priceable_activity_count,
            unpriceable_activity_count: self.unpriceable_activity_count,
            diagnostics: self.diagnostics.into_iter().collect(),
        };
        SimpleCostPeriod {
            month,
            approximate_cost_usd: self.approximate_cost_usd,
            completeness,
        }
    }
}

struct MonthContext {
    now_ms: f64,
    today: NaiveDate,
    current_month_start: NaiveDate,
    previous_month_start: NaiveDate,
    next_month_start: NaiveDate,
    current_month: String,
    previous_month: String,
}

impl MonthContext {
    fn from_now_ms(now_ms: f64) -> Option<Self> {
        if !now_ms.is_finite() || now_ms < i64::MIN as f64 || now_ms > i64::MAX as f64 {
            return None;
        }
        let now = Local.timestamp_millis_opt(now_ms as i64).single()?;
        let today = now.date_naive();
        let current_month_start = month_start(today);
        let previous_month_start = previous_month_start(current_month_start)?;
        let next_month_start = next_month_start(current_month_start)?;
        Some(Self {
            now_ms,
            today,
            current_month: month_key(current_month_start),
            previous_month: month_key(previous_month_start),
            current_month_start,
            previous_month_start,
            next_month_start,
        })
    }

    fn file_cutoff_ms(&self) -> f64 {
        local_start_ms(self.previous_month_start).unwrap_or(0.0)
    }
}

pub fn compute_simple_cost_summary() -> Result<SimpleCostSummary, String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or(0.0);
    let context = MonthContext::from_now_ms(now_ms)
        .ok_or_else(|| "cannot resolve current local calendar month".to_string())?;

    let claude_dir = root::claude_dir()?;
    let projects_dir = path_decoder::get_projects_base_path(&claude_dir);
    let mut registry = SubprojectRegistry::new();
    let projects = project_scanner::scan_projects(&projects_dir, &mut registry)?;
    let cutoff_ms = context.file_cutoff_ms();
    let mut scans = Vec::new();
    let mut seen_dirs = HashSet::new();

    for project in projects {
        let base_id = path_decoder::extract_base_dir(&project.id);
        if !seen_dirs.insert(base_id.to_string()) {
            continue;
        }
        let project_dir = projects_dir.join(base_id);
        if !project_dir.is_dir() {
            continue;
        }

        let mut entries: Vec<_> = match std::fs::read_dir(&project_dir) {
            Ok(entries) => entries.flatten().collect(),
            Err(_) => continue,
        };
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if !file_name.ends_with(".jsonl") || file_name.starts_with("agent_") {
                continue;
            }
            let Some(modified_ms) = modified_ms(&entry.path()) else {
                continue;
            };
            if modified_ms < cutoff_ms {
                continue;
            }
            let Some(summary) = scan_session_light(&entry.path()) else {
                continue;
            };
            scans.push(ScannedLightSession {
                project_name: project.name.clone(),
                assistant_usage: summary.assistant_usage,
                diagnostic: summary.cost_diagnostic,
            });
        }
    }

    aggregate_scanned_sessions(now_ms, &scans)
}

fn modified_ms(path: &Path) -> Option<f64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as f64)
}

fn aggregate_scanned_sessions(
    now_ms: f64,
    scans: &[ScannedLightSession],
) -> Result<SimpleCostSummary, String> {
    let context = MonthContext::from_now_ms(now_ms)
        .ok_or_else(|| "cannot resolve current local calendar month".to_string())?;
    let mut current = CostPeriodAccumulator::default();
    let mut previous = CostPeriodAccumulator::default();
    let mut daily_costs = BTreeMap::new();
    let mut project_costs = BTreeMap::new();
    seed_daily_points(&context, &mut daily_costs);

    for scan in scans {
        let mut touched_current = false;
        let mut touched_previous = false;
        for usage in &scan.assistant_usage {
            let Some(timestamp_ms) = usage.event_timestamp_ms else {
                continue;
            };
            if !timestamp_ms.is_finite() || timestamp_ms > context.now_ms {
                continue;
            }
            let Some(event_time) = Local.timestamp_millis_opt(timestamp_ms as i64).single() else {
                continue;
            };
            let event_date = event_time.date_naive();
            let event_month = month_key(month_start(event_date));
            if event_month == context.current_month {
                current.add_record(usage);
                touched_current = true;
                add_cost(
                    &mut daily_costs,
                    event_date,
                    usage.priced_usage_usd,
                    &mut current,
                );
                add_project_cost(
                    &mut project_costs,
                    &scan.project_name,
                    usage.priced_usage_usd,
                    &mut current,
                );
            } else if event_month == context.previous_month {
                previous.add_record(usage);
                touched_previous = true;
            }
        }
        if let Some(diagnostic) = scan.diagnostic.as_deref() {
            if touched_current {
                current.add_diagnostic(diagnostic);
            }
            if touched_previous {
                previous.add_diagnostic(diagnostic);
            }
        }
    }

    let current_month = current.into_period(context.current_month.clone());
    let previous_month = previous.into_period(context.previous_month.clone());
    let current_month_daily_points = daily_costs
        .into_iter()
        .map(|(date, approximate_cost_usd)| SimpleCostDailyPoint {
            date,
            approximate_cost_usd,
        })
        .collect();
    let mut current_month_project_totals: Vec<_> = project_costs
        .into_iter()
        .map(
            |(project_name, approximate_cost_usd)| SimpleCostProjectTotal {
                project_name,
                approximate_cost_usd,
            },
        )
        .collect();
    current_month_project_totals.sort_by(|left, right| {
        right
            .approximate_cost_usd
            .total_cmp(&left.approximate_cost_usd)
            .then_with(|| left.project_name.cmp(&right.project_name))
    });

    Ok(SimpleCostSummary {
        current_month_activity_count: current_month.completeness.activity_count,
        current_month,
        previous_month,
        current_month_daily_points,
        current_month_project_totals,
    })
}

fn seed_daily_points(context: &MonthContext, daily_costs: &mut BTreeMap<String, f64>) {
    let mut date = context.current_month_start;
    while date <= context.today && date < context.next_month_start {
        daily_costs.insert(date.format("%Y-%m-%d").to_string(), 0.0);
        date += chrono::Duration::days(1);
    }
}

fn add_cost(
    daily_costs: &mut BTreeMap<String, f64>,
    date: NaiveDate,
    cost: Option<f64>,
    period: &mut CostPeriodAccumulator,
) {
    let Some(cost) = cost.filter(|cost| cost.is_finite()) else {
        return;
    };
    let key = date.format("%Y-%m-%d").to_string();
    let Some(current) = daily_costs.get_mut(&key) else {
        return;
    };
    let next = *current + cost;
    if next.is_finite() {
        *current = next;
    } else {
        period.add_diagnostic("daily cost became non-finite");
    }
}

fn add_project_cost(
    project_costs: &mut BTreeMap<String, f64>,
    project_name: &str,
    cost: Option<f64>,
    period: &mut CostPeriodAccumulator,
) {
    let entry = project_costs.entry(project_name.to_string()).or_default();
    let Some(cost) = cost.filter(|cost| cost.is_finite()) else {
        return;
    };
    let next = *entry + cost;
    if next.is_finite() {
        *entry = next;
    } else {
        period.add_diagnostic("project cost became non-finite");
    }
}

fn month_start(date: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap_or(date)
}

fn previous_month_start(current: NaiveDate) -> Option<NaiveDate> {
    if current.month() == 1 {
        NaiveDate::from_ymd_opt(current.year().checked_sub(1)?, 12, 1)
    } else {
        NaiveDate::from_ymd_opt(current.year(), current.month() - 1, 1)
    }
}

fn next_month_start(current: NaiveDate) -> Option<NaiveDate> {
    if current.month() == 12 {
        NaiveDate::from_ymd_opt(current.year().checked_add(1)?, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(current.year(), current.month() + 1, 1)
    }
}

fn month_key(date: NaiveDate) -> String {
    date.format("%Y-%m").to_string()
}

fn local_start_ms(date: NaiveDate) -> Option<f64> {
    let naive = date.and_hms_opt(0, 0, 0)?;
    Local
        .from_local_datetime(&naive)
        .single()
        .or_else(|| Local.from_local_datetime(&naive).earliest())
        .or_else(|| Local.from_local_datetime(&naive).latest())
        .map(|datetime| datetime.timestamp_millis() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analytics::session_scan::LightSessionSummary;

    fn local_timestamp(year: i32, month: u32, day: u32, hour: u32, minute: u32) -> String {
        Local
            .with_ymd_and_hms(year, month, day, hour, minute, 0)
            .single()
            .expect("valid local timestamp")
            .to_rfc3339()
    }

    fn timestamp_ms(timestamp: &str) -> f64 {
        chrono::DateTime::parse_from_rfc3339(timestamp)
            .expect("valid timestamp")
            .timestamp_millis() as f64
    }

    fn usage(timestamp: &str, cost: Option<f64>) -> DeduplicatedAssistantUsage {
        DeduplicatedAssistantUsage {
            event_timestamp_ms: Some(timestamp_ms(timestamp)),
            priced_usage_usd: cost,
        }
    }

    fn scan(
        project_name: &str,
        assistant_usage: Vec<DeduplicatedAssistantUsage>,
        diagnostic: Option<&str>,
    ) -> ScannedLightSession {
        ScannedLightSession {
            project_name: project_name.to_string(),
            assistant_usage,
            diagnostic: diagnostic.map(str::to_string),
        }
    }

    fn fixture_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "claude-devtools-simple-cost-{}-{}.jsonl",
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    }

    fn scan_duplicate_fixture(first: &str, second: &str) -> LightSessionSummary {
        let path = fixture_path();
        std::fs::write(&path, format!("{first}\n{second}\n")).expect("write fixture");
        let summary = scan_session_light(&path).expect("scan fixture");
        std::fs::remove_file(path).expect("remove fixture");
        summary
    }

    fn assistant_line(request_id: &str, timestamp: &str, input_tokens: u64) -> String {
        format!(
            r#"{{"type":"assistant","requestId":"{request_id}","timestamp":"{timestamp}","message":{{"role":"assistant","model":"claude-sonnet-4","content":"visible","usage":{{"input_tokens":{input_tokens}}}}}}}"#
        )
    }

    #[test]
    fn assigns_events_to_local_months_at_boundary() {
        let now = local_timestamp(2026, 1, 15, 12, 0);
        let december = local_timestamp(2025, 12, 31, 23, 59);
        let january = local_timestamp(2026, 1, 1, 0, 1);
        let summary = aggregate_scanned_sessions(
            timestamp_ms(&now),
            &[
                scan("project", vec![usage(&december, Some(2.0))], None),
                scan("project", vec![usage(&january, Some(3.0))], None),
            ],
        )
        .expect("aggregate summary");

        assert_eq!(summary.current_month.month, "2026-01");
        assert_eq!(summary.previous_month.month, "2025-12");
        assert_eq!(summary.current_month.approximate_cost_usd, 3.0);
        assert_eq!(summary.previous_month.approximate_cost_usd, 2.0);
    }

    #[test]
    fn aggregates_current_month_daily_points_and_project_totals() {
        let now = local_timestamp(2026, 1, 3, 12, 0);
        let day_one = local_timestamp(2026, 1, 1, 9, 0);
        let day_two = local_timestamp(2026, 1, 2, 9, 0);
        let summary = aggregate_scanned_sessions(
            timestamp_ms(&now),
            &[
                scan(
                    "project-a",
                    vec![usage(&day_one, Some(1.0)), usage(&day_two, Some(2.0))],
                    None,
                ),
                scan("project-b", vec![usage(&day_two, Some(4.0))], None),
            ],
        )
        .expect("aggregate summary");

        assert_eq!(summary.current_month_activity_count, 3);
        assert_eq!(summary.current_month_daily_points.len(), 3);
        assert_eq!(
            summary.current_month_daily_points[0].approximate_cost_usd,
            1.0
        );
        assert_eq!(
            summary.current_month_daily_points[1].approximate_cost_usd,
            6.0
        );
        assert_eq!(
            summary.current_month_project_totals[0].project_name,
            "project-b"
        );
        assert_eq!(
            summary.current_month_project_totals[0].approximate_cost_usd,
            4.0
        );
        assert_eq!(
            summary.current_month_project_totals[1].project_name,
            "project-a"
        );
        assert_eq!(
            summary.current_month_project_totals[1].approximate_cost_usd,
            3.0
        );
    }

    #[test]
    fn mixed_priceable_activity_is_incomplete() {
        let now = local_timestamp(2026, 1, 3, 12, 0);
        let first = local_timestamp(2026, 1, 1, 9, 0);
        let second = local_timestamp(2026, 1, 2, 9, 0);
        let summary = aggregate_scanned_sessions(
            timestamp_ms(&now),
            &[scan(
                "project",
                vec![usage(&first, Some(1.5)), usage(&second, None)],
                None,
            )],
        )
        .expect("aggregate summary");

        let completeness = &summary.current_month.completeness;
        assert!(!completeness.is_complete);
        assert_eq!(completeness.activity_count, 2);
        assert_eq!(completeness.priceable_activity_count, 1);
        assert_eq!(completeness.unpriceable_activity_count, 1);
        assert!(completeness
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic == "unpriceable activity"));
        assert_eq!(summary.current_month.approximate_cost_usd, 1.5);
    }

    #[test]
    fn malformed_scan_and_tokenless_activity_are_incomplete() {
        let now = local_timestamp(2026, 1, 3, 12, 0);
        let tokenless = local_timestamp(2026, 1, 2, 9, 0);
        let summary = aggregate_scanned_sessions(
            timestamp_ms(&now),
            &[scan(
                "project",
                vec![usage(&tokenless, None)],
                Some("malformed JSONL record skipped"),
            )],
        )
        .expect("aggregate summary");

        let completeness = &summary.current_month.completeness;
        assert!(!completeness.is_complete);
        assert_eq!(completeness.unpriceable_activity_count, 1);
        assert!(completeness
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic == "malformed JSONL record skipped"));
    }

    #[test]
    fn duplicate_selection_crossing_midnight_is_order_independent() {
        let older = local_timestamp(2026, 1, 2, 23, 59);
        let newer = local_timestamp(2026, 1, 3, 0, 1);
        let first = assistant_line("request", &older, 100);
        let second = assistant_line("request", &newer, 200);
        let summary_a = scan_duplicate_fixture(&first, &second);
        let summary_b = scan_duplicate_fixture(&second, &first);
        let newer_ms = timestamp_ms(&newer);

        assert_eq!(summary_a.assistant_usage.len(), 1);
        assert_eq!(summary_b.assistant_usage.len(), 1);
        assert_eq!(
            summary_a.assistant_usage[0].event_timestamp_ms,
            Some(newer_ms)
        );
        assert_eq!(
            summary_b.assistant_usage[0].event_timestamp_ms,
            Some(newer_ms)
        );
    }

    #[test]
    fn duplicate_selection_crossing_december_and_january_is_order_independent() {
        let older = local_timestamp(2025, 12, 31, 23, 59);
        let newer = local_timestamp(2026, 1, 1, 0, 1);
        let first = assistant_line("request", &older, 100);
        let second = assistant_line("request", &newer, 200);
        let summary_a = scan_duplicate_fixture(&first, &second);
        let summary_b = scan_duplicate_fixture(&second, &first);
        let now = local_timestamp(2026, 1, 15, 12, 0);

        for summary in [summary_a, summary_b] {
            let aggregated = aggregate_scanned_sessions(
                timestamp_ms(&now),
                &[scan(
                    "project",
                    summary.assistant_usage,
                    summary.cost_diagnostic.as_deref(),
                )],
            )
            .expect("aggregate summary");
            assert_eq!(aggregated.current_month_activity_count, 1);
            assert!(aggregated.current_month.approximate_cost_usd > 0.0);
            assert_eq!(aggregated.previous_month.completeness.activity_count, 0);
            assert_eq!(aggregated.previous_month.approximate_cost_usd, 0.0);
        }
    }
}
