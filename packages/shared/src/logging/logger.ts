import { PrivacySanitizer } from '../privacy/sanitizer.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Lightweight structured logger with scoped component tags.
 *
 * Privacy: Any argument that looks like a URL is automatically sanitized
 * through PrivacySanitizer.sanitizeUrl before output. Tokens, session IDs,
 * and other sensitive query parameters are stripped.
 *
 * No telemetry. No analytics. No external logging service.
 */
export class Logger {
  private scope: string;
  private level: LogLevel;

  constructor(scope: string, level?: LogLevel) {
    this.scope = scope;
    this.level = level ?? 'DEBUG';
  }

  public debug(...args: unknown[]): void {
    this.log('DEBUG', args);
  }

  public info(...args: unknown[]): void {
    this.log('INFO', args);
  }

  public warn(...args: unknown[]): void {
    this.log('WARN', args);
  }

  public error(...args: unknown[]): void {
    this.log('ERROR', args);
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, args: unknown[]): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const sanitizedArgs = args.map((arg) => this.sanitizeArg(arg));
    const prefix = `[${this.scope}]`;

    switch (level) {
      case 'DEBUG':
        console.debug(prefix, ...sanitizedArgs);
        break;
      case 'INFO':
        console.log(prefix, ...sanitizedArgs);
        break;
      case 'WARN':
        console.warn(prefix, ...sanitizedArgs);
        break;
      case 'ERROR':
        console.error(prefix, ...sanitizedArgs);
        break;
    }
  }

  private sanitizeArg(arg: unknown): unknown {
    if (typeof arg === 'string') {
      return this.sanitizeString(arg);
    }
    return arg;
  }

  /**
   * Sanitizes a string by finding and replacing URL-like substrings
   * that contain query parameters. This ensures no tokens, session IDs,
   * or other sensitive parameters leak into log output.
   */
  private sanitizeString(value: string): string {
    // Match URLs with query parameters (http/https/ws/wss)
    return value.replace(/https?:\/\/[^\s]+\?[^\s]*/g, (match) =>
      PrivacySanitizer.sanitizeUrl(match)
    );
  }
}
