# Termin-Hunter

Автоматический мониторинг свободных Termine в **Kfz-Zulassungsbehörde Leipzig** (услуга «Technische Änderung») с мгновенным уведомлением в Telegram.

Сайт записи работает на **Smart CX (Smart CJM)**. Скрипт использует гибридную схему: Playwright проходит wizard один раз и получает сессию (`uid` / `wsid`), дальше слоты опрашиваются через HTTP API.

## Возможности

- Мониторинг слотов каждые ~4 минуты (с jitter ±20 сек)
- **HTTP bootstrap** без браузера (паттерн smartcjm-sniper) — быстрее и стабильнее в cron
- Быстрое обновление `wsid` через HTTP redirect
- **Burst-режим** в окна выброса слотов Leipzig: Пн/Ср с 14:58, Пт с 10:58 — агрессивный опрос ~30 сек
- Проактивное обновление сессии (TTL 15 мин, refresh каждые 12 мин)
- Опрос API в режимах `earliest` + `all`
- Опциональное **авто-бронирование** (`AUTO_BOOK` + `BOOKING_EMAIL`)
- Доп. уведомления: **ntfy**, **Pushover**, **TTS**
- Рабочее окно **07:00–19:00** (или **круглосуточно** при `AUTO_BOOK` + `BOOKING_EMAIL`)
- При успешном auto-book агент **останавливается** (`AUTO_BOOK_STOP_ON_SUCCESS=true`)
- Cron: ежедневный запуск в 07:00 + страховка Пн/Ср 14:55, Пт 10:55
- Telegram: **только при найденном Termin** (дата, время, ссылка)
- Команды бота: `/status`, `/stop`, `/check` (расширенный статус с возрастом сессии и API)
- Ссылки на бронирование дополняются `uid`, `wsid`, `lang=de`
- Логи в `termin-hunter.log` + диагностика `.last-check.json`

## Требования

- Node.js 18+
- Google Chrome (рекомендуется) или Chromium из Playwright
- Telegram-бот ([@BotFather](https://t.me/BotFather))

## Установка

```bash
git clone <repo-url> Termin
cd Termin
npm install
```

Если используете Chromium из Playwright (без `BROWSER_CHANNEL=chrome`):

```bash
npx playwright install chromium
```

## Настройка

```bash
cp .env.example .env
```

Заполните обязательные переменные:

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather |
| `TELEGRAM_CHAT_ID` | ID вашего чата (@userinfobot) |

Остальные параметры — в `.env.example` (интервал, burst, TTL сессии, headless, браузер).

### Telegram-бот

1. Создайте бота у [@BotFather](https://t.me/BotFather)
2. Узнайте свой chat ID у [@userinfobot](https://t.me/userinfobot)
3. Напишите боту `/start` один раз (чтобы он мог вам отвечать)

## Запуск

```bash
npm start
```

Для отладки с видимым браузером:

```bash
HEADLESS=false npm start
```

Сброс сохранённой сессии:

```bash
rm -f .session.json
npm start
```

## Автозапуск по cron

Скрипт устанавливает задачу «каждый день в 07:00»:

```bash
chmod +x scripts/install-cron.sh
./scripts/install-cron.sh
```

Логи:

```bash
tail -f termin-hunter.log
```

Для cron в `.env` рекомендуется:

```env
HEADLESS=true
BROWSER_CHANNEL=chrome
```

## Команды Telegram

| Команда | Действие |
|---|---|
| `/status` | Статус: режим опроса, возраст сессии, API-диагностика, счётчики |
| `/stop` | Остановить мониторинг |
| `/check` | Внеочередная проверка |

Push-уведомления приходят **только при найденном свободном Termin**.

## Как это работает

```
07:00 cron → npm start
     ↓
Playwright: wizard → Technische Änderung → календарь
     ↓
Сохранение uid/wsid + cookies в .session.json
     ↓
Цикл (до 19:00): API search_result (earliest + all) → слот? → Telegram
     ↓
Пн/Ср 14:58–15:45, Пт 10:58–11:45: burst ~30 сек + свежий bootstrap
     ↓
19:00 → процесс завершается → завтра снова cron
```

### Ожидания по Termin

Leipzig Kfz публикует новые Termine **Пн и Ср с 15:00**, **Пт с 11:00** (до 21 дня вперёд). Слоты для «Technische Änderung» разбирают за секунды — агент **увеличивает шанс**, но не гарантирует запись. Рекомендуется оставить burst-настройки по умолчанию и проверять `/status` в день выброса.

**Bootstrap (HTTP по умолчанию):** `get_service_list` → POST услуги → `wsid`. Fallback на Playwright (`BOOTSTRAP_MODE=playwright`).

**API-опрос** — быстрый GET `search_result` между bootstrap-ами.

**Авто-booking** — при `AUTO_BOOK=true` слот бронируется через `/booking` до Telegram-уведомления.

## Структура проекта

```
Termin/
├── src/
│   ├── index.ts       # главный цикл
│   ├── api.ts         # опрос и парсинг слотов
│   ├── navigation.ts  # проход wizard Smart CX
│   ├── session.ts     # uid/wsid/cookies
│   ├── telegram.ts    # бот и уведомления
│   ├── schedule.ts    # рабочие часы
│   ├── browser.ts     # Playwright
│   ├── config.ts      # URL и селекторы
│   └── logger.ts
├── scripts/
│   └── install-cron.sh
├── .env.example
└── package.json
```

Селекторы и URL — в [`src/config.ts`](src/config.ts). Если сайт изменится, правьте их там.

## Услуга и URL

- **Услуга:** Technische Änderung (корректировка данных автомобиля после HU)
- **Точка входа:** [Kfz-Zulassungsbehörde Leipzig](https://terminvereinbarung.leipzig.de/m/leipzig-kfz/extern/calendar/?uid=c97bb32a-92b8-41ba-b5c2-f91d0e90019f)

## Ссылки в уведомлениях

Smart CX привязывает бронирование к сессии `wsid` (~20 мин). В сообщении:

1. **Забронировать этот Termin** — прямая ссылка на слот (с `uid`/`wsid`)
2. **Календарь** — fallback, если прямая ссылка не открылась

Открывайте ссылку **сразу** — слоты разбирают за минуты.

## Ручная калибровка сессии

Если wizard в браузере не нужен, можно задать сессию в `.env`:

```env
SERVICE_UID=c97bb32a-92b8-41ba-b5c2-f91d0e90019f
SESSION_WSID=<из URL календаря после ручного прохода>
```

## Устранение неполадок

| Проблема | Решение |
|---|---|
| «Услуга не найдена» | Проверьте `TEXT_SERVICE_VEHICLE_CORRECTION` в `config.ts` |
| API возвращает HTML / session expired | `rm -f .session.json` и перезапуск |
| Chrome не найден | `BROWSER_CHANNEL=chrome` + установленный Google Chrome |
| Бот не отвечает на команды | Напишите боту `/start`, проверьте `TELEGRAM_CHAT_ID` |
| Cron не стартует | `crontab -l`, логи в `termin-hunter.log` |
| Неясно, работает ли опрос | `cat .last-check.json`, `/status` в Telegram |
| Ложные «нет слотов» | Сессия устарела — уменьшите `SESSION_TTL_MS`, проверьте burst |

## Скрипты npm

```bash
npm start    # запуск
npm run check  # проверка TypeScript
npm run build  # компиляция в dist/
```

## Лицензия

MIT
