/**
 * HTTP bootstrap Smart CX без Playwright (паттерн smartcjm-appointment-sniper / smart-cjm-scraper).
 */

import type { Cookie } from 'playwright';
import {
  API_BASE_URL,
  BOOKING_BASE_URL,
  TEXT_SERVICE_VEHICLE_CORRECTION,
  USER_AGENT,
} from './config';
import { log } from './logger';
import type { SmartCxSession } from './session';

export class HttpBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpBootstrapError';
  }
}

const PORTAL_UID = new URL(BOOKING_BASE_URL).searchParams.get('uid') ?? '';

interface JarCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

/** Простой cookie-jar для fetch-сессии */
class CookieJar {
  private cookies = new Map<string, JarCookie>();

  private key(c: JarCookie): string {
    return `${c.domain ?? ''}|${c.path ?? '/'}|${c.name}`;
  }

  set(name: string, value: string, domain?: string, path = '/'): void {
    this.cookies.set(this.key({ name, value, domain, path }), { name, value, domain, path });
  }

  absorb(response: Response, requestUrl: string): void {
    const raw = response.headers.getSetCookie?.() ?? [];

    for (const line of raw) {
      const part = line.split(';')[0]?.trim();
      const eq = part?.indexOf('=');
      if (!eq || eq < 1) continue;

      const name = part!.slice(0, eq);
      const value = part!.slice(eq + 1);
      let domain: string | undefined;
      let path = '/';

      for (const seg of line.split(';').slice(1)) {
        const s = seg.trim().toLowerCase();
        if (s.startsWith('domain=')) domain = seg.trim().slice(7);
        if (s.startsWith('path=')) path = seg.trim().slice(5);
      }

      if (!domain) {
        try {
          domain = new URL(requestUrl).hostname;
        } catch {
          // ignore
        }
      }

      this.set(name, value, domain, path);
    }

    // fallback для старых Node без getSetCookie
    const single = response.headers.get('set-cookie');
    if (single && raw.length === 0) {
      const part = single.split(';')[0]?.trim();
      const eq = part?.indexOf('=');
      if (eq && eq > 0) {
        this.set(part!.slice(0, eq), part!.slice(eq + 1), new URL(requestUrl).hostname);
      }
    }
  }

  header(): string {
    return [...this.cookies.values()].map((c) => `${c.name}=${c.value}`).join('; ');
  }

  toPlaywrightCookies(): Cookie[] {
    return [...this.cookies.values()].map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? 'terminvereinbarung.leipzig.de',
      path: c.path ?? '/',
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax' as const,
    }));
  }
}

function defaultHeaders(jar: CookieJar, referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'text/html, application/json, */*',
    'Accept-Language': 'de-DE,de;q=0.9',
    'User-Agent': USER_AGENT,
  };

  const cookie = jar.header();
  if (cookie) headers.Cookie = cookie;
  if (referer) headers.Referer = referer;

  return headers;
}

async function fetchWithJar(
  jar: CookieJar,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = { ...defaultHeaders(jar, init.headers && 'Referer' in init.headers ? String((init.headers as Record<string, string>).Referer) : undefined), ...(init.headers as Record<string, string> | undefined) };
  const cookie = jar.header();
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(url, { ...init, headers });
  jar.absorb(response, url);
  return response;
}

function extractWsidFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('wsid');
  } catch {
    return null;
  }
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

