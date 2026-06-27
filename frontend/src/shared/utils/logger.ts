

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

class Logger {
  private static level: LogLevel =
    process.env.NODE_ENV === 'production' ? LogLevel.ERROR : LogLevel.WARN;

  constructor(private namespace: string) {}

  debug(...args: unknown[]): void {
    if (Logger.level <= LogLevel.DEBUG) {
      console.debug(`[${this.namespace}]`, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (Logger.level <= LogLevel.INFO) {
      console.log(`[${this.namespace}]`, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (Logger.level <= LogLevel.WARN) {
      console.warn(`[${this.namespace}]`, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (Logger.level <= LogLevel.ERROR) {
      console.error(`[${this.namespace}]`, ...args);
    }
  }
}

export function createLogger(namespace: string): Logger {
  return new Logger(namespace);
}

export type { Logger };
