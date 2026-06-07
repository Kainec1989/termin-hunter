/**
 * Управление сессией Smart CX (uid + wsid + cookies).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Cookie } from 'playwright';
import { log } from './logger';

export interface SmartCxSession {
  uid: string;
  wsid: string;
  bookingUrl: string;
  createdAt: number;
  /** Cookies браузера — нужны для API search_result */
  cookies?: Cookie[];
}

const SESSION_FILE = join(process.cwd(), '.session.json');

let currentSession: SmartCxSession | null = null;

const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS ?? '3600000', 10);

export function parseSessionFromUrl(url: string): Pick<SmartCxSession, 'uid' | 'wsid' | 'bookingUrl'> | null {
  try {
    const parsed = new URL(url);
    const uid = parsed.searchParams.get('uid');
    const wsid = parsed.searchParams.get('wsid');

    if (!uid || !wsid) return null;

    return { uid, wsid, bookingUrl: url };
  } catch {
    return null;
  }
}

export function loadSession(): SmartCxSession | null {
  if (currentSession && isSessionValid(currentSession)) {
    return currentSession;
  }

  const fromEnv = loadSessionFromEnv();
  if (fromEnv) {
    currentSession = fromEnv;
    return fromEnv;
  }

  const fromFile = loadSessionFromFile();
  if (fromFile && isSessionValid(fromFile)) {
    currentSession = fromFile;
    return fromFile;
  }

  return null;
}

function loadSessionFromEnv(): SmartCxSession | null {
  const uid = process.env.SERVICE_UID;
  const wsid = process.env.SESSION_WSID;

  if (!uid || !wsid) return null;

  const bookingUrl =
    process.env.BOOKING_URL ??
    `https://terminvereinbarung.leipzig.de/m/leipzig-kfz/extern/calendar/?uid=${uid}&wsid=${wsid}`;

  log('Сессия загружена из .env (SERVICE_UID / SESSION_WSID)');

  return {
    uid,
    wsid,
    bookingUrl,
    createdAt: Date.now(),
  };
}

function loadSessionFromFile(): SmartCxSession | null {
  if (!existsSync(SESSION_FILE)) return null;

  try {
    const raw = readFileSync(SESSION_FILE, 'utf-8').trim();
    if (!raw) return null;

    const data = JSON.parse(raw) as SmartCxSession;

    if (data.uid && data.wsid) {
      log('Сессия загружена из .session.json');
      return data;
    }
  } catch {
    // повреждённый файл
  }

  return null;
}

export function saveSession(session: Omit<SmartCxSession, 'createdAt'>): SmartCxSession {
  const full: SmartCxSession = {
    ...session,
    createdAt: Date.now(),
  };

  currentSession = full;

  try {
    writeFileSync(SESSION_FILE, JSON.stringify(full, null, 2), 'utf-8');
    log(`Сессия сохранена (uid=${full.uid.slice(0, 8)}…, cookies=${full.cookies?.length ?? 0})`);
  } catch {
    log('Не удалось сохранить .session.json — сессия только в памяти');
  }

  return full;
}

export function invalidateSession(): void {
  currentSession = null;

  try {
    if (existsSync(SESSION_FILE)) {
      writeFileSync(SESSION_FILE, '', 'utf-8');
    }
  } catch {
    // ignore
  }

  log('Сессия сброшена — потребуется повторный bootstrap');
}

export function isSessionValid(session: SmartCxSession | null): boolean {
  if (!session?.uid || !session?.wsid) return false;

  const age = Date.now() - session.createdAt;
  return age < SESSION_TTL_MS;
}

export function hasValidSession(): boolean {
  const session = loadSession();
  return session !== null && isSessionValid(session);
}

/** Cookie-заголовок для fetch API */
export function buildCookieHeader(session: SmartCxSession): string | undefined {
  if (!session.cookies?.length) return undefined;

  return session.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}
