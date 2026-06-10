/**
 * Termin-Hunter — главный модуль (гибрид API + Playwright).
 */

import 'dotenv/config';
import {
  pollSlots,
  pollSlotsFromPage,
  pollSlotsWithContext,
  scrapeSlotsFromPage,
  SessionExpiredError,
  AmbiguousResponseError,
  enrichSlotsForBooking,
} from './api';
import { createBrowserSession, closeBrowserSession, type BrowserSession } from './browser';
import { navigateToCalendar } from './navigation';
import {
  loadSession,
  saveSession,
  invalidateSession,
  hasValidSession,
  needsSessionRefresh,
  sessionAgeMinutes,
} from './session';
import {
  notifySlotsFound,
  startTelegramBot,
  registerShutdownCallback,
  registerForceCheckCallback,
  setMonitoringActive,
  recordCheckResult,
  updateSchedulerStatus,
  incrementBootstrapCount,
  incrementCheckCount,
  recordError,
} from './telegram';
import {
  isWithinWorkingHours,
  msUntilWorkEnd,
  getWorkHoursLabel,
  getPollIntervalMs,
  getPollModeLabel,
  getJitterMs,
  getMinPollDelayMs,
  isPreBootstrapWindow,
  isReleaseBurstWindow,
} from './schedule';
import { log, logError } from './logger';
import { BROWSER_CHANNEL } from './config';

const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS ?? '240000', 10);
const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const BURST_KEEP_BROWSER_OPEN =
  (process.env.BURST_KEEP_BROWSER_OPEN ?? 'true').toLowerCase() !== 'false';

let isRunning = true;
let wakeScheduler: (() => void) | null = null;
let preBootstrapDone = false;
let activeBrowserSession: BrowserSession | null = null;
let checkChain: Promise<string> = Promise.resolve('');

async function executeCheck(): Promise<string> {
  const run = checkChain.then(() => runSingleCheck());
  checkChain = run.catch(() => '');
  return run;
}

registerShutdownCallback(() => {
  isRunning = false;
  wakeScheduler?.();
  void closeBrowserSession(activeBrowserSession).then(() => {
    activeBrowserSession = null;
  });
});

