/**
 * Утилиты логирования с меткой времени.
 * Дублирует вывод в termin-hunter.log для cron (обход буферизации stdout).
 */

import { appendFileSync } from 'fs';
import { join } from 'path';

const LOG_FILE = join(process.cwd(), 'termin-hunter.log');

function writeLine(level: string, message: string): void {
  const line = `[${timestamp()}] ${level}: ${message}\n`;

  if (level === 'ОШИБКА') {
    console.error(line.trimEnd());
  } else {
    console.log(line.trimEnd());
  }

  try {
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // файл недоступен — только stdout
  }
}

export function timestamp(): string {
  return new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function log(message: string): void {
  writeLine('INFO', message);
}

export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  writeLine('ОШИБКА', `${message}${detail ? ` — ${detail}` : ''}`);
}
