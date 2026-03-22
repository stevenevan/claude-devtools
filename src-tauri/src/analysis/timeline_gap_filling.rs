/// Fill timeline gaps so steps extend to next step's start.

use crate::types::chunks::SemanticStep;

pub fn fill_timeline_gaps(steps: &mut Vec<SemanticStep>, chunk_end_time: &str) {
    if steps.is_empty() {
        return;
    }

    steps.sort_by(|a, b| a.start_time.cmp(&b.start_time));

    let start_times: Vec<String> = steps.iter().map(|s| s.start_time.clone()).collect();
    let len = steps.len();

    for i in 0..len {
        // Keep original timing for subagents with meaningful duration
        let is_subagent_with_timing = steps[i].step_type == "subagent"
            && steps[i].end_time.is_some()
            && steps[i].duration_ms > 100.0;

        if is_subagent_with_timing {
            let end = steps[i].end_time.clone();
            let dur = steps[i].duration_ms;
            steps[i].effective_end_time = end;
            steps[i].effective_duration_ms = Some(dur);
            steps[i].is_gap_filled = Some(false);
            continue;
        }

        // Find next non-parallel step (>100ms apart)
        let mut next_start: Option<&str> = None;
        for j in (i + 1)..len {
            let diff = timestamp_diff_ms(&start_times[j], &start_times[i]).abs();
            if diff >= 100.0 {
                next_start = Some(&start_times[j]);
                break;
            }
        }

        let effective_end = next_start.unwrap_or(chunk_end_time);
        let effective_duration = timestamp_diff_ms(effective_end, &steps[i].start_time).max(0.0);

        steps[i].effective_end_time = Some(effective_end.to_string());
        steps[i].effective_duration_ms = Some(effective_duration);
        steps[i].is_gap_filled = Some(true);
    }
}

fn timestamp_diff_ms(a: &str, b: &str) -> f64 {
    let parse = |s: &str| -> f64 {
        chrono::DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.timestamp_millis() as f64)
            .unwrap_or(0.0)
    };
    parse(a) - parse(b)
}
