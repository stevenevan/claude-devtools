# Shared

Cross-process code used by main and renderer.

## What Goes Here

- Types shared between processes
- Pure utility functions (no Node/DOM APIs)
- Constants used across processes

## What Doesn't Go Here

- Node.js APIs → main/
- DOM/React APIs → renderer/
- Process-specific logic

## Structure

- `types/` - Shared type definitions
  - `api/` - Tauri-API contract types, split by domain (barrel at `api/index.ts`; `ElectronAPI` master interface lives here). Type domains that exceed 400 lines may be split into a directory with a barrel `index.ts` (this is the first such case). Deep imports through the directory barrel (e.g., `@shared/types/api/snapshots`) are prohibited — always import via the barrel `@shared/types/api`.
  - `chunks.ts`, `domain.ts`, `messages.ts`, `notifications.ts`, `jsonl.ts`, `visualization.ts`
- `utils/` - Pure utility functions
  - `tokenFormatting.ts` - Token formatting and estimation (`estimateTokens`, `formatTokensCompact`)
  - `modelParser.ts` - Model name/family parsing
  - `teammateMessageParser.ts` - `<teammate-message>` XML parsing
  - `markdownTextSearch.ts` - Markdown-aware text search
  - `contentSanitizer.ts` - Content sanitization
  - `logger.ts` - Logging utility
- `constants/` - Shared constants
  - `trafficLights.ts` - macOS traffic light constants
  - `triggerColors.ts` - Trigger color palette

## Import

```typescript
import { SomeType } from '@shared/types';
import { estimateTokens } from '@shared/utils/tokenFormatting';
```
