/**
 * Конфигурация селекторов и констант Termin-Hunter.
 *
 * Если сайт обновится и кнопки перестанут находиться — откройте DevTools (F12),
 * найдите нужный элемент и обновите соответствующую константу ниже.
 */

/**
 * Точка входа Kfz-Zulassungsbehörde (Smart CX wizard).
 * select2?md=4 больше не работает (404) — используем прямой deep-link с uid.
 * uid можно заменить, если на leipzig.de появится другая ссылка.
 */
export const BOOKING_BASE_URL =
  'https://terminvereinbarung.leipzig.de/m/leipzig-kfz/extern/calendar/?uid=c97bb32a-92b8-41ba-b5c2-f91d0e90019f';

/** Базовый URL Smart CX API для Kfz (tenant: leipzig-kfz, не leipzig-ba) */
export const API_BASE_URL =
  'https://terminvereinbarung.leipzig.de/m/leipzig-kfz/extern/calendar';

/** Режимы поиска слотов (опрашиваются последовательно, результаты объединяются) */
export const API_SEARCH_MODES = ['earliest', 'all'] as const;

/** Реальный User-Agent современного Chrome под Linux — снижает вероятность детекта бота */
export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Локаль браузера — немецкий интерфейс сайта */
export const BROWSER_LOCALE = 'de-DE';

/** Часовой пояс для корректного отображения дат */
export const BROWSER_TIMEZONE = 'Europe/Berlin';

/**
 * Канал браузера Playwright: chrome | chromium | msedge и т.д.
 * chrome — системный Google Chrome (не требует playwright install chromium).
 * Пусто — встроенный Chromium из Playwright.
 */
export const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL?.trim() || undefined;

// ─── Навигация: шаг 1 — выбор категории / офиса ───────────────────────────────

/** Кнопка или ссылка категории «Kfz-Zulassungsbehörde» / автотransport */
export const SELECTOR_CATEGORY_KFZ =
  'a[href*="select2"], button[data-category], .category-item, .service-category';

/** Текст для поиска категории автотransport (fallback через getByText) */
export const TEXT_CATEGORY_KFZ = /Kfz|Zulassung|Autotransport|Fahrzeug/i;

// ─── Навигация: шаг 2 — выбор конкретной услуги ─────────────────────────────

/**
 * Услуга на сайте Leipzig Kfz: «Technische Änderung» (корректировка данных после HU).
 * Dropdown quantity = 1, не checkbox.
 */
export const TEXT_SERVICE_VEHICLE_CORRECTION =
  /Technische Änderung|Korrektur der Fahrzeugdaten|Änderung der Anschrift/i;

/** Dropdown количества услуг Smart CX */
export const SELECTOR_SERVICE_SELECT = '[data-testid^="select_service"], .service_container select';

/** Количество для выбора услуги */
export const SERVICE_QUANTITY = '1';

/** CSS-селектор карточки услуги (Smart CX: .service_container) */
export const SELECTOR_SERVICE_ITEM =
  '.service_container, [data-testid^="checkbox_service"]';

/** Список услуг Smart CX (загружается через JS) */
export const SELECTOR_SERVICES_LIST = '#services-list';

/** Кнопка Weiter формы wizard — НЕ путать с «Weitere Details» */
export const SELECTOR_BUTTON_NEXT = '[data-testid="button_next"]';

/** Шаг календаря / поиска слотов */
export const SELECTOR_STEP_SEARCH_RESULTS = '#step_search_results';

/** Чекбокс принятия условий / Datenschutz */
export const SELECTOR_TERMS_CHECKBOX =
  'input[type="checkbox"][name*="terms"], input[type="checkbox"][id*="terms"], input[type="checkbox"][name*="agb"], #terms, #acceptTerms';

/** Кнопка «Weiter» / «Fortfahren» / «Akzeptieren» после чекбокса */
export const SELECTOR_CONTINUE_BUTTON =
  'button[type="submit"], input[type="submit"], button.btn-primary, a.btn-primary, #continue, #next';

/** Текст кнопки продолжения (только submit-кнопки, не ссылки «Weitere Details») */
export const TEXT_CONTINUE = /^Weiter$|^Fortfahren$|^Akzeptieren$/i;

// ─── Календарь: поиск свободных слотов ──────────────────────────────────────

/**
 * Элементы доступных дней в календаре.
 * Типичные классы систем select2/Terminland: .available, .free, .bookable
 */
export const SELECTOR_AVAILABLE_DAYS =
  '.calendar-day.available, .day.available, td.available, .fc-day.available, [data-available="true"], .datepicker-day:not(.disabled):not(.unavailable)';

/** Кликабельные таймслоты после выбора дня */
export const SELECTOR_TIME_SLOTS =
  'a[href*="slots"], .timeslot:not(.disabled), .time-slot.available, button.slot, .appointment-slot:not(.booked), .slot-free';

/** Контейнер календаря — ждём его появления как признак успешной навигации */
export const SELECTOR_CALENDAR_CONTAINER =
  '.calendar, #calendar, .datepicker, .fc-view, [class*="calendar"], [id*="calendar"]';

// ─── Таймауты ────────────────────────────────────────────────────────────────

/** Максимальное время ожидания загрузки страницы / элемента (мс) */
export const NAVIGATION_TIMEOUT_MS = 45_000;

/** Пауза между кликами — имитация человека (мс) */
export const HUMAN_DELAY_MS = 800;

/** Пауза после загрузки страницы перед действиями (мс) */
export const PAGE_SETTLE_MS = 2_000;
