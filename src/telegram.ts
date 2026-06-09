/**
 * Telegram-бот: уведомления, команды и кнопка остановки.
 */

import { Telegraf, Markup } from 'telegraf';
import type { ApiSlot, PollDiagnostics } from './api';
import { getLastPollDiagnostics } from './api';
import type { SmartCxSession } from './session';
import { sessionAgeMinutes, SESSION_TTL_MS, SESSION_REFRESH_MS } from './session';
import { enrichBookingLink, getCalendarUrl } from './api';
import { getBerlinTimeString, getWorkHoursLabel, isWithinWorkingHours } from './schedule';
import { log } from './logger';

let bot: Telegraf | null = null;
let shutdownCallback: (() => void) | null = null;
let forceCheckCallback: (() => void) | null = null;
let monitoringActive = true;
let lastCheckAt: string | null = null;
let lastCheckResult: string | null = null;

let schedulerPollMode: string | null = null;
let nextCheckSec: number | null = null;
let currentSession: SmartCxSession | null = null;
let bootstrapCount = 0;
let checkCount = 0;
let errorCount = 0;

const sentSlotKeys = new Set<string>();

function getBot(): Telegraf {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан в переменных окружения');
  }

  if (!bot) {
    bot = new Telegraf(token);
  }

  return bot;
}

function getChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID не задан в переменных окружения');
  }

  return chatId;
}

function isAuthorizedChat(chatId: number | undefined): boolean {
  return String(chatId) === getChatId();
}

export function registerForceCheckCallback(callback: () => void): void {
  forceCheckCallback = callback;
}

export function registerShutdownCallback(callback: () => void): void {
  shutdownCallback = callback;
}

export function setMonitoringActive(active: boolean): void {
  monitoringActive = active;
}

export function recordCheckResult(result: string): void {
  lastCheckAt = getBerlinTimeString();
  lastCheckResult = result;
}

export function updateSchedulerStatus(opts: {
  pollMode: string;
  nextCheckSec: number;
  session: SmartCxSession | null;
}): void {
  schedulerPollMode = opts.pollMode;
  nextCheckSec = opts.nextCheckSec;
  currentSession = opts.session;
}

export function incrementBootstrapCount(): void {
  bootstrapCount += 1;
}

export function incrementCheckCount(): void {
  checkCount += 1;
}

export function recordError(): void {
  errorCount += 1;
}

