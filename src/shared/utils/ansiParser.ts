/**
 * Bash output ANSI escape parser (sprint 42).
 *
 * Two responsibilities:
 *   1. parseAnsiToSegments — convert SGR codes (basic 8 + bold/reset)
 *      into typed spans. Unknown codes are dropped, raw text preserved.
 *   2. collapseProgressBars — fold repeated `\r`-terminated updates on
 *      the same line into the final state, so a 100-step progress bar
 *      shows once instead of 100 times.
 *
 * Token accounting in `contextTracker` continues to use the pre-collapse
 * raw text — the collapse is a render-only concern.
 */

export interface AnsiSegment {
  text: string;
  /** CSS variable name (e.g. `--ansi-red`) — undefined means default. */
  color?: string;
  bold?: boolean;
}

const ESC_CHAR = String.fromCharCode(0x1b);
// eslint-disable-next-line security/detect-non-literal-regexp -- constant pattern built from a literal ESC char to satisfy no-control-regex; bounded {0,16} repetition prevents catastrophic backtracking
const ANSI_PATTERN = new RegExp(`${ESC_CHAR}\\[((?:\\d{1,3};?){0,16})m`, 'g');

const COLOR_VAR: Record<number, string> = {
  30: '--ansi-black',
  31: '--ansi-red',
  32: '--ansi-green',
  33: '--ansi-yellow',
  34: '--ansi-blue',
  35: '--ansi-magenta',
  36: '--ansi-cyan',
  37: '--ansi-white',
  90: '--ansi-bright-black',
  91: '--ansi-bright-red',
  92: '--ansi-bright-green',
  93: '--ansi-bright-yellow',
  94: '--ansi-bright-blue',
  95: '--ansi-bright-magenta',
  96: '--ansi-bright-cyan',
  97: '--ansi-bright-white',
};

interface AnsiState {
  color?: string;
  bold?: boolean;
}

function applyCodes(state: AnsiState, codes: number[]): AnsiState {
  const next = { ...state };
  if (codes.length === 0 || (codes.length === 1 && codes[0] === 0)) {
    return {};
  }
  for (const code of codes) {
    if (code === 0) {
      next.color = undefined;
      next.bold = undefined;
    } else if (code === 1) {
      next.bold = true;
    } else if (code === 22) {
      next.bold = undefined;
    } else if (code === 39) {
      next.color = undefined;
    } else if (COLOR_VAR[code] !== undefined) {
      next.color = COLOR_VAR[code];
    }
  }
  return next;
}

export function parseAnsiToSegments(input: string): AnsiSegment[] {
  const out: AnsiSegment[] = [];
  let state: AnsiState = {};
  let cursor = 0;
  ANSI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_PATTERN.exec(input)) !== null) {
    if (match.index > cursor) {
      const text = input.slice(cursor, match.index);
      if (text.length > 0) out.push({ text, ...state });
    }
    const codes = match[1]
      .split(';')
      .filter((s) => s.length > 0)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n));
    state = applyCodes(state, codes);
    cursor = match.index + match[0].length;
  }
  if (cursor < input.length) {
    out.push({ text: input.slice(cursor), ...state });
  }
  return mergeAdjacent(out);
}

function mergeAdjacent(segments: AnsiSegment[]): AnsiSegment[] {
  const merged: AnsiSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.color === seg.color && last.bold === seg.bold) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/**
 * Collapse `\r` overwrites within a single line. `loading 10%\rloading 20%\r…\rloading 100%\n`
 * becomes `loading 100%\n`. Lines without trailing `\r` updates are preserved verbatim.
 */
export function collapseProgressBars(input: string): string {
  if (!input.includes('\r')) return input;
  const lines = input.split('\n');
  const collapsed = lines.map((line) => {
    if (!line.includes('\r')) return line;
    const segments = line.split('\r').filter((s) => s.length > 0);
    return segments.length === 0 ? '' : segments[segments.length - 1];
  });
  return collapsed.join('\n');
}

export function renderAnsi(input: string): AnsiSegment[] {
  return parseAnsiToSegments(collapseProgressBars(input));
}
