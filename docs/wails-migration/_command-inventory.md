# Command Inventory — 118/118 (W5 done-contract)

Every `tauri::command` in `src-tauri/src/lib.rs` `invoke_handler` (118 entries) mapped to
its owning Go service + W5 ticket. Check a box when the Go method exists AND `wails3 generate
bindings -ts` emits its TS function under `frontend/bindings/claude-devtools/internal/<svc>service/`.
**DONE — all 118 bound** (verified vs generated bindings 2026-06-20). Re-audited in W8-T2.

Source of truth: `lib.rs:58-175`. Each command owned by exactly one service:
System 8 · Session 19 · Analytics 12 · Files 10 · Search 5 · Config 40 · Notify 8 ·
Ssh 8 · Snapshot 4 · Timing 4 = **118**.

## SystemService (8) — `commands/system.rs`, `commands/window.rs`, watcher, `plugins`
- [x] `get_app_version`
- [x] `start_watching`
- [x] `stop_watching`
- [x] `log_renderer_event`
- [x] `get_all_todos`
- [x] `window_bus_broadcast`  — single-app `Event.Emit` broadcast (not multi-window)
- [x] `window_bus_ready`
- [x] `plugins_discover`  — `commands/.../plugins`

## SessionService (19) — `commands/sessions.rs`, `commands/projects.rs`, `parsing/`, `analysis/`
- [x] `parse_session`
- [x] `parse_session_metrics`
- [x] `get_projects`
- [x] `get_sessions_paginated`
- [x] `get_session_detail`
- [x] `get_session_detail_incremental`  — W5-T8a (cache state machine `sessions.rs:216-293`)
- [x] `get_sessions`
- [x] `get_sessions_by_ids`
- [x] `get_waterfall_data`  — one-line alias for `get_session_detail` (stub)
- [x] `get_subagent_detail`
- [x] `get_session_groups`  — hardcoded stub (`agents_search`)
- [x] `get_repository_groups`  — hardcoded stub
- [x] `get_worktree_sessions`  — hardcoded stub
- [x] `context_list`  — stub (`agents_search/context.rs`)
- [x] `context_get_active`  — stub
- [x] `context_switch`  — stub
- [x] `session_scroll_to_line`
- [x] `get_session_tldr`  — W5-T8a (`analysis/summarizer.rs`)
- [x] `link_tool_calls`  — W5-T2 (`analysis/tool_linking.rs`, arch H2 deferral)

## AnalyticsService (12) — `commands/analytics.rs`, `analysis/commands/*`, `analysis/tokenizer.rs`
- [x] `get_analytics`
- [x] `get_cost_forecast`
- [x] `get_productivity_metrics`
- [x] `get_session_duration_stats`
- [x] `get_model_comparison`  — `analytics/model_comparison.rs`
- [x] `get_tool_analytics`  — W2 off-gate stub → real
- [x] `get_tool_time_heatmap`  — off-gate stub → real
- [x] `get_error_hotspots`  — off-gate stub → real
- [x] `get_error_clusters`  — off-gate stub → real
- [x] `get_file_graph`  — off-gate stub → real
- [x] `count_tokens`  — real `weaviate/tiktoken-go` `cl100k_base`
- [x] `count_tokens_batch`

## FilesService (10) — `commands/files.rs`, `commands/path_util.rs`, `commands/agents_search/`
- [x] `validate_path`  — trust-boundary; port guard verbatim
- [x] `validate_mentions`
- [x] `read_claude_md_files`
- [x] `read_directory_claude_md`
- [x] `read_mentioned_file`
- [x] `read_agent_configs`
- [x] `read_global_agents`
- [x] `read_global_skills`
- [x] `read_global_plugins`
- [x] `read_global_settings`

## SearchService (5) — `commands/sessions.rs` (search surface), `discovery/`, `nl_query.rs`
- [x] `search_sessions`
- [x] `search_all_projects`
- [x] `search_sessions_filtered`
- [x] `search_session_content`
- [x] `parse_nl_query`  — `nl_query.rs`

## ConfigService (40) — `config/commands.rs`
- [x] `config_get`
- [x] `config_update`
- [x] `config_add_ignore_regex`
- [x] `config_remove_ignore_regex`
- [x] `config_add_ignore_repository`
- [x] `config_remove_ignore_repository`
- [x] `config_snooze`
- [x] `config_clear_snooze`
- [x] `config_add_trigger`
- [x] `config_update_trigger`
- [x] `config_remove_trigger`
- [x] `config_get_triggers`
- [x] `config_pin_session`
- [x] `config_unpin_session`
- [x] `config_hide_session`
- [x] `config_unhide_session`
- [x] `config_hide_sessions`
- [x] `config_unhide_sessions`
- [x] `config_get_claude_root_info`
- [x] `config_open_in_editor`  — fixed-path open via OS opener (no path arg)
- [x] `config_add_bookmark`
- [x] `config_remove_bookmark`
- [x] `config_get_bookmarks`
- [x] `config_add_annotation`
- [x] `config_update_annotation`
- [x] `config_remove_annotation`
- [x] `config_get_annotations`
- [x] `config_set_session_tags`
- [x] `config_get_session_tags`
- [x] `config_create_group`
- [x] `config_delete_group`
- [x] `config_add_to_group`
- [x] `config_remove_from_group`
- [x] `config_get_groups`
- [x] `config_add_filter_preset`
- [x] `config_remove_filter_preset`
- [x] `config_rename_filter_preset`
- [x] `config_set_default_filter_preset`
- [x] `config_export_annotations`
- [x] `config_import_annotations`

## NotificationService (8) — `notifications/commands.rs`, `notifications/webhook.rs`
- [x] `notifications_get`
- [x] `notifications_mark_read`
- [x] `notifications_mark_all_read`
- [x] `notifications_delete`
- [x] `notifications_clear`
- [x] `notifications_get_unread_count`
- [x] `notifications_test_trigger`  — invoked from config.ts but binds on notificationservice
- [x] `webhook_test_send`

## SshService (8) — `ssh/commands.rs`
- [x] `ssh_get_config_hosts`
- [x] `ssh_resolve_host`
- [x] `ssh_connect`
- [x] `ssh_disconnect`
- [x] `ssh_get_state`
- [x] `ssh_test`
- [x] `ssh_save_last_connection`
- [x] `ssh_get_last_connection`

## SnapshotService (4) — `snapshots.rs`
- [x] `snapshots_list`
- [x] `snapshots_create_from_session`
- [x] `snapshots_delete`
- [x] `snapshots_open`

## TimingService (4) — `timing.rs` (over the shared `cache.SessionCache`)
- [x] `get_backend_timings`
- [x] `get_cache_stats`
- [x] `set_cache_capacity`
- [x] `clear_session_cache`
