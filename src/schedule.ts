/**
 * Рабочее окно мониторинга (Europe/Berlin).
 */

import { BROWSER_TIMEZONE } from './config';

const WORK_START = process.env.WORK_HOURS_START ?? '07:00';
const WORK_END = process.env.WORK_HOURS_END ?? '19:00';

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

interface BerlinTime {
  hour: number;
  minute: number;
  second: number;
}

function getBerlinTime(): BerlinTime {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BROWSER_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());

  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
    second: Number(parts.find((p) => p.type === 'second')?.value ?? 0),
  };
}

export function getWorkHoursLabel(): string {
  return `${WORK_START}–${WORK_END} (${BROWSER_TIMEZONE})`;
}

export function isWithinWorkingHours(): boolean {
  const { hour, minute } = getBerlinTime();
  const now = hour * 60 + minute;
  const start = parseTimeToMinutes(WORK_START);
  const end = parseTimeToMinutes(WORK_END);

  return now >= start && now < end;
}

/** Миллисекунды до конца рабочего окна */
export function msUntilWorkEnd(): number {
  const { hour, minute, second } = getBerlinTime();
  const now = hour * 60 + minute;
  const end = parseTimeToMinutes(WORK_END);
  const minutesLeft = end - now;

  if (minutesLeft <= 0) return 0;

  return (minutesLeft * 60 - second) * 1000;
}

export function getBerlinTimeString(): string {
  return new Date().toLocaleString('de-DE', {
    timeZone: BROWSER_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
