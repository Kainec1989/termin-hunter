/**
 * Опрос Smart CX search_result и парсинг слотов.
 *
 * Smart CX возвращает HTML-страницу с JSON в #json_appointment_list,
 * а не чистый JSON (см. aachen-termin-bot, leipzigappointmentsbot).
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import type { Page } from 'playwright';
import { API_BASE_URL, API_SEARCH_MODES, USER_AGENT } from './config';
import { buildCookieHeader, getApiUid, type SmartCxSession } from './session';
import { log } from './logger';

export interface ApiSlot {
  date_time: string;
  datetime_iso86001?: string;
  link: string;
  unit?: string;
  duration?: string;
}

export interface PollDiagnostics {
  timestamp: string;
  search_modes: string[];
  http_status: number;
  response_length: number;
  slot_count: number;
  no_slots: boolean;
  session_expired: boolean;
  has_json_div: boolean;
  ambiguous: boolean;
  response_preview: string;
}

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class AmbiguousResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmbiguousResponseError';
  }
}

const LAST_CHECK_FILE = join(process.cwd(), '.last-check.json');

let lastPollDiagnostics: PollDiagnostics | null = null;

export function getLastPollDiagnostics(): PollDiagnostics | null {
  return lastPollDiagnostics;
}

function saveLastCheck(diagnostics: PollDiagnostics): void {
  lastPollDiagnostics = diagnostics;

  try {
    writeFileSync(LAST_CHECK_FILE, JSON.stringify(diagnostics, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

function buildSearchUrl(session: SmartCxSession, searchMode: string): string {
  const params = new URLSearchParams({
    search_mode: searchMode,
    uid: getApiUid(session),
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

/**
 * Дополняет ссылку uid/wsid/lang — без wsid слот на другом устройстве
 * часто открывает session_expired вместо формы бронирования.
 */
