/**
 * Авто-бронирование слота через Smart CX /booking (паттерн smartcjm-appointment-sniper).
 */

import { API_BASE_URL, USER_AGENT } from './config';
import { log, logError } from './logger';
import type { ApiSlot } from './api';
import { buildCookieHeader, getApiUid, type SmartCxSession } from './session';

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingError';
  }
}

const AUTO_BOOK = (process.env.AUTO_BOOK ?? 'false').toLowerCase() === 'true';
const BOOKING_EMAIL = process.env.BOOKING_EMAIL?.trim() ?? '';
const AUTO_BOOK_DRY_RUN = (process.env.AUTO_BOOK_DRY_RUN ?? 'false').toLowerCase() === 'true';

export function isAutoBookEnabled(): boolean {
  return AUTO_BOOK && BOOKING_EMAIL.length > 0;
}

function extractCsrf(html: string): { name: string; value: string } | null {
  const match = html.match(
    /<input[^>]*id=["']RequestVerificationToken["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']+)["'][^>]*>/i,
  );
  if (match) return { name: match[1], value: match[2] };

  const alt = html.match(
    /<input[^>]*name=["']([^"']+)["'][^>]*id=["']RequestVerificationToken["'][^>]*value=["']([^"']+)["'][^>]*>/i,
  );
  if (alt) return { name: alt[1], value: alt[2] };

  return null;
}

function parseIsoFromSlot(slot: ApiSlot): string | null {
  if (slot.datetime_iso86001) return slot.datetime_iso86001;

  const linkMatch = slot.link.match(/appointment_datetime=([^&]+)/);
  if (linkMatch) return decodeURIComponent(linkMatch[1]);

  return null;
}

function parseUnitUidFromSlot(slot: ApiSlot): string | null {
  if (slot.unit_uid) return slot.unit_uid;

  const linkMatch = slot.link.match(/location=([^&]+)/);
  if (linkMatch) return decodeURIComponent(linkMatch[1]);

  return null;
}

/**
 * Пытается забронировать слот. Возвращает true при успехе (или dry-run).
 */
export async function tryAutoBook(slot: ApiSlot, session: SmartCxSession): Promise<boolean> {
  if (!isAutoBookEnabled()) return false;

  const appointmentDatetime = parseIsoFromSlot(slot);
  const location = parseUnitUidFromSlot(slot);

  if (!appointmentDatetime || !location) {
    logError('Auto-book: не удалось извлечь datetime/location из слота', slot.link);
    return false;
  }

  const apiUid = getApiUid(session);
  const bookingParams = new URLSearchParams({
    uid: apiUid,
    wsid: session.wsid,
    appointment_datetime: appointmentDatetime,
    location,
    lang: 'de',
  });

  const bookingUrl = `${API_BASE_URL}/booking?${bookingParams.toString()}`;
  const cookieHeader = buildCookieHeader(session);

  const headers: Record<string, string> = {
    Accept: 'text/html, application/json, */*',
    'Accept-Language': 'de-DE,de;q=0.9',
    'User-Agent': USER_AGENT,
    Referer: session.bookingUrl,
  };

  if (cookieHeader) headers.Cookie = cookieHeader;

  if (AUTO_BOOK_DRY_RUN) {
    log(`Auto-book DRY-RUN: ${slot.date_time} → ${bookingUrl}`);
    return true;
  }

  log(`Auto-book: бронирование ${slot.date_time}…`);

  const getRes = await fetch(bookingUrl, { headers });

  if (!getRes.ok) {
    throw new BookingError(`GET booking HTTP ${getRes.status}`);
  }

  const html = await getRes.text();
  const csrf = extractCsrf(html);

  if (!csrf) {
    throw new BookingError('CSRF token не найден на странице booking');
  }

  const formBody = new URLSearchParams();
  formBody.set(csrf.name, csrf.value);
  formBody.set('mail', BOOKING_EMAIL);

  const postRes = await fetch(bookingUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.toString(),
    redirect: 'follow',
  });

  if (!postRes.ok && postRes.status !== 302) {
    throw new BookingError(`POST booking HTTP ${postRes.status}`);
  }

  const resultHtml = await postRes.text();

  if (/session_expired|fehlgeschlagen|error/i.test(resultHtml) && !/erfolg|bestätig|confirmation/i.test(resultHtml)) {
    throw new BookingError('Бронирование отклонено сервером');
  }

  log(`Auto-book: запрос отправлен для ${slot.date_time} (${BOOKING_EMAIL})`);
  return true;
}
