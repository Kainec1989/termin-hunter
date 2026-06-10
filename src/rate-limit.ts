/**
 * Backoff при HTTP 429 (impf-botpy pattern).
 */

import { env } from './env';
import { log } from './logger';

let backoffUntil = 0;

export class RateLimitError extends Error {
  constructor() {
    super('HTTP 429: rate limit');
    this.name = 'RateLimitError';
  }
}

export function applyRateLimitBackoff(retryAfterSec?: number): void {
  const ms = retryAfterSec && retryAfterSec > 0
    ? retryAfterSec * 1000
    : env.RATE_LIMIT_BACKOFF_MS;

  backoffUntil = Date.now() + ms;
  log(`Rate limit (429): пауза опроса на ${Math.round(ms / 1000)} сек`);
}

export function getRateLimitDelayMs(): number {
  const remaining = backoffUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

export function clearRateLimitBackoff(): void {
  backoffUntil = 0;
}