export function enrichBookingLink(rawLink: string, session: SmartCxSession): string {
  try {
    const url = new URL(normalizeLink(rawLink));
    const apiUid = getApiUid(session);

    if (!url.searchParams.has('wsid')) {
      url.searchParams.set('wsid', session.wsid);
    }
    if (!url.searchParams.has('uid')) {
      url.searchParams.set('uid', apiUid);
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

function hasJsonAppointmentList(html: string): boolean {
  return /id=["']json_appointment_list["']/i.test(html);
}

function isAmbiguousHtml(html: string): boolean {
  if (!html.trim()) return true;
  if (isSessionExpiredHtml(html)) return false;
  if (isNoSlotsHtml(html)) return false;
  if (hasJsonAppointmentList(html)) return false;
  if (parseSlotsFromText(html).length > 0) return false;

  return true;
}

interface HtmlParseResult {
  slots: ApiSlot[];
  no_slots: boolean;
  session_expired: boolean;
  has_json_div: boolean;
  ambiguous: boolean;
}

/** Парсит HTML-ответ search_result (основной формат Smart CX) */
function parseSlotsFromHtml(html: string, throwOnAmbiguous = true): HtmlParseResult {
  if (isSessionExpiredHtml(html)) {
    throw new SessionExpiredError('Сессия wsid истекла (session_expired)');
  }

  if (isNoSlotsHtml(html)) {
    return { slots: [], no_slots: true, session_expired: false, has_json_div: false, ambiguous: false };
  }

  const hasJsonDiv = hasJsonAppointmentList(html);
  const jsonDiv = html.match(/id=["']json_appointment_list["'][^>]*>([\s\S]*?)<\/div>/i);

  if (jsonDiv?.[1]) {
    try {
      const data = JSON.parse(decodeHtmlEntities(jsonDiv[1].trim())) as unknown;
      return {
        slots: normalizeResponse(data),
        no_slots: false,
        session_expired: false,
        has_json_div: true,
        ambiguous: false,
      };
    } catch {
      log('json_appointment_list найден, но JSON не распарсился');
    }
  }

  const textSlots = parseSlotsFromText(html);

  if (textSlots.length > 0) {
    return {
      slots: textSlots,
      no_slots: false,
      session_expired: false,
      has_json_div: hasJsonDiv,
      ambiguous: false,
    };
  }

  if (throwOnAmbiguous && isAmbiguousHtml(html)) {
    throw new AmbiguousResponseError('Неоднозначный ответ API — вероятно устаревшая сессия');
  }

  return {
    slots: [],
    no_slots: false,
    session_expired: false,
    has_json_div: hasJsonDiv,
    ambiguous: isAmbiguousHtml(html),
  };
}

/** Парсит тело ответа search_result (HTML или JSON) */
function parseResponseBody(text: string): HtmlParseResult {
  if (!text.trim() || text.trim() === '[]') {
    return { slots: [], no_slots: true, session_expired: false, has_json_div: false, ambiguous: false };
  }

  if (text.trimStart().startsWith('<')) {
    return parseSlotsFromHtml(text);
  }

  try {
    return {
      slots: normalizeResponse(JSON.parse(text) as unknown),
      no_slots: false,
      session_expired: false,
      has_json_div: false,
      ambiguous: false,
    };
  } catch {
    const textSlots = parseSlotsFromText(text);
    return {
      slots: textSlots,
      no_slots: textSlots.length === 0,
      session_expired: false,
      has_json_div: false,
      ambiguous: textSlots.length === 0,
    };
  }
}

function slotDedupKey(slot: ApiSlot): string {
  return slot.datetime_iso86001 ?? `${slot.date_time}|${slot.link}`;
}

function mergeSlots(slotsLists: ApiSlot[][]): ApiSlot[] {
  const seen = new Set<string>();
  const merged: ApiSlot[] = [];

  for (const slots of slotsLists) {
    for (const slot of slots) {
      const key = slotDedupKey(slot);
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(slot);
      }
    }
  }

  return merged;
}

function recordDiagnostics(
  modes: readonly string[],
  httpStatus: number,
  body: string,
  slots: ApiSlot[],
  flags: Pick<PollDiagnostics, 'no_slots' | 'session_expired' | 'has_json_div' | 'ambiguous'>,
): void {
  saveLastCheck({
    timestamp: new Date().toISOString(),
    search_modes: [...modes],
    http_status: httpStatus,
    response_length: body.length,
    slot_count: slots.length,
    no_slots: flags.no_slots,
    session_expired: flags.session_expired,
    has_json_div: flags.has_json_div,
    ambiguous: flags.ambiguous,
    response_preview: body.slice(0, 200),
  });
}

async function fetchSearchResult(
  session: SmartCxSession,
  searchMode: string,
): Promise<{ body: string; status: number; parse: HtmlParseResult }> {
  const url = buildSearchUrl(session, searchMode);
  const cookieHeader = buildCookieHeader(session);

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
  const body = await response.text();

  if (response.status === 401 || response.status === 403) {
    throw new SessionExpiredError(`HTTP ${response.status}: сессия wsid истекла`);
  }

  if (!response.ok && response.status !== 404) {
    throw new Error(`API вернул HTTP ${response.status}`);
  }

  const parse = parseResponseBody(body);

  return { body, status: response.status, parse };
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

  return parseSlotsFromHtml(html, false).slots;
}

export async function pollSlots(session: SmartCxSession): Promise<ApiSlot[]> {
  const modes = API_SEARCH_MODES;
  const allSlots: ApiSlot[] = [];
  let lastBody = '';
  let lastStatus = 200;
  let lastFlags: Pick<PollDiagnostics, 'no_slots' | 'session_expired' | 'has_json_div' | 'ambiguous'> = {
    no_slots: true,
    session_expired: false,
    has_json_div: false,
    ambiguous: false,
  };

  log(`API-опрос: ${modes.join(' + ')} (uid=${getApiUid(session).slice(0, 8)}…)`);

  for (const mode of modes) {
    const { body, status, parse } = await fetchSearchResult(session, mode);
    lastBody = body;
    lastStatus = status;
    lastFlags = {
      no_slots: parse.no_slots,
      session_expired: parse.session_expired,
      has_json_div: parse.has_json_div,
      ambiguous: parse.ambiguous,
    };
    allSlots.push(...parse.slots);
  }

  const merged = mergeSlots([allSlots]);

  recordDiagnostics(modes, lastStatus, lastBody, merged, {
    ...lastFlags,
    no_slots: merged.length === 0 && lastFlags.no_slots,
  });

  return merged;
}

export async function pollSlotsWithContext(
  context: import('playwright').BrowserContext,
  session: SmartCxSession,
): Promise<ApiSlot[]> {
  const modes = API_SEARCH_MODES;
  const allSlots: ApiSlot[] = [];
  let lastBody = '';
  let lastStatus = 200;
  let lastFlags: Pick<PollDiagnostics, 'no_slots' | 'session_expired' | 'has_json_div' | 'ambiguous'> = {
    no_slots: true,
    session_expired: false,
    has_json_div: false,
    ambiguous: false,
  };

  log(`API-опрос (browser): ${modes.join(' + ')} (uid=${getApiUid(session).slice(0, 8)}…)`);

  for (const mode of modes) {
    const url = buildSearchUrl(session, mode);

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

    const body = await response.text();
    const parse = parseResponseBody(body);

    lastBody = body;
    lastStatus = response.status();
    lastFlags = {
      no_slots: parse.no_slots,
      session_expired: parse.session_expired,
      has_json_div: parse.has_json_div,
      ambiguous: parse.ambiguous,
    };
    allSlots.push(...parse.slots);
  }

  const merged = mergeSlots([allSlots]);

  recordDiagnostics(modes, lastStatus, lastBody, merged, {
    ...lastFlags,
    no_slots: merged.length === 0 && lastFlags.no_slots,
  });

  return merged;
}

export async function pollSlotsFromPage(page: Page, session: SmartCxSession): Promise<ApiSlot[]> {
  const domSlots = await scrapeSlotsFromPage(page);

  if (domSlots.length > 0) {
    recordDiagnostics(['dom'], 200, '', domSlots, {
      no_slots: false,
      session_expired: false,
      has_json_div: false,
      ambiguous: false,
    });
    return domSlots;
  }

  return pollSlotsWithContext(page.context(), session);
}
