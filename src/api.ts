/**
 * Опрос Smart CX search_result и парсинг слотов.
 *
 * Smart CX возвращает HTML-страницу с JSON в #json_appointment_list,
 * а не чистый JSON (см. aachen-termin-bot, leipzigappointmentsbot).
 */

import type { Page } from 'playwright';
import { API_BASE_URL, API_SEARCH_MODE, USER_AGENT } from './config';
import { buildCookieHeader, type SmartCxSession } from './session';
import { log } from './logger';

export interface ApiSlot {
  date_time: string;
  datetime_iso86001?: string;
  link: string;
  unit?: string;
  duration?: string;
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

function buildSearchUrl(session: SmartCxSession): string {
  const params = new URLSearchParams({
    search_mode: API_SEARCH_MODE,
    uid: session.uid,
    wsid: session.wsid,
    lang: 'de',
  });

  return `${API_BASE_URL}/search_result?${params.toString()}`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function normalizeLink(link: string): string {
  const trimmed = link.trim();

  if (trimmed.startsWith('http')) return trimmed;
  if (trimmed.startsWith('/')) return `https://terminvereinbarung.leipzig.de${trimmed}`;
  if (trimmed.startsWith('m/')) return `https://terminvereinbarung.leipzig.de/${trimmed}`;

  return `https://terminvereinbarung.leipzig.de/${trimmed}`;
}

const BOOKING_ORIGIN = 'https://terminvereinbarung.leipzig.de';

/**
 * Дополняет ссылку uid/wsid/lang — без wsid слот на другом устройстве
 * часто открывает session_expired вместо формы бронирования.
 */
export function enrichBookingLink(rawLink: string, session: SmartCxSession): string {
  try {
    const url = new URL(normalizeLink(rawLink));

    if (!url.searchParams.has('wsid')) {
      url.searchParams.set('wsid', session.wsid);
    }
    if (!url.searchParams.has('uid')) {
      url.searchParams.set('uid', session.uid);
    }
    if (!url.searchParams.has('lang')) {
      url.searchParams.set('lang', 'de');
    }

    return url.href;
  } catch {
    return enrichBookingLink(session.bookingUrl, session);
  }
}

/** Ссылка на календарь с актуальной сессией (fallback) */
export function getCalendarUrl(session: SmartCxSession): string {
  return enrichBookingLink(session.bookingUrl, session);
}

function mapRawSlot(raw: Record<string, unknown>): ApiSlot | null {
  const date_time = typeof raw.date_time === 'string' ? raw.date_time : undefined;
  const link = typeof raw.link === 'string' ? normalizeLink(raw.link) : undefined;

  if (!date_time || !link) return null;

  return {
    date_time,
    link,
    unit: typeof raw.unit === 'string' ? raw.unit : undefined,
    duration: typeof raw.duration === 'string' ? raw.duration : undefined,
    datetime_iso86001:
      typeof raw.datetime_iso86001 === 'string' ? raw.datetime_iso86001 : undefined,
  };
}

/** Обогащает все слоты ссылками с uid/wsid для Telegram */
export function enrichSlotsForBooking(slots: ApiSlot[], session: SmartCxSession): ApiSlot[] {
  return slots.map((slot) => ({
    ...slot,
    link: enrichBookingLink(slot.link, session),
  }));
}

function normalizeResponse(data: unknown): ApiSlot[] {
  if (Array.isArray(data)) {
    return data
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map(mapRawSlot)
      .filter((s): s is ApiSlot => s !== null);
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    if (obj.appointments === 'nothing_Found' || obj.appointments === 'nothing_found') {
      return [];
    }

    if (Array.isArray(obj.appointments)) {
      return obj.appointments
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map(mapRawSlot)
        .filter((s): s is ApiSlot => s !== null);
    }

    for (const key of ['results', 'slots', 'data']) {
      const nested = obj[key];
      if (Array.isArray(nested)) {
        return normalizeResponse(nested);
      }
    }
  }

  return [];
}

function parseSlotsFromText(text: string): ApiSlot[] {
  const slots: ApiSlot[] = [];
  const objectRegex = /\{[^{}]*"date_time"\s*:\s*"([^"]+)"[^{}]*"link"\s*:\s*"([^"]+)"[^{}]*\}/g;

  let match: RegExpExecArray | null;

  while ((match = objectRegex.exec(text)) !== null) {
    const fragment = match[0];
    const date_time = match[1];
    const link = normalizeLink(match[2].replace(/\\\//g, '/'));

    const unitMatch = fragment.match(/"unit"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const isoMatch = fragment.match(/"datetime_iso86001"\s*:\s*"([^"]+)"/);

    slots.push({
      date_time,
      link,
      unit: unitMatch?.[1]?.replace(/\\"/g, '"'),
      datetime_iso86001: isoMatch?.[1],
    });
  }

  return slots;
}

function isSessionExpiredHtml(html: string): boolean {
  return /session_expired|Object moved/i.test(html);
}

function isNoSlotsHtml(html: string): boolean {
  return /Keine freien Termine gefunden|nothing_Found|nothing_found/i.test(html);
}

/** Парсит HTML-ответ search_result (основной формат Smart CX) */
function parseSlotsFromHtml(html: string): ApiSlot[] {
  if (isSessionExpiredHtml(html)) {
    throw new SessionExpiredError('Сессия wsid истекла (session_expired)');
  }

  if (isNoSlotsHtml(html)) {
    return [];
  }

  const jsonDiv = html.match(/id=["']json_appointment_list["'][^>]*>([\s\S]*?)<\/div>/i);

  if (jsonDiv?.[1]) {
    try {
      const data = JSON.parse(decodeHtmlEntities(jsonDiv[1].trim())) as unknown;
      return normalizeResponse(data);
    } catch {
      log('json_appointment_list найден, но JSON не распарсился');
    }
  }

  return parseSlotsFromText(html);
}

/** Парсит тело ответа search_result (HTML или JSON) */
function parseResponseBody(text: string): ApiSlot[] {
  if (!text.trim() || text.trim() === '[]') {
    return [];
  }

  if (text.trimStart().startsWith('<')) {
    return parseSlotsFromHtml(text);
  }

  try {
    return normalizeResponse(JSON.parse(text) as unknown);
  } catch {
    return parseSlotsFromText(text);
  }
}

/** Сканирует открытую страницу search_results (bootstrap) */
export async function scrapeSlotsFromPage(page: Page): Promise<ApiSlot[]> {
  const html = await page.content();

  if (isNoSlotsHtml(html)) {
    return [];
  }

  const linkSlots = await page
    .locator('#step_search_results ol li a[href], #step_search_results a[href*="booking"]')
    .all();

  const domSlots: ApiSlot[] = [];

  for (const link of linkSlots) {
    const href = await link.getAttribute('href');
    const label = (await link.innerText()).trim().replace(/\s+/g, ' ');

    if (href && label) {
      domSlots.push({
        date_time: label,
        link: normalizeLink(href),
      });
    }
  }

  if (domSlots.length > 0) {
    return domSlots;
  }

  return parseSlotsFromHtml(html);
}

export async function pollSlots(session: SmartCxSession): Promise<ApiSlot[]> {
  const url = buildSearchUrl(session);
  const cookieHeader = buildCookieHeader(session);

  log(`API-опрос: ${API_SEARCH_MODE} (uid=${session.uid.slice(0, 8)}…)`);

  const headers: Record<string, string> = {
    Accept: 'text/html, application/json, */*',
    'Accept-Language': 'de-DE,de;q=0.9',
    'User-Agent': USER_AGENT,
    Referer: session.bookingUrl,
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const response = await fetch(url, { headers });

  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError(`HTTP ${response.status}: сессия wsid истекла`);
  }

  if (!response.ok && response.status !== 404) {
    throw new Error(`API вернул HTTP ${response.status}`);
  }

  return parseResponseBody(await response.text());
}

export async function pollSlotsWithContext(
  context: import('playwright').BrowserContext,
  session: SmartCxSession,
): Promise<ApiSlot[]> {
  const url = buildSearchUrl(session);

  log(`API-опрос (browser): ${API_SEARCH_MODE} (uid=${session.uid.slice(0, 8)}…)`);

  const response = await context.request.get(url, {
    headers: {
      Accept: 'text/html, application/json, */*',
      'Accept-Language': 'de-DE,de;q=0.9',
      Referer: session.bookingUrl,
    },
  });

  if ([401, 403].includes(response.status())) {
    throw new SessionExpiredError(`HTTP ${response.status()}: сессия wsid истекла`);
  }

  return parseResponseBody(await response.text());
}

export async function pollSlotsFromPage(page: Page, session: SmartCxSession): Promise<ApiSlot[]> {
  const domSlots = await scrapeSlotsFromPage(page);

  if (domSlots.length > 0) {
    return domSlots;
  }

  return pollSlotsWithContext(page.context(), session);
}
