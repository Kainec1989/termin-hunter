/**
 * Авто-бронирование слота через Smart CX /booking (паттерн smartcjm-appointment-sniper).
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { API_BASE_URL, USER_AGENT } from './config';
import { env } from './env';
import { fetchWithRetry } from './fetch-retry';
import { log, logError } from './logger';
import type { ApiSlot } from './api';
import { buildCookieHeader, getApiUid, type SmartCxSession } from './session';
import { extractCsrf, isBookingSuccessHtml } from './smart-cx-utils';

export class BookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingError';
  }
}

const LAST_BOOKING_FILE = join(process.cwd(), '.last-booking.json');

export interface LastBookingRecord {
  timestamp: string;
  slot: string;
  success: boolean;
  finalUrl?: string;
  reason?: string;
  responsePreview: string;
}

export function isAutoBookEnabled(): boolean {
  return env.AUTO_BOOK && env.BOOKING_EMAIL.length > 0;
}

function saveLastBooking(record: LastBookingRecord): void {
  try {
    writeFileSync(LAST_BOOKING_FILE, JSON.stringify(record, null, 2), 'utf-8');
  } catch {
    // ignore
  }
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
    saveLastBooking({
      timestamp: new Date().toISOString(),
      slot: slot.date_time,
      success: false,
      reason: 'missing datetime/location',
      responsePreview: slot.link,
    });
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

  if (env.AUTO_BOOK_DRY_RUN) {
    log(`Auto-book DRY-RUN: ${slot.date_time} → ${bookingUrl}`);
    saveLastBooking({
      timestamp: new Date().toISOString(),
      slot: slot.date_time,
      success: true,
      finalUrl: bookingUrl,
      reason: 'dry-run',
      responsePreview: '',
    });
    return true;
  }

  log(`Auto-book: бронирование ${slot.date_time}…`);

  const getRes = await fetchWithRetry(bookingUrl, { headers });

  if (!getRes.ok) {
    const err = new BookingError(`GET booking HTTP ${getRes.status}`);
    saveLastBooking({
      timestamp: new Date().toISOString(),
      slot: slot.date_time,
      success: false,
      reason: err.message,
      responsePreview: '',
    });
    throw err;
  }

  const html = await getRes.text();
  const csrf = extractCsrf(html);

  if (!csrf) {
    const err = new BookingError('CSRF token не найден на странице booking');
    saveLastBooking({
      timestamp: new Date().toISOString(),
      slot: slot.date_time,
      success: false,
      finalUrl: getRes.url,
      reason: err.message,
      responsePreview: html.slice(0, 200),
    });
    throw err;
  }

  const formBody = new URLSearchParams();
  formBody.set(csrf.name, csrf.value);
  formBody.set('mail', env.BOOKING_EMAIL);

  const postRes = await fetchWithRetry(bookingUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.toString(),
    redirect: 'follow',
  });

  if (!postRes.ok && postRes.status !== 302) {
    const err = new BookingError(`POST booking HTTP ${postRes.status}`);
    saveLastBooking({
      timestamp: new Date().toISOString(),
      slot: slot.date_time,
      success: false,
      finalUrl: postRes.url,
      reason: err.message,
      responsePreview: '',
    });
    throw err;
  }

  const resultHtml = await postRes.text();
  const finalUrl = postRes.url;
  const success = isBookingSuccessHtml(resultHtml, finalUrl);

  saveLastBooking({
    timestamp: new Date().toISOString(),
    slot: slot.date_time,
    success,
    finalUrl,
    reason: success ? 'confirmed' : 'rejected by server',
    responsePreview: resultHtml.slice(0, 200),
  });

  if (!success) {
    throw new BookingError('Бронирование отклонено сервером');
  }

  log(`Auto-book: успех для ${slot.date_time} (${env.BOOKING_EMAIL})`);
  return true;
}
