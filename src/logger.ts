/**
 * Утилиты логирования с меткой времени.
 */

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
  console.log(`[${timestamp()}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  console.error(`[${timestamp()}] ОШИБКА: ${message}${detail ? ` — ${detail}` : ''}`);
}
