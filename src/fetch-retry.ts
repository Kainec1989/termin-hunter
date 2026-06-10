/**
 * Retry с backoff для сетевых fetch-запросов.
 */

import { log } from './logger';
import { applyRateLimitBackoff, RateLimitError } from './rate-limit';

const NON_RETRYABLE = new Set([
  'SessionExpiredError',
  'AmbiguousResponseError',
  'BookingError',
  'HttpBootstrapError',
  'RateLimitError',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error && NON_RETRYABLE.has(error.name)) {
    return false;
  }

  return true;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface FetchRetryOptions {
  retries?: number;
  baseDelayMs?: number;
}

export async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(input, init);

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const retrySec = retryAfter ? parseInt(retryAfter, 10) : undefined;
        applyRateLimitBackoff(Number.isNaN(retrySec) ? undefined : retrySec);
        throw new RateLimitError();
      }

      if (isRetryableStatus(response.status) && attempt < retries - 1) {
        const delay = baseDelayMs * (attempt + 1);
        log(`HTTP ${response.status} — повтор через ${delay} мс (попытка ${attempt + 2}/${retries})`);
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      if (!isRetryableError(error) || attempt >= retries - 1) {
        throw error;
      }

      lastError = error;
      const delay = baseDelayMs * (attempt + 1);
      log(`Сетевая ошибка — повтор через ${delay} мс (попытка ${attempt + 2}/${retries})`);
      await sleep(delay);
    }
  }

  throw lastError ?? new Error('fetchWithRetry: неизвестная ошибка');
}
