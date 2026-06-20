# Command Inventory — 118/118 (W5 done-contract)

Every `tauri::command` in `src-tauri/src/lib.rs` `invoke_handler` (118 entries) mapped to
its owning Go service + W5 ticket. Check a box when the Go method exists AND `wails3 generate
bindings -ts` emits its TS function under `frontend/bindings/claude-devtools/internal/<svc>service/`.
**Done = all 118 checked.** Re-audited in W8-T2.

Source of truth: `lib.rs:58-175`. Each command owned by exactly one service:
System 8 · Session 19 · Analytics 12 · Files 10 · Search 5 · Config 40 · Notify 8 ·
Ssh 8 · Snapshot 4 · Timing 4 = **118**.

## SystemService (8) — `commands/system.rs`, `commands/window.rs`, watcher, `plugins`
- [ ] `get_app_version`
- [ ] `start_watching`
- [ ] `stop_watching`
- [ ] `log_renderer_event`
- [ ] `get_all_todos`
- [ ] `window_bus_broadcast`  — single-app `Event.Emit` broadcast (not multi-window)
- [ ] `window_bus_ready`
- [ ] `plugins_discover`  — `commands/.../plugins`

## SessionService (19) — `commands/sessions.rs`, `commands/projects.rs`, `parsing/`, `analysis/`
- [ ] `parse_session`
- [ ] `parse_session_metrics`
- [ ] `get_projects`
- [ ] `get_sessions_paginated`
- [ ] `get_session_detail`
- [ ] `get_session_detail_incremental`  — W5-T8a (cache state machine `sessions.rs:216-293`)
- [ ] `get_sessions`
- [ ] `get_sessions_by_ids`
- [ ] `get_waterfall_data`  — one-line alias for `get_session_detail` (stub)
- [ ] `get_subagent_detail`
- [ ] `get_session_groups`  — hardcoded stub (`agents_search`)
- [ ] `get_repository_groups`  — hardcoded stub
- [ ] `get_worktree_sessions`  — hardcoded stub
- [ ] `context_list`  — stub (`agents_search/context.rs`)
- [ ] `context_get_active`  — stub
- [ ] `context_switch`  — stub
- [ ] `session_scroll_to_line`
- [ ] `get_session_tldr`  — W5-T8a (`analysis/summarizer.rs`)
- [ ] `link_tool_calls`  — W5-T2 (`analysis/tool_linking.rs`, arch H2 deferral)

## AnalyticsService (12) — `commands/analytics.rs`, `analysis/commands/*`, `analysis/tokenizer.rs`
- [ ] `get_analytics`
- [ ] `get_cost_forecast`
- [ ] `get_productivity_metrics`
- [ ] `get_session_duration_stats`
- [ ] `get_model_comparison`  — `analytics/model_comparison.rs`
- [ ] `get_tool_analytics`  — W2 off-gate stub → real
- [ ] `get_tool_time_heatmap`  — off-gate stub → real
- [ ] `get_error_hotspots`  — off-gate stub → real
- [ ] `get_error_clusters`  — off-gate stub → real
- [ ] `get_file_graph`  — off-gate stub → real
- [ ] `count_tokens`  — real `weaviate/tiktoken-go` `cl100k_base`
- [ ] `count_tokens_batch`

## FilesService (10) — `commands/files.rs`, `commands/path_util.rs`, `commands/agents_search/`
- [ ] `validate_path`  — trust-boundary; port guard verbatim
- [ ] `validate_mentions`
- [ ] `read_claude_md_files`
- [ ] `read_directory_claude_md`
- [ ] `read_mentioned_file`
- [ ] `read_agent_configs`
- [ ] `read_global_agents`
- [ ] `read_global_skills`
- [ ] `read_global_plugins`
- [ ] `read_global_settings`

## SearchService (5) — `commands/sessions.rs` (search surface), `discovery/`, `nl_query.rs`
- [ ] `search_sessions`
- [ ] `search_all_projects`
- [ ] `search_sessions_filtered`
- [ ] `search_session_content`
- [ ] `parse_nl_query`  — `nl_query.rs`

## ConfigService (40) — `config/commands.rs`
- [ ] `config_get`
- [ ] `config_update`
- [ ] `config_add_ignore_regex`
- [ ] `config_remove_ignore_regex`
- [ ] `config_add_ignore_repository`
- [ ] `config_remove_ignore_repository`
- [ ] `config_snooze`
- [ ] `config_clear_snooze`
- [ ] `config_add_trigger`
- [ ] `config_update_trigger`
- [ ] `config_remove_trigger`
- [ ] `config_get_triggers`
- [ ] `config_pin_session`
- [ ] `config_unpin_session`
- [ ] `config_hide_session`
- [ ] `config_unhide_session`
- [ ] `config_hide_sessions`
- [ ] `config_unhide_sessions`
- [ ] `config_get_claude_root_info`
- [ ] `config_open_in_editor`  — fixed-path open via OS opener (no path arg)
- [ ] `config_add_bookmark`
- [ ] `config_remove_bookmark`
- [ ] `config_get_bookmarks`
- [ ] `config_add_annotation`
- [ ] `config_update_annotation`
- [ ] `config_remove_annotation`
- [ ] `config_get_annotations`
- [ ] `config_set_session_tags`
- [ ] `config_get_session_tags`
- [ ] `config_create_group`
- [ ] `config_delete_group`
- [ ] `config_add_to_group`
- [ ] `config_remove_from_group`
- [ ] `config_get_groups`
- [ ] `config_add_filter_preset`
- [ ] `config_remove_filter_preset`
- [ ] `config_rename_filter_preset`
- [ ] `config_set_default_filter_preset`
- [ ] `config_export_annotations`
- [ ] `config_import_annotations`

## NotificationService (8) — `notifications/commands.rs`, `notifications/webhook.rs`
- [ ] `notifications_get`
- [ ] `notifications_mark_read`
- [ ] `notifications_mark_all_read`
- [ ] `notifications_delete`
- [ ] `notifications_clear`
- [ ] `notifications_get_unread_count`
- [ ] `notifications_test_trigger`  — invoked from config.ts but binds on notificationservice
- [ ] `webhook_test_send`

## SshService (8) — `ssh/commands.rs`
- [ ] `ssh_get_config_hosts`
- [ ] `ssh_resolve_host`
- [ ] `ssh_connect`
- [ ] `ssh_disconnect`
- [ ] `ssh_get_state`
- [ ] `ssh_test`
- [ ] `ssh_save_last_connection`
- [ ] `ssh_get_last_connection`

## SnapshotService (4) — `snapshots.rs`
- [ ] `snapshots_list`
- [ ] `snapshots_create_from_session`
- [ ] `snapshots_delete`
- [ ] `snapshots_open`

## TimingService (4) — `timing.rs` (over the shared `cache.SessionCache`)
- [ ] `get_backend_timings`
- [ ] `get_cache_stats`
- [ ] `set_cache_capacity`
- [ ] `clear_session_cache`
