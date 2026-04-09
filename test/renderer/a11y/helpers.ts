import { expect } from 'vitest';

// Opaque module name to prevent Vite static analysis from resolving it
const AXE_MODULE = ['vitest', 'axe'].join('-');
const AXE_MATCHERS = `${AXE_MODULE}/matchers`;

let resolved = false;
let axeFn: ((container: HTMLElement, options?: object) => Promise<unknown>) | null = null;

async function ensureAxe(): Promise<boolean> {
  if (resolved) return axeFn !== null;
  resolved = true;
  try {
    const mod = await import(/* @vite-ignore */ AXE_MODULE);
    axeFn = mod.axe;
    const matchers = await import(/* @vite-ignore */ AXE_MATCHERS);
    expect.extend(matchers);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run axe accessibility checks on a container and assert no violations.
 * Disables color-contrast by default since CSS isn't loaded in test env.
 * Skips (passes) if vitest-axe is not installed.
 */
export async function expectNoA11yViolations(
  container: HTMLElement,
  options?: { rules?: Record<string, { enabled: boolean }> }
): Promise<void> {
  const available = await ensureAxe();
  if (!available || !axeFn) {
    return;
  }

  const results = await axeFn(container, {
    rules: {
      'color-contrast': { enabled: false },
      ...options?.rules,
    },
  });
  // @ts-expect-error - matcher extended dynamically
  expect(results).toHaveNoViolations();
}