function slotKey(slot: ApiSlot): string {
  return slot.datetime_iso86001 ?? `${slot.date_time}|${slot.link}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatApiDiagnostics(diag: PollDiagnostics | null): string {
  if (!diag) return 'нет данных';

  const flags = [
    diag.no_slots ? 'no_slots' : null,
    diag.session_expired ? 'session_expired' : null,
    diag.has_json_div ? 'json_div' : null,
    diag.ambiguous ? 'ambiguous' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return `HTTP ${diag.http_status}, ${diag.slot_count} слотов, ${flags || 'ok'}`;
}

function stopKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('⏹ Остановить', 'stop_monitoring'),
  ]);
}

function statusText(): string {
  const lines = [
    '<b>Termin-Hunter — статус</b>',
    '',
    `🕐 Сейчас: ${escapeHtml(getBerlinTimeString())} (Berlin)`,
    `📅 Рабочие часы: ${escapeHtml(getWorkHoursLabel())}`,
    `▶️ Мониторинг: ${monitoringActive && isWithinWorkingHours() ? 'активен' : 'остановлен'}`,
  ];

  if (schedulerPollMode) {
    lines.push(`⚡ Режим опроса: ${escapeHtml(schedulerPollMode)}`);
  }

  if (nextCheckSec !== null) {
    lines.push(`⏱ Следующая проверка: ~${nextCheckSec} сек`);
  }

  if (currentSession) {
    const ageMin = sessionAgeMinutes(currentSession);
    const ttlMin = Math.round(SESSION_TTL_MS / 60_000);
    const refreshMin = Math.round(SESSION_REFRESH_MS / 60_000);
    lines.push(
      `🔑 Сессия: ${ageMin} мин (TTL ${ttlMin} мин, refresh ${refreshMin} мин)`,
    );
    if (currentSession.serviceUid && currentSession.serviceUid !== currentSession.uid) {
      lines.push(`   serviceUid: ${escapeHtml(currentSession.serviceUid.slice(0, 8))}…`);
    }
  } else {
    lines.push('🔑 Сессия: отсутствует');
  }

  if (lastCheckAt) {
    lines.push(`🔍 Последняя проверка: ${escapeHtml(lastCheckAt)} — ${escapeHtml(lastCheckResult ?? '')}`);
  }

  const diag = getLastPollDiagnostics();
  if (diag) {
    lines.push(`📡 API: ${escapeHtml(formatApiDiagnostics(diag))}`);
  }

  lines.push(
    '',
    `📊 Сегодня: ${checkCount} проверок, ${bootstrapCount} bootstrap, ${errorCount} ошибок`,
    '',
    'Команды: /status /stop /check',
  );

  return lines.join('\n');
}

async function requestShutdown(source: string): Promise<void> {
  log(`Остановка по запросу из Telegram (${source})`);
  monitoringActive = false;
  shutdownCallback?.();
}

/** Запускает long-polling для команд и кнопок */
export async function startTelegramBot(): Promise<void> {
  const telegraf = getBot();

  telegraf.use(async (ctx, next) => {
    if (!isAuthorizedChat(ctx.chat?.id)) {
      return;
    }
    await next();
  });

  telegraf.command('stop', async (ctx) => {
    await ctx.reply('⏹ Останавливаю мониторинг...', { parse_mode: 'HTML' });
    await requestShutdown('/stop');
  });

  telegraf.command('status', async (ctx) => {
    await ctx.reply(statusText(), {
      parse_mode: 'HTML',
      ...stopKeyboard(),
    });
  });

  telegraf.command('check', async (ctx) => {
    await ctx.reply('🔍 Запускаю внеочередную проверку...');
    forceCheckCallback?.();
  });

  telegraf.action('stop_monitoring', async (ctx) => {
    await ctx.answerCbQuery('Остановка...');
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch {
      // сообщение уже без клавиатуры
    }
    await requestShutdown('кнопка');
  });

  await telegraf.launch();
  log('Telegram-бот: команды /stop /status /check активны');

  process.once('SIGINT', () => telegraf.stop('SIGINT'));
  process.once('SIGTERM', () => telegraf.stop('SIGTERM'));
}

function escapeHtmlAttr(url: string): string {
  return url.replace(/&/g, '&amp;');
}

export async function notifySlotsFound(
  slots: ApiSlot[],
  session: SmartCxSession,
): Promise<void> {
  const newSlots = slots.filter((slot) => !sentSlotKeys.has(slotKey(slot)));

  if (newSlots.length === 0) {
    log('Telegram: все слоты уже были отправлены ранее — пропуск');
    return;
  }

  const telegraf = getBot();
  const chatId = getChatId();
  const calendarUrl = escapeHtmlAttr(getCalendarUrl(session));

  const slotLines = newSlots
    .map((slot, index) => {
      const label = slot.unit
        ? `${slot.date_time} (${slot.unit})`
        : slot.date_time;

      const bookingLink = escapeHtmlAttr(enrichBookingLink(slot.link, session));

      return `${index + 1}. <b>${escapeHtml(label)}</b>\n   <a href="${bookingLink}">Забронировать этот Termin</a>`;
    })
    .join('\n\n');

  const checkedAt = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  const message = [
    '🚨 <b>Termin-Hunter: свободный Termin!</b>',
    '',
    slotLines,
    '',
    `📎 <a href="${calendarUrl}">Календарь (если прямая ссылка не открылась)</a>`,
    '',
    `<i>${escapeHtml(checkedAt)} · wsid действует ~20 мин, бронируйте сразу</i>`,
  ].join('\n');

  await telegraf.telegram.sendMessage(chatId, message, {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: false },
  });

  for (const slot of newSlots) {
    sentSlotKeys.add(slotKey(slot));
  }

  log(`Telegram: отправлено уведомление о ${newSlots.length} новом слот(ах)`);
}
