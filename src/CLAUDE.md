# src/ Structure

Tauri app with Rust backend:

## Directories

- `renderer/` - React frontend (UI, state, visualization)
- `shared/` - Shared types and utilities

Backend logic lives in `src-tauri/src/` (Rust).

## API Communication

Frontend calls Rust backend via Tauri `invoke()`. API defined in `src/shared/types/api.ts` (`ElectronAPI` interface), implemented by `src/renderer/api/tauriClient.ts`.

| Domain        | Methods | Examples                                                                                                                                                                                    |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions      | 10      | `getProjects()`, `getSessions()`, `getSessionsPaginated()`, `getSessionDetail()`, `getSessionMetrics()`, `getWaterfallData()`, `getSubagentDetail()`, `searchSessions()`, `getAppVersion()` |
| Repository    | 2       | `getRepositoryGroups()`, `getWorktreeSessions()`                                                                                                                                            |
| Validation    | 2       | `validatePath()`, `validateMentions()`                                                                                                                                                      |
| CLAUDE.md     | 3       | `readClaudeMdFiles()`, `readDirectoryClaudeMd()`, `readMentionedFile()`                                                                                                                     |
| Config        | 16      | `config.get()`, `config.update()`, `config.addTrigger()`, `config.openInEditor()`, `config.pinSession()`, `config.unpinSession()`, etc.                                                     |
| Notifications | 9       | `notifications.get()`, `notifications.markRead()`, `notifications.onNew()`, etc.                                                                                                            |
| Utilities     | 7       | `openPath()`, `openExternal()`, `onFileChange()`, `onTodoChange()`, `getZoomFactor()`, `onZoomFactorChanged()`                                                                              |
| Session       | 1       | `session.scrollToLine()`                                                                                                                                                                    |
