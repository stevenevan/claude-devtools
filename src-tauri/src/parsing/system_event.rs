use crate::types::jsonl::RawJsonlEntry;
use crate::types::messages::SystemEventData;

pub fn build_system_event_data(entry: &RawJsonlEntry) -> Option<SystemEventData> {
    let subtype = entry.subtype.as_deref()?;
    match subtype {
        "api_error" => {
            let mut error_status: Option<u16> = None;
            let mut error_type: Option<String> = None;
            let mut error_message: Option<String> = None;

            if let Some(ref err) = entry.error {
                error_status = err
                    .get("status")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u16);
                if let Some(inner) = err.get("error") {
                    error_type = inner
                        .get("type")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    error_message = inner
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
            if error_type.is_none() {
                if let Some(ref cause) = entry.cause {
                    error_type = cause
                        .get("code")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }

            Some(SystemEventData {
                subtype: subtype.to_string(),
                error_status,
                error_type,
                error_message,
                retry_attempt: entry.retry_attempt,
                max_retries: entry.max_retries,
                retry_in_ms: entry.retry_in_ms,
                ..Default::default()
            })
        }
        "bridge_status" => Some(SystemEventData {
            subtype: subtype.to_string(),
            bridge_content: entry.content.clone(),
            bridge_url: entry.url.clone(),
            ..Default::default()
        }),
        "memory_saved" => Some(SystemEventData {
            subtype: subtype.to_string(),
            written_paths: entry.written_paths.clone(),
            memory_verb: entry.verb.clone(),
            ..Default::default()
        }),
        "turn_duration" => Some(SystemEventData {
            subtype: subtype.to_string(),
            duration_ms: entry.duration_ms,
            ..Default::default()
        }),
        _ => None,
    }
}
