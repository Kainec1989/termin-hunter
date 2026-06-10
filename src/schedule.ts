/**
 * Рабочее окно мониторинга и burst-режим (Europe/Berlin).
 *
 * Leipzig Kfz: новые Termine — Пн/Ср с 15:00, Пт с 11:00.
 */

import { BROWSER_TIMEZONE } from './config';
import { env, isMonitor24_7 } from './env';

const WORK_START = env.WORK_HOURS_START;
const WORK_END = env.WORK_HOURS_END;

const BURST_INTERVAL_MS = env.BURST_INTERVAL_MS;
/** Агрессивный burst (smartcjm-sniper): опрос каждые ~30 сек */
const BURST_AGGRESSIVE_INTERVAL_MS = env.BURST_AGGRESSIVE_INTERVAL_MS;
const BURST_AGGRESSIVE = env.BURST_AGGRESSIVE;
const PRE_RELEASE_INTERVAL_MS = env.PRE_RELEASE_INTERVAL_MS;
const BURST_WINDOW_MINUTES = env.BURST_WINDOW_MINUTES;
const PRE_RELEASE_MINUTES = env.PRE_RELEASE_MINUTES;
const PRE_BOOTSTRAP_MINUTES = env.PRE_BOOTSTRAP_MINUTES;

export type PollMode = 'burst' | 'pre_release' | 'normal';

interface BerlinDateTime {
  hour: number;
  minute: number;
  second: number;
  weekday: number;
  totalMinutes: number;
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

function getBerlinDateTime(): BerlinDateTime {
  const now = new Date();

  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BROWSER_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BROWSER_TIMEZONE,
    weekday: 'short',
  });

  const parts = timeFormatter.formatToParts(now);
  const weekdayStr = weekdayFormatter.format(now);

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const second = Number(parts.find((p) => p.type === 'second')?.value ?? 0);

  return {
    hour,
    minute,
    second,
    weekday: weekdayMap[weekdayStr] ?? 0,
    totalMinutes: hour * 60 + minute,
  };
}

/** Минуты с начала суток, когда начинается выброс слотов */
function getReleaseStartMinutes(weekday: number): number | null {
  if (weekday === 1 || weekday === 3) return 15 * 60; // Пн, Ср 15:00
  if (weekday === 5) return 11 * 60; // Пт 11:00
  return null;
}

function isReleaseDay(weekday: number): boolean {
  return weekday === 1 || weekday === 3 || weekday === 5;
}

export function isReleaseBurstWindow(): boolean {
  const { weekday, totalMinutes } = getBerlinDateTime();
  const releaseStart = getReleaseStartMinutes(weekday);

  if (releaseStart === null) return false;

  const burstStart = releaseStart - PRE_BOOTSTRAP_MINUTES;
  const burstEnd = releaseStart + BURST_WINDOW_MINUTES;

  return totalMinutes >= burstStart && totalMinutes < burstEnd;
}

export function isPreReleaseWindow(): boolean {
  const { weekday, totalMinutes } = getBerlinDateTime();
  const releaseStart = getReleaseStartMinutes(weekday);

  if (releaseStart === null) return false;

  const preStart = releaseStart - PRE_RELEASE_MINUTES - PRE_BOOTSTRAP_MINUTES;
  const preEnd = releaseStart - PRE_BOOTSTRAP_MINUTES;

  return totalMinutes >= preStart && totalMinutes < preEnd;
}

/** Окно за 2 мин до выброса — принудительный re-bootstrap */
export function isPreBootstrapWindow(): boolean {
  const { weekday, totalMinutes } = getBerlinDateTime();
  const releaseStart = getReleaseStartMinutes(weekday);

  if (releaseStart === null) return false;

  const preStart = releaseStart - PRE_BOOTSTRAP_MINUTES;

  return totalMinutes >= preStart && totalMinutes < releaseStart;
}

export function getPollMode(): PollMode {
  if (isReleaseBurstWindow()) return 'burst';
  if (isPreReleaseWindow()) return 'pre_release';
  return 'normal';
}

export function getPollModeLabel(): string {
  const mode = getPollMode();
  if (mode === 'burst') {
    return BURST_AGGRESSIVE ? 'burst агрессивный (~30 сек)' : 'burst (выброс слотов)';
  }
  if (mode === 'pre_release') return 'pre-release (скоро выброс)';
  return 'обычный';
}

export function getPollIntervalMs(): number {
  const mode = getPollMode();

  if (mode === 'burst') return BURST_AGGRESSIVE ? BURST_AGGRESSIVE_INTERVAL_MS : BURST_INTERVAL_MS;
  if (mode === 'pre_release') return PRE_RELEASE_INTERVAL_MS;

  return env.CHECK_INTERVAL_MS;
}

export function getMinPollDelayMs(): number {
  return getPollMode() === 'burst' ? 10_000 : 30_000;
}

export function getJitterMs(): number {
  const mode = getPollMode();
  if (mode === 'burst') return env.BURST_JITTER_MS;
  return env.JITTER_MS;
}

export function isReleaseDayToday(): boolean {
  return isReleaseDay(getBerlinDateTime().weekday);
}

export function getWorkHoursLabel(): string {
  if (isMonitor24_7()) {
    return `круглосуточно (${BROWSER_TIMEZONE})`;
  }

  return `${WORK_START}–${WORK_END} (${BROWSER_TIMEZONE})`;
}

export function isWithinWorkingHours(): boolean {
  if (isMonitor24_7()) return true;

  const { totalMinutes } = getBerlinDateTime();
  const start = parseTimeToMinutes(WORK_START);
  const end = parseTimeToMinutes(WORK_END);

  return totalMinutes >= start && totalMinutes < end;
}

/** Миллисекунды до конца рабочего окна (0 = без ограничения при 24/7) */
export function msUntilWorkEnd(): number {
  if (isMonitor24_7()) return 0;

  const { totalMinutes, second } = getBerlinDateTime();
  const end = parseTimeToMinutes(WORK_END);
  const minutesLeft = end - totalMinutes;

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
