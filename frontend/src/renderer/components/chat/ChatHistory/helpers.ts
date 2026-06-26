export const CONTEXT_PANEL_WIDTH_PX = 320;

export function waitForDoubleRaf(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}
