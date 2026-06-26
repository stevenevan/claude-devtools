// Session API

/**
 * Session navigation API exposed via preload.
 */
export interface SessionAPI {
  scrollToLine: (sessionId: string, lineNumber: number) => Promise<void>;
}

// CLAUDE.md File Info

/**
 * CLAUDE.md file information returned from reading operations.
 */
export interface ClaudeMdFileInfo {
  path: string;
  exists: boolean;
  charCount: number;
  estimatedTokens: number;
}
