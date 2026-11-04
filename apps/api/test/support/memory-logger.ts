import type { LoggerService } from '@nestjs/common';

/**
 * Captures every Nest log line in memory. Security tests assert that raw
 * credentials, cookies and SQL never reach this sink. It deliberately formats
 * thrown objects without a stack so the test sees only what the application
 * chose to log.
 */
export class MemoryLogger implements LoggerService {
  private readonly entries: string[] = [];

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.record('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.record('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.record('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.record('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.record('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.record('fatal', message, optionalParams);
  }

  get text(): string {
    return this.entries.join('\n');
  }

  clear(): void {
    this.entries.length = 0;
  }

  private record(
    level: string,
    message: unknown,
    optionalParams: readonly unknown[],
  ): void {
    this.entries.push(
      `${level} ${formatValue(message)} ${optionalParams.map(formatValue).join(' ')}`,
    );
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
