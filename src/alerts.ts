/**
 * Дополнительные каналы уведомлений: ntfy, Pushover, TTS (inverse/termin, impf-botpy).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ApiSlot } from './api';
import type { SmartCxSession } from './session';
import { enrichBookingLink } from './api';
import { log, logError } from './logger';

const execFileAsync = promisify(execFile);

const NTFY_TOPIC = process.env.NTFY_TOPIC?.trim();
const NTFY_SERVER = (process.env.NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/$/, '');
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY?.trim();
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN?.trim();
const TTS_ON_SLOT = (process.env.TTS_ON_SLOT ?? 'false').toLowerCase() === 'true';
const TTS_COMMAND = process.env.TTS_COMMAND ?? 'spd-say';

export function hasExtraAlerts(): boolean {
  return !!(NTFY_TOPIC || (PUSHOVER_USER_KEY && PUSHOVER_API_TOKEN) || TTS_ON_SLOT);
}

async function sendNtfy(title: string, message: string, link?: string): Promise<void> {
  if (!NTFY_TOPIC) return;

  const headers: Record<string, string> = {
    Title: title,
    Priority: 'urgent',
    Tags: 'calendar',
  };

  if (link) headers.Click = link;

  const response = await fetch(`${NTFY_SERVER}/${NTFY_TOPIC}`, {
    method: 'POST',
    headers,
    body: message,
  });

  if (!response.ok) {
    throw new Error(`ntfy HTTP ${response.status}`);
  }

  log('ntfy: уведомление отправлено');
}

async function sendPushover(title: string, message: string, url?: string): Promise<void> {
  if (!PUSHOVER_USER_KEY || !PUSHOVER_API_TOKEN) return;

  const body = new URLSearchParams({
    token: PUSHOVER_API_TOKEN,
    user: PUSHOVER_USER_KEY,
    title,
    message,
    priority: '1',
  });

  if (url) {
    body.set('url', url);
    body.set('url_title', 'Termin öffnen');
  }

  const response = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    body,
  });

  if (!response.ok) {
    throw new Error(`Pushover HTTP ${response.status}`);
  }

  log('Pushover: уведомление отправлено');
}

async function speakAlert(text: string): Promise<void> {
  if (!TTS_ON_SLOT) return;

  try {
    await execFileAsync(TTS_COMMAND, [text], { timeout: 10_000 });
    log('TTS: озвучено уведомление');
  } catch (error) {
    logError('TTS не удалось', error);
  }
}

export async function sendExtraSlotAlerts(
  slots: ApiSlot[],
  session: SmartCxSession,
  booked = false,
): Promise<void> {
  if (!hasExtraAlerts() || slots.length === 0) return;

  const first = slots[0];
  const link = enrichBookingLink(first.link, session);
  const title = booked ? 'Termin gebucht!' : 'Termin gefunden!';
  const lines = slots.map((s, i) => `${i + 1}. ${s.date_time}${s.unit ? ` (${s.unit})` : ''}`).join('\n');
  const message = `${lines}\n\n${link}`;

  const tasks: Promise<void>[] = [];

  if (NTFY_TOPIC) {
    tasks.push(sendNtfy(title, message, link).catch((e) => logError('ntfy', e)));
  }

  if (PUSHOVER_USER_KEY && PUSHOVER_API_TOKEN) {
    tasks.push(sendPushover(title, message, link).catch((e) => logError('Pushover', e)));
  }

  if (TTS_ON_SLOT) {
    tasks.push(speakAlert('Termin gefunden! Sofort buchen!'));
  }

  await Promise.all(tasks);
}
