import { invoke } from '@tauri-apps/api/core';
import pinoBrowser from 'pino/browser';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface PinoBrowserLogger {
  error(ctx: Record<string, unknown>, msg: string): void;
  warn(ctx: Record<string, unknown>, msg: string): void;
  info(ctx: Record<string, unknown>, msg: string): void;
  debug(ctx: Record<string, unknown>, msg: string): void;
}

interface PinoBrowserOptions {
  level?: string;
  browser?: {
    asObject?: boolean;
    write?: (o: unknown) => void;
  };
}

const pinoFn = pinoBrowser as (opts: PinoBrowserOptions) => PinoBrowserLogger;

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

const browserLogger: PinoBrowserLogger = pinoFn({
  level: import.meta.env.DEV ? 'debug' : 'info',
  browser: {
    asObject: true,
    write: (o: unknown) => {
      try {
        const obj = o as { level?: number | string; msg?: string; [k: string]: unknown };
        const level = mapPinoLevel(obj.level);
        const msg = redactMessage(String(obj.msg ?? ''));
        const ctx: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k === 'level' || k === 'msg' || k === 'time') continue;
          ctx[k] = redact(v);
        }
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- intentional dev mirror so console still surfaces logger calls
          (console[level] ?? console.log).call(console, `[${level}]`, msg, ctx);
        }
        void invoke('log_renderer_event', { level, msg, ctx }).catch(() => {
          /* swallow — never throw from logger */
        });
      } catch {
        /* swallow — never throw from logger */
      }
    },
  },
});

function mapPinoLevel(raw: number | string | undefined): LogLevel {
  if (typeof raw === 'number') {
    if (raw >= 50) return 'error';
    if (raw >= 40) return 'warn';
    if (raw >= 30) return 'info';
    return 'debug';
  }
  if (raw === 'error' || raw === 'fatal') return 'error';
  if (raw === 'warn') return 'warn';
  if (raw === 'debug' || raw === 'trace') return 'debug';
  return 'info';
}

export const logger = {
  error(msg: string, ctx?: Record<string, unknown>): void {
    browserLogger.error(ctx ?? {}, msg);
  },
  warn(msg: string, ctx?: Record<string, unknown>): void {
    browserLogger.warn(ctx ?? {}, msg);
  },
  info(msg: string, ctx?: Record<string, unknown>): void {
    browserLogger.info(ctx ?? {}, msg);
  },
  debug(msg: string, ctx?: Record<string, unknown>): void {
    browserLogger.debug(ctx ?? {}, msg);
  },
};

export type Logger = typeof logger;
