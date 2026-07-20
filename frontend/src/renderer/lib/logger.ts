import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const MAX_MESSAGE_BYTES = 2048;
const MAX_CTX_VALUE_BYTES = 512;

const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /gh[ps]_[A-Za-z0-9]{30,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const pat of TOKEN_PATTERNS) out = out.replace(pat, '<REDACTED>');
    if (out.length > MAX_CTX_VALUE_BYTES) {
      out = out.slice(0, MAX_CTX_VALUE_BYTES) + '...<truncated>';
    }
    return out;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v);
    return out;
  }
  return value;
}

function redactMessage(msg: string): string {
  let out = msg;
  for (const pat of TOKEN_PATTERNS) out = out.replace(pat, '<REDACTED>');
  if (out.length > MAX_MESSAGE_BYTES) {
    out = out.slice(0, MAX_MESSAGE_BYTES) + '...<truncated>';
  }
  return out;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVEL_ORDER[import.meta.env.DEV ? 'debug' : 'info'];

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < MIN_LEVEL) return;
  try {
    const safeMsg = redactMessage(msg);
    const safeCtx = redact(ctx ?? {}) as Record<string, unknown>;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console -- intentional dev mirror so console still surfaces logger calls
      (console[level] ?? console.log).call(console, `[${level}]`, safeMsg, safeCtx);
    }
    void invoke('log_renderer_event', { level, message: safeMsg, context: safeCtx }).catch(() => {
      /* swallow — never throw from logger */
    });
  } catch {
    /* swallow — never throw from logger */
  }
}

export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>): void => emit('error', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>): void => emit('warn', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>): void => emit('info', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>): void => emit('debug', msg, ctx),
};

export type Logger = typeof logger;
