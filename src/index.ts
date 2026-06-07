/**
 * Termin-Hunter — главный модуль (гибрид API + Playwright).
 */

import 'dotenv/config';
import { pollSlots, pollSlotsFromPage, SessionExpiredError, enrichSlotsForBooking } from './api';
import { createBrowserSession, closeBrowserSession } from './browser';
import { navigateToCalendar } from './navigation';
import {
  loadSession,
  saveSession,
  invalidateSession,
  hasValidSession,
} from './session';
import {
  notifySlotsFound,
  startTelegramBot,
  registerShutdownCallback,
  registerForceCheckCallback,
  setMonitoringActive,
  recordCheckResult,
} from './telegram';
import { isWithinWorkingHours, msUntilWorkEnd, getWorkHoursLabel } from './schedule';
import { log, logError } from './logger';
import { BROWSER_CHANNEL } from './config';

const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS ?? '240000', 10);
const JITTER_MS = parseInt(process.env.JITTER_MS ?? '20000', 10);
const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';

let isRunning = true;
let forceCheckRequested = false;
let wakeScheduler: (() => void) | null = null;

registerShutdownCallback(() => {
  isRunning = false;
  wakeScheduler?.();
});

registerForceCheckCallback(() => {
  forceCheckRequested = true;
  wakeScheduler?.();
});

function setupSignalHandlers(): void {
  process.on('SIGINT', () => {
    log('Получен SIGINT — завершение...');
    isRunning = false;
    wakeScheduler?.();
  });

  process.on('SIGTERM', () => {
    log('Получен SIGTERM — завершение...');
    isRunning = false;
    wakeScheduler?.();
  });
}

function randomJitterDelay(baseMs: number, jitterMs: number): number {
  const delta = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
  return Math.max(30_000, baseMs + delta);
}

async function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeScheduler = null;
      resolve();
    }, ms);

    wakeScheduler = () => {
      clearTimeout(timer);
      wakeScheduler = null;
      resolve();
    };
  });
}

async function bootstrapSession(): Promise<void> {
  let browserSession = null;

  try {
    log('Bootstrap: запуск браузера для получения uid/wsid...');
    browserSession = await createBrowserSession(HEADLESS);

    const result = await navigateToCalendar(browserSession.page);
    const cookies = await browserSession.context.cookies();
    const sessionData = { ...result, cookies };

    saveSession(sessionData);

    const slots = await pollSlotsFromPage(browserSession.page, {
      ...sessionData,
      createdAt: Date.now(),
    });

    log(`Bootstrap: ${slots.length > 0 ? `найдено ${slots.length} слотов` : 'свободных окон нет'}`);
  } finally {
    await closeBrowserSession(browserSession);
    log('Браузер закрыт');
  }
}

async function runSingleCheck(): Promise<void> {
  try {
    if (!hasValidSession()) {
      await bootstrapSession();
    }

    let session = loadSession();

    if (!session) {
      throw new Error('Сессия недоступна после bootstrap');
    }

    let slots;

    try {
      slots = await pollSlots(session);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        logError('Сессия истекла', error);
        invalidateSession();
        await bootstrapSession();
        session = loadSession();

        if (!session) {
          throw new Error('Не удалось восстановить сессию после re-bootstrap');
        }

        slots = await pollSlots(session);
      } else {
        throw error;
      }
    }

    if (slots.length > 0) {
      const bookable = enrichSlotsForBooking(slots, session);

      log(`Найдено свободных слотов: ${bookable.length}`);
      bookable.forEach((s, i) => log(`  ${i + 1}. ${s.date_time}${s.unit ? ` (${s.unit})` : ''} → ${s.link}`));

      await notifySlotsFound(bookable, session);
      recordCheckResult(`найдено ${slots.length} слотов`);
    } else {
      log('Свободных окон нет');
      recordCheckResult('свободных окон нет');
    }
  } catch (error) {
    logError('Ошибка при проверке', error);
    recordCheckResult('ошибка');
  }
}

async function schedulerLoop(): Promise<void> {
  while (isRunning) {
    if (!isWithinWorkingHours()) {
      log(`Вне рабочих часов (${getWorkHoursLabel()}) — завершение на сегодня`);
      setMonitoringActive(false);
      break;
    }

    if (forceCheckRequested) {
      forceCheckRequested = false;
      log('Внеочередная проверка (/check)');
      await runSingleCheck();

      if (!isRunning || !isWithinWorkingHours()) break;
      continue;
    }

    const delayBefore = randomJitterDelay(CHECK_INTERVAL_MS, JITTER_MS);
    const untilEnd = msUntilWorkEnd();
    const actualDelay = untilEnd > 0 ? Math.min(delayBefore, untilEnd) : delayBefore;

    log(`Следующая проверка через ~${Math.round(actualDelay / 1000)} сек.`);

    await interruptibleSleep(actualDelay);

    if (!isRunning) break;

    if (!isWithinWorkingHours()) {
      log(`Рабочий день завершён (${getWorkHoursLabel()})`);
      setMonitoringActive(false);
      break;
    }

    await runSingleCheck();
  }
}

async function main(): Promise<void> {
  setupSignalHandlers();

  log('═'.repeat(50));
  log('Termin-Hunter — мониторинг Zulassungsstelle Leipzig');
  log('Режим: гибрид (API search_result + Playwright bootstrap)');
  log(`Рабочие часы: ${getWorkHoursLabel()}`);
  log(`Интервал: ~${CHECK_INTERVAL_MS / 1000} сек ± ${JITTER_MS / 1000} сек`);
  log(`Headless: ${HEADLESS}`);
  log(`Браузер: ${BROWSER_CHANNEL ?? 'chromium (playwright)'}`);
  log('═'.repeat(50));

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    logError('Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в файле .env');
    process.exit(1);
  }

  if (!isWithinWorkingHours()) {
    log(`Сейчас вне рабочих часов (${getWorkHoursLabel()}). Выход.`);
    process.exit(0);
  }

  await startTelegramBot();
  log('Telegram: push-уведомления только при найденном Termin (/status /stop /check — по запросу)');

  await runSingleCheck();
  await schedulerLoop();

  log('Termin-Hunter остановлен');
}

main().catch((error) => {
  logError('Критическая ошибка', error);
  process.exit(1);
});