/** Не путать с JS-конфигом url_expired: "session_expired?uid=..." на живой странице */
function isSessionExpiredHtml(html: string): boolean {
  if (/Ihre Sitzung ist abgelaufen/i.test(html)) return true;
  if (/id=["']step_session_expired["']/i.test(html)) return true;
  if (/Object moved/i.test(html) && !/RequestVerificationToken|services-list/i.test(html)) return true;
  return false;
}

interface ServiceEntry {
  uid: string;
  service_name: string;
}

/** wsid из HTTP redirect (kfz-terminschuetze) */
export async function fetchWsidViaRedirect(
  portalUid: string = PORTAL_UID,
  jar = new CookieJar(),
): Promise<{ wsid: string; jar: CookieJar }> {
  const entryUrl = `${API_BASE_URL}/?uid=${encodeURIComponent(portalUid)}&lang=de`;

  const response = await fetchWithJar(jar, entryUrl, { redirect: 'manual' });

  if (response.status === 301 || response.status === 302) {
    const location = response.headers.get('location') ?? '';
    const wsidMatch = location.match(/wsid=([0-9a-fA-F-]+)/);
    if (wsidMatch) {
      return { wsid: wsidMatch[1], jar };
    }
    const wsid = extractWsidFromUrl(location);
    if (wsid) return { wsid, jar };
  }

  // follow redirects — wsid в финальном URL
  const follow = await fetchWithJar(jar, entryUrl, { redirect: 'follow' });
  const finalUrl = follow.url;
  const wsid = extractWsidFromUrl(finalUrl);

  if (!wsid) {
    const html = await follow.text();
    if (isSessionExpiredHtml(html)) {
      throw new HttpBootstrapError('Сессия истекла при получении wsid');
    }
    throw new HttpBootstrapError(`wsid не найден (HTTP ${follow.status})`);
  }

  return { wsid, jar };
}

async function fetchServiceList(portalUid: string, jar: CookieJar): Promise<ServiceEntry[]> {
  const url = `${API_BASE_URL}/get_service_list?uid=${encodeURIComponent(portalUid)}`;

  const response = await fetchWithJar(jar, url, {
    headers: defaultHeaders(jar),
  });

  if (!response.ok) {
    throw new HttpBootstrapError(`get_service_list HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    success?: boolean;
    results?: Array<{ uid?: string; service_name?: string }>;
  };

  if (!data.success || !Array.isArray(data.results)) {
    throw new HttpBootstrapError('get_service_list: неожиданный ответ');
  }

  return data.results
    .filter((s): s is { uid: string; service_name: string } => !!s.uid && !!s.service_name)
    .map((s) => ({ uid: s.uid, service_name: s.service_name }));
}

function findTargetService(services: ServiceEntry[]): ServiceEntry {
  const match = services.find((s) => TEXT_SERVICE_VEHICLE_CORRECTION.test(s.service_name));

  if (!match) {
    const names = services.map((s) => s.service_name).join(' | ');
    throw new HttpBootstrapError(`Услуга не найдена в get_service_list. Доступные: ${names || 'пусто'}`);
  }

  return match;
}

function buildBookingUrl(portalUid: string, wsid: string): string {
  return `${API_BASE_URL}/?uid=${encodeURIComponent(portalUid)}&wsid=${encodeURIComponent(wsid)}&lang=de`;
}

/**
 * Быстрое обновление только wsid (сохраняет cookies услуги, если есть).
 */
export async function refreshWsidOnly(
  session: SmartCxSession,
): Promise<Pick<SmartCxSession, 'uid' | 'wsid' | 'bookingUrl' | 'cookies' | 'serviceUid'>> {
  const jar = new CookieJar();

  if (session.cookies?.length) {
    for (const c of session.cookies) {
      jar.set(c.name, c.value, c.domain, c.path);
    }
  }

  const portalUid = session.uid;
  const { wsid } = await fetchWsidViaRedirect(portalUid, jar);

  log(`HTTP: wsid обновлён через redirect (${wsid.slice(0, 8)}…)`);

  return {
    uid: portalUid,
    wsid,
    bookingUrl: buildBookingUrl(portalUid, wsid),
    cookies: jar.toPlaywrightCookies(),
    serviceUid: session.serviceUid,
  };
}

/** Полный HTTP bootstrap: wsid + выбор услуги + wizard POST */
export async function httpBootstrap(): Promise<Omit<SmartCxSession, 'createdAt'>> {
  if (!PORTAL_UID) {
    throw new HttpBootstrapError('PORTAL_UID не извлечён из BOOKING_BASE_URL');
  }

  log('HTTP bootstrap: получение wsid…');
  const { wsid, jar } = await fetchWsidViaRedirect(PORTAL_UID);

  log('HTTP bootstrap: get_service_list…');
  const services = await fetchServiceList(PORTAL_UID, jar);
  const target = findTargetService(services);
  log(`HTTP bootstrap: услуга «${target.service_name}» (${target.uid.slice(0, 8)}…)`);

  const calendarUrl = `${API_BASE_URL}/?uid=${encodeURIComponent(PORTAL_UID)}&wsid=${encodeURIComponent(wsid)}&lang=de`;
  const pageRes = await fetchWithJar(jar, calendarUrl);
  const pageHtml = await pageRes.text();

  if (isSessionExpiredHtml(pageHtml)) {
    throw new HttpBootstrapError('Сессия истекла на странице календаря');
  }

  const csrf = extractCsrf(pageHtml);
  if (!csrf) {
    throw new HttpBootstrapError('CSRF token (RequestVerificationToken) не найден');
  }

  const formBody = new URLSearchParams();
  formBody.set(csrf.name, csrf.value);
  formBody.set('services', target.uid);
  formBody.set(`service_${target.uid}_amount`, '1');

  log('HTTP bootstrap: POST выбор услуги…');

  const postUrl = `${API_BASE_URL}/?uid=${encodeURIComponent(PORTAL_UID)}&wsid=${encodeURIComponent(wsid)}&lang=de`;

  const postRes = await fetchWithJar(jar, postUrl, {
    method: 'POST',
    headers: {
      ...defaultHeaders(jar, calendarUrl),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.toString(),
    redirect: 'follow',
  });

  const postHtml = await postRes.text();

  if (isSessionExpiredHtml(postHtml)) {
    throw new HttpBootstrapError('Сессия истекла после POST услуги');
  }

  const finalWsid = extractWsidFromUrl(postRes.url) ?? wsid;
  const bookingUrl = buildBookingUrl(PORTAL_UID, finalWsid);

  log(`HTTP bootstrap: готово (wsid=${finalWsid.slice(0, 8)}…)`);

  return {
    uid: PORTAL_UID,
    wsid: finalWsid,
    bookingUrl,
    cookies: jar.toPlaywrightCookies(),
    serviceUid: target.uid,
  };
}
