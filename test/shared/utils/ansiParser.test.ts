import { describe, expect, it } from 'vitest';

import {
  collapseProgressBars,
  parseAnsiToSegments,
  renderAnsi,
} from '@shared/utils/ansiParser';

describe('parseAnsiToSegments', () => {
  it('maps SGR red+reset around a token', () => {
    const segments = parseAnsiToSegments('\x1b[31mERROR\x1b[0m ok');
    expect(segments).toEqual([
      { text: 'ERROR', color: '--ansi-red' },
      { text: ' ok' },
    ]);
  });

  it('preserves bold across tokens', () => {
    const segments = parseAnsiToSegments('\x1b[1;33mWARN\x1b[0m');
    expect(segments).toEqual([
      { text: 'WARN', color: '--ansi-yellow', bold: true },
    ]);
  });

  it('drops unknown SGR codes but keeps text', () => {
    const segments = parseAnsiToSegments('\x1b[99mHello');
    expect(segments).toEqual([{ text: 'Hello' }]);
  });

  it('handles input with no escapes', () => {
    expect(parseAnsiToSegments('plain')).toEqual([{ text: 'plain' }]);
  });
});

describe('collapseProgressBars', () => {
  it('collapses repeating \\r updates to the final state', () => {
    const input = 'loading 10%\rloading 20%\rloading 100%\n';
    expect(collapseProgressBars(input)).toBe('loading 100%\n');
  });

  it('preserves lines that have no \\r updates', () => {
    expect(collapseProgressBars('hello\nworld')).toBe('hello\nworld');
  });

  it('treats trailing \\r before newline as final-state replacement', () => {
    expect(collapseProgressBars('first\rsecond')).toBe('second');
  });

  it('returns input unchanged when no carriage return present', () => {
    expect(collapseProgressBars('one\ntwo\nthree')).toBe('one\ntwo\nthree');
  });
});

describe('renderAnsi (collapse + parse pipeline)', () => {
  it('collapses progress then parses ansi', () => {
    const input = 'progress\rprogress final\x1b[32m done\x1b[0m';
    const segments = renderAnsi(input);
    expect(segments).toEqual([
      { text: 'progress final' },
      { text: ' done', color: '--ansi-green' },
    ]);
  });
});
