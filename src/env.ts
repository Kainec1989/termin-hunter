/**
 * Централизованная конфигурация из process.env.
 */

import 'dotenv/config';

function parseIntEnv(key: string, defaultValue: string): number {
  const raw = process.env[key] ?? defaultValue;
  const value = parseInt(raw, 10);

  if (Number.isNaN(value)) {
    console.warn(`[env] ${key}="${raw}" не число — используется ${defaultValue}`);
    return parseInt(defaultValue, 10);
  }

  return value;
}

function parseBoolEnv(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];

  if (raw === undefined) return defaultValue;
  if (defaultValue) return raw.toLowerCase() !== 'false';
  return raw.toLowerCase() === 'true';
}

export const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ?? '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID ?? '',

  CHECK_INTERVAL_MS: parseIntEnv('CHECK_INTERVAL_MS', '240000'),
  JITTER_MS: parseIntEnv('JITTER_MS', '20000'),

  WORK_HOURS_START: process.env.WORK_HOURS_START ?? '07:00',
  WORK_HOURS_END: process.env.WORK_HOURS_END ?? '19:00',

  HEADLESS: parseBoolEnv('HEADLESS', true),
  BROWSER_CHANNEL: process.env.BROWSER_CHANNEL?.trim() || undefined,

  BOOTSTRAP_MODE: (process.env.BOOTSTRAP_MODE ?? 'http').toLowerCase(),
  WSID_REFRESH_ONLY: parseBoolEnv('WSID_REFRESH_ONLY', true),

  SESSION_TTL_MS: parseIntEnv('SESSION_TTL_MS', '900000'),
  SESSION_REFRESH_MS: parseIntEnv('SESSION_REFRESH_MS', '720000'),

  BURST_INTERVAL_MS: parseIntEnv('BURST_INTERVAL_MS', '30000'),
  BURST_AGGRESSIVE_INTERVAL_MS: parseIntEnv('BURST_AGGRESSIVE_INTERVAL_MS', '30000'),
  BURST_AGGRESSIVE: parseBoolEnv('BURST_AGGRESSIVE', true),
  BURST_JITTER_MS: parseIntEnv('BURST_JITTER_MS', '5000'),
  BURST_WINDOW_MINUTES: parseIntEnv('BURST_WINDOW_MINUTES', '45'),
  PRE_RELEASE_MINUTES: parseIntEnv('PRE_RELEASE_MINUTES', '5'),
  PRE_RELEASE_INTERVAL_MS: parseIntEnv('PRE_RELEASE_INTERVAL_MS', '60000'),
  PRE_BOOTSTRAP_MINUTES: parseIntEnv('PRE_BOOTSTRAP_MINUTES', '2'),
  BURST_KEEP_BROWSER_OPEN: parseBoolEnv('BURST_KEEP_BROWSER_OPEN', false),

  AUTO_BOOK: parseBoolEnv('AUTO_BOOK', false),
  AUTO_BOOK_DRY_RUN: parseBoolEnv('AUTO_BOOK_DRY_RUN', false),
  BOOKING_EMAIL: process.env.BOOKING_EMAIL?.trim() ?? '',

  NTFY_TOPIC: process.env.NTFY_TOPIC?.trim(),
  NTFY_SERVER: (process.env.NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/$/, ''),
  PUSHOVER_USER_KEY: process.env.PUSHOVER_USER_KEY?.trim(),
  PUSHOVER_API_TOKEN: process.env.PUSHOVER_API_TOKEN?.trim(),
  TTS_ON_SLOT: parseBoolEnv('TTS_ON_SLOT', false),
  TTS_COMMAND: process.env.TTS_COMMAND ?? 'spd-say',

  RATE_LIMIT_BACKOFF_MS: parseIntEnv('RATE_LIMIT_BACKOFF_MS', '300000'),
} as const;

if (env.AUTO_BOOK && !env.BOOKING_EMAIL) {
  console.warn('[env] AUTO_BOOK=true, но BOOKING_EMAIL не задан — auto-book отключён');
}