registerForceCheckCallback(() => {
  wakeScheduler?.();
  return executeCheck();
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

function randomJitterDelay(baseMs: number, jitterMs: number, minMs: number): number {
  const delta = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
  return Math.max(minMs, baseMs + delta);
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

function shouldKeepBrowserOpen(): boolean {
  return BURST_KEEP_BROWSER_OPEN && isReleaseBurstWindow();
}

async function bootstrapSession(keepBrowserOpen = false): Promise<void> {
  if (activeBrowserSession) {
    await closeBrowserSession(activeBrowserSession);
    activeBrowserSession = null;
  }

  let browserSession: BrowserSession | null = null;

  try {
    log('Bootstrap: запуск браузера для получения uid/wsid...');
    browserSession = await createBrowserSession(HEADLESS);
    incrementBootstrapCount();

    const result = await navigateToCalendar(browserSession.page);
    const cookies = await browserSession.context.cookies();
    const sessionData = { ...result, cookies };

    const saved = saveSession(sessionData);
    const sessionWithAge = { ...saved, createdAt: Date.now() };

    const domSlots = await scrapeSlotsFromPage(browserSession.page);
    const apiSlots = await pollSlotsWithContext(browserSession.context, sessionWithAge);

    if (domSlots.length !== apiSlots.length) {
      log(
        `Bootstrap: DOM=${domSlots.length} слотов, API=${apiSlots.length} — ${domSlots.length > apiSlots.length ? 'API мог пропустить слоты' : 'расхождение'}`,
      );
    }

    const slots = domSlots.length > 0 ? domSlots : apiSlots;
    log(`Bootstrap: ${slots.length > 0 ? `найдено ${slots.length} слотов` : 'свободных окон нет'}`);

    if (keepBrowserOpen) {
      activeBrowserSession = browserSession;
      browserSession = null;
      log('Браузер оставлен открытым для burst-опроса');
    }
  } finally {
    if (browserSession) {
      await closeBrowserSession(browserSession);
      log('Браузер закрыт');
    }
  }
}

async function ensureFreshSession(force = false): Promise<void> {
  const session = loadSession();

  if (force || !hasValidSession() || needsSessionRefresh(session)) {
    const reason = force
      ? 'принудительный'
      : !hasValidSession()
        ? 'сессия отсутствует'
        : `возраст ${sessionAgeMinutes(session!)} мин`;
    log(`Re-bootstrap (${reason})`);
    invalidateSession();
    await bootstrapSession(shouldKeepBrowserOpen());
  }
}

async function handlePreBootstrap(): Promise<void> {
  if (!isPreBootstrapWindow()) {
    preBootstrapDone = false;
    return;
  }

  if (preBootstrapDone) return;

  log('Pre-bootstrap: свежая сессия перед выбросом слотов');
  preBootstrapDone = true;
  invalidateSession();
  await bootstrapSession(shouldKeepBrowserOpen());
}

async function pollWithSession(session: NonNullable<ReturnType<typeof loadSession>>) {
  if (activeBrowserSession) {
    return pollSlotsWithContext(activeBrowserSession.context, session);
  }

  return pollSlots(session);
}

async function runSingleCheck(): Promise<string> {
  try {
    await handlePreBootstrap();
    await ensureFreshSession();

    let session = loadSession();

    if (!session) {
      throw new Error('Сессия недоступна после bootstrap');
    }

    let slots;

    try {
      slots = await pollWithSession(session);
    } catch (error) {
      if (error instanceof SessionExpiredError || error instanceof AmbiguousResponseError) {
        logError('Сессия недействительна', error);
        invalidateSession();
        await closeBrowserSession(activeBrowserSession);
        activeBrowserSession = null;
        await bootstrapSession(shouldKeepBrowserOpen());
        session = loadSession();

        if (!session) {
          throw new Error('Не удалось восстановить сессию после re-bootstrap');
        }

        slots = await pollWithSession(session);
      } else {
        throw error;
      }
    }

    incrementCheckCount();

    if (slots.length > 0) {
      const bookable = enrichSlotsForBooking(slots, session);

      log(`Найдено свободных слотов: ${bookable.length}`);
      bookable.forEach((s, i) => log(`  ${i + 1}. ${s.date_time}${s.unit ? ` (${s.unit})` : ''} → ${s.link}`));

      await notifySlotsFound(bookable, session);
      recordCheckResult(`найдено ${slots.length} слотов`);
      return `найдено ${slots.length} слотов`;
    }

    log('Свободных окон нет');
    recordCheckResult('свободных окон нет');
    return 'свободных окон нет';
  } catch (error) {
    logError('Ошибка при проверке', error);
    recordError();
    recordCheckResult('ошибка');
    throw error;
  } finally {
    if (!shouldKeepBrowserOpen() && activeBrowserSession) {
      await closeBrowserSession(activeBrowserSession);
      activeBrowserSession = null;
      log('Браузер закрыт (конец burst-окна)');
    }
  }
}

async function schedulerLoop(): Promise<void> {
  while (isRunning) {
    if (!isWithinWorkingHours()) {
      log(`Вне рабочих часов (${getWorkHoursLabel()}) — завершение на сегодня`);
      setMonitoringActive(false);
      break;
    }

    const baseInterval = getPollIntervalMs();
    const jitter = getJitterMs();
    const minDelay = getMinPollDelayMs();
    const delayBefore = randomJitterDelay(baseInterval, jitter, minDelay);
    const untilEnd = msUntilWorkEnd();
    const actualDelay = untilEnd > 0 ? Math.min(delayBefore, untilEnd) : delayBefore;

    updateSchedulerStatus({
      pollMode: getPollModeLabel(),
      nextCheckSec: Math.round(actualDelay / 1000),
      session: loadSession(),
    });

    log(`Следующая проверка через ~${Math.round(actualDelay / 1000)} сек. [${getPollModeLabel()}]`);

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
  log(`Интервал: ~${CHECK_INTERVAL_MS / 1000} сек (burst: ${getPollIntervalMs()} мс)`);
  log(`Headless: ${HEADLESS}`);
  log(`Браузер: ${BROWSER_CHANNEL ?? 'chromium (playwright)'}`);
  log(`Burst browser: ${BURST_KEEP_BROWSER_OPEN ? 'да' : 'нет'}`);
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

  void executeCheck().catch((error) => logError('Ошибка при стартовой проверке', error));
  await schedulerLoop();

  await closeBrowserSession(activeBrowserSession);
  activeBrowserSession = null;

  log('Termin-Hunter остановлен');
}

main().catch((error) => {
  logError('Критическая ошибка', error);
  process.exit(1);
});
