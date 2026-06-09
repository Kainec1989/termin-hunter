/**
 * Пошаговая навигация Smart CX wizard до шага search_results (календарь).
 */

import type { Page } from 'playwright';
import {
  BOOKING_BASE_URL,
  HUMAN_DELAY_MS,
  NAVIGATION_TIMEOUT_MS,
  PAGE_SETTLE_MS,
  SELECTOR_BUTTON_NEXT,
  SELECTOR_SERVICE_SELECT,
  SELECTOR_STEP_SEARCH_RESULTS,
  SELECTOR_TERMS_CHECKBOX,
  SERVICE_QUANTITY,
  TEXT_SERVICE_VEHICLE_CORRECTION,
} from './config';
import { log } from './logger';
import { parseSessionFromUrl } from './session';

export interface CalendarNavigationResult {
  uid: string;
  wsid: string;
  bookingUrl: string;
  serviceUid?: string;
}

async function humanPause(page: Page, baseMs = HUMAN_DELAY_MS): Promise<void> {
  const jitter = Math.floor(Math.random() * 400);
  await page.waitForTimeout(baseMs + jitter);
}

async function acceptTermsIfPresent(page: Page): Promise<void> {
  const checkbox = page.locator(SELECTOR_TERMS_CHECKBOX).first();

  if ((await checkbox.count()) === 0) return;

  try {
    await checkbox.waitFor({ state: 'visible', timeout: 5_000 });
    if (!(await checkbox.isChecked())) {
      await humanPause(page);
      await checkbox.check({ force: true });
      log('Условия приняты (checkbox отмечен)');
    }
  } catch {
    log('Checkbox условий не удалось отметить');
  }
}

/** Ждёт загрузки списка услуг (select dropdown, не checkbox) */
async function waitForServicesLoaded(page: Page): Promise<void> {
  log('Ожидание загрузки списка услуг...');

  await page.waitForSelector(SELECTOR_SERVICE_SELECT, {
    state: 'visible',
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  await page.waitForSelector('.service_container', {
    state: 'visible',
    timeout: 10_000,
  });

  log('Список услуг загружен');
}

/** Выбирает «Technische Änderung» через dropdown (quantity = 1) */
async function selectTargetService(page: Page): Promise<string | undefined> {
  const serviceContainer = page
    .locator('.service_container')
    .filter({ hasText: TEXT_SERVICE_VEHICLE_CORRECTION })
    .first();

  if ((await serviceContainer.count()) === 0) {
    const titles = await page.locator('.service_title').allTextContents().catch(() => []);
    const available = titles.map((t) => t.trim()).filter(Boolean).join(' | ');
    throw new Error(
      `Услуга не найдена (Technische Änderung). Доступные: ${available || 'список пуст'}`,
    );
  }

  const select = serviceContainer.locator(SELECTOR_SERVICE_SELECT).first();

  await select.waitFor({ state: 'visible', timeout: 10_000 });
  await humanPause(page);
  await select.selectOption(SERVICE_QUANTITY);

  const serviceUid =
    (await serviceContainer.getAttribute('data-service-id')) ??
    (await serviceContainer.getAttribute('data-uid')) ??
    undefined;

  if (serviceUid) {
    log(`Услуга выбрана: Technische Änderung (serviceUid=${serviceUid.slice(0, 8)}…)`);
  } else {
    log(`Услуга выбрана: Technische Änderung (quantity=${SERVICE_QUANTITY})`);
  }

  return serviceUid ?? undefined;
}

async function clickWizardNext(page: Page): Promise<void> {
  const nextButton = page.locator(SELECTOR_BUTTON_NEXT).first();

  await nextButton.waitFor({ state: 'visible', timeout: 10_000 });
  await humanPause(page);
  await nextButton.click({ timeout: NAVIGATION_TIMEOUT_MS });
  log('Клик: Weiter (button_next)');
}

/** Шаг search_results: календарь или «Keine freien Termine gefunden» */
async function waitForSearchResultsStep(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector(SELECTOR_STEP_SEARCH_RESULTS, {
      state: 'visible',
      timeout: NAVIGATION_TIMEOUT_MS,
    }),
    page.getByText(/Keine freien Termine gefunden/i).waitFor({
      state: 'visible',
      timeout: NAVIGATION_TIMEOUT_MS,
    }),
  ]);

  const step = await page.locator('#step_current').inputValue().catch(() => '');

  if (step === 'search_results') {
    log('Шаг search_results достигнут');
  } else {
    log(`Страница календаря загружена (step=${step || 'unknown'})`);
  }
}

export async function navigateToCalendar(page: Page): Promise<CalendarNavigationResult> {
  log(`Открываю ${BOOKING_BASE_URL}`);

  const serviceListPromise = page
    .waitForResponse(
      (resp) => resp.url().includes('get_service_list') && resp.status() === 200,
      { timeout: NAVIGATION_TIMEOUT_MS },
    )
    .catch(() => null);

  await page.goto(BOOKING_BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  await serviceListPromise;
  await page.waitForTimeout(PAGE_SETTLE_MS);

  await waitForServicesLoaded(page);
  const serviceUid = await selectTargetService(page);
  await clickWizardNext(page);

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(PAGE_SETTLE_MS);

  await acceptTermsIfPresent(page);

  const stepAfterNext = await page.locator('#step_current').inputValue().catch(() => '');

  if (stepAfterNext !== 'search_results') {
    const nextVisible = await page.locator(SELECTOR_BUTTON_NEXT).isVisible().catch(() => false);

    if (nextVisible) {
      await clickWizardNext(page);
      await page.waitForTimeout(PAGE_SETTLE_MS);
    }
  }

  await waitForSearchResultsStep(page);

  const parsed = parseSessionFromUrl(page.url());

  if (!parsed) {
    throw new Error(
      `Не удалось извлечь uid/wsid из URL: ${page.url()}. Задайте SERVICE_UID / SESSION_WSID в .env`,
    );
  }

  log(`Сессия извлечена: uid=${parsed.uid.slice(0, 8)}… wsid=${parsed.wsid.slice(0, 8)}…`);

  return { ...parsed, serviceUid };
}
