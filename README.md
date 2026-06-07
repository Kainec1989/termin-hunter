# Termin-Hunter

Автоматический мониторинг свободных Termine в **Kfz-Zulassungsbehörde Leipzig** (услуга «Technische Änderung») с мгновенным уведомлением в Telegram.

Сайт записи работает на **Smart CX (Smart CJM)**. Скрипт использует гибридную схему: Playwright проходит wizard один раз и получает сессию (`uid` / `wsid`), дальше слоты опрашиваются через HTTP API.

## Возможности

- Мониторинг слотов каждые ~4 минуты (с jitter ±20 сек)
- Рабочее окно **07:00–19:00** (Europe/Berlin), автозавершение вечером
- Cron: ежедневный запуск в 07:00
- Telegram: **только при найденном Termin** (дата, время, ссылка)
- Команды бота: `/status`, `/stop`, `/check`
- Ссылки на бронирование дополняются `uid`, `wsid`, `lang=de`

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

Остальные параметры — в `.env.example` (интервал, рабочие часы, headless, браузер).

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
| `/status` | Статус мониторинга и последняя проверка |
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
Цикл (до 19:00): API search_result → слот? → Telegram
     ↓
19:00 → процесс завершается → завтра снова cron
```

**Bootstrap (Playwright)** нужен когда:
- первый запуск
- истекла сессия `wsid`
- протухли cookies

**API-опрос** — быстрый GET `search_result` между bootstrap-ами.

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

## Скрипты npm

```bash
npm start    # запуск
npm run check  # проверка TypeScript
npm run build  # компиляция в dist/
```

## Лицензия

MIT
