import { afterEach, describe, expect, it } from 'vitest';

import { applyTheme, revertTheme } from '../../../src/renderer/utils/themeApplier';

const STYLE_ID = 'custom-theme-overrides';

describe('themeApplier', () => {
  afterEach(() => {
    revertTheme();
  });

  it('apply injects a style tag with overrides', () => {
    expect(document.getElementById(STYLE_ID)).toBeNull();

    applyTheme({ background: '#000', foreground: '#fff' });

    const style = document.getElementById(STYLE_ID);
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('--background: #000');
    expect(style?.textContent).toContain('--foreground: #fff');
  });

  it('apply replaces previous overrides on subsequent calls', () => {
    applyTheme({ background: '#000' });
    applyTheme({ background: '#fff' });

    const style = document.getElementById(STYLE_ID);
    expect(style?.textContent).toContain('--background: #fff');
    expect(style?.textContent).not.toContain('#000');
  });

  it('revert removes the style tag (DOM returns to baseline)', () => {
    applyTheme({ background: '#000' });
    expect(document.getElementById(STYLE_ID)).not.toBeNull();

    revertTheme();

    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it('apply with empty overrides leaves no declarations', () => {
    applyTheme({});
    const style = document.getElementById(STYLE_ID);
    expect(style?.textContent ?? '').toBe('');
  });

  it('apply skips empty keys/values', () => {
    applyTheme({ background: '#000', '': 'red', foreground: '' });
    const style = document.getElementById(STYLE_ID);
    expect(style?.textContent).toContain('--background: #000');
    expect(style?.textContent).not.toContain('--foreground');
    expect(style?.textContent).not.toContain('red');
  });
});
