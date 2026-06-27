// Session API

export interface SessionAPI {
  scrollToLine: (sessionId: string, lineNumber: number) => Promise<void>;
}

// CLAUDE.md File Info

export interface ClaudeMdFileInfo {
  path: string;
  exists: boolean;
  charCount: number;
  estimatedTokens: number;
}
