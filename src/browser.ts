/**
 * Инициализация браузера через стандартный Playwright.
 *
 * По умолчанию — встроенный Chromium (`npx playwright install chromium`).
 * Для системного Google Chrome задайте BROWSER_CHANNEL=chrome в .env —
 * тогда `playwright install` не нужен, достаточно установленного Chrome.
 *
 * Smart CX (Leipzig) не использует Cloudflare — браузер нужен только
 * для bootstrap-сессии (получение uid/wsid).
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright';
import {
  BROWSER_CHANNEL,
  BROWSER_LOCALE,
  BROWSER_TIMEZONE,
  USER_AGENT,
} from './config';

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Создаёт новую сессию браузера.
 * Каждый bootstrap использует свежий контекст.
 */
export async function createBrowserSession(headless: boolean): Promise<BrowserSession> {
  const launchOptions: LaunchOptions = {
    headless,
    slowMo: headless ? 0 : 50,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      `--lang=${BROWSER_LOCALE}`,
    ],
  };

  if (BROWSER_CHANNEL) {
    launchOptions.channel = BROWSER_CHANNEL;
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: BROWSER_LOCALE,
    timezoneId: BROWSER_TIMEZONE,
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: {
      'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  return { browser, context, page };
}

/** Безопасно закрывает браузер */
export async function closeBrowserSession(session: BrowserSession | null): Promise<void> {
  if (!session) return;

  try {
    await session.context.close();
  } catch {
    // контекст уже закрыт
  }

  try {
    await session.browser.close();
  } catch {
    // браузер уже закрыт
  }
}
