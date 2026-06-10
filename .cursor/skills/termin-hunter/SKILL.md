# Termin-Hunter Skill

Guidance for developing **Termin-Hunter** — Leipzig Kfz Smart CX slot monitor with optional auto-booking.

## Architecture

```
cron / npm start
  → HTTP bootstrap (default) or Playwright fallback
  → poll search_result (earliest + all, parallel)
  → on slot: auto-book (optional) → extra alerts → Telegram
```

Key modules:

| File | Role |
|------|------|
| `src/index.ts` | Scheduler, bootstrap, check loop |
| `src/http-bootstrap.ts` | HTTP wizard without browser |
| `src/api.ts` | Slot polling and HTML parsing |
| `src/booking.ts` | Auto-book via `/booking` |
| `src/session.ts` | uid/wsid TTL and `.session.json` |
| `src/schedule.ts` | Burst windows Mon/Wed 15:00, Fri 11:00 |
| `src/env.ts` | Centralized environment config |

## Critical env vars

- `BOOTSTRAP_MODE=http` — prefer HTTP bootstrap (fast, low RAM)
- `AUTO_BOOK` + `BOOKING_EMAIL` — auto-book any found slot
- `SESSION_TTL_MS=900000` — wsid expires ~15 min
- `BURST_AGGRESSIVE_INTERVAL_MS=30000` — ~30s polling in release window
- `AUTO_BOOK_DRY_RUN=true` — test booking flow without POST

## Leipzig release windows

- **Mon/Wed** — new slots from 15:00 (Europe/Berlin)
- **Fri** — from 11:00
- Pre-bootstrap runs 2 min before release

## Debugging checklist

1. `tail -f termin-hunter.log`
2. `cat .last-check.json` — last API poll diagnostics
3. `cat .last-booking.json` — last auto-book attempt
4. Telegram `/status` — session age, poll mode, API flags
5. `/check` — force immediate poll

## OSS references (reimplement patterns only — do NOT copy GPL code)

- [smartcjm-appointment-sniper](https://github.com/jkhsjdhjs/smartcjm-appointment-sniper) — HTTP bootstrap, booking API
- [leipzigappointmentsbot](https://github.com/jakubwaller/leipzigappointmentsbot) — Leipzig `search_result` polling
- [kfz-terminschuetze](https://github.com/JohannesHupp/kfz-terminschuetze) — wsid via redirect
- [larsborn/smart-cjm-scraper](https://github.com/larsborn/smart-cjm-scraper) — Smart CX HTML patterns

## Conventions

- Use `getApiUid(session)` for API URLs — portal `uid`, not service UUID from `get_service_list`
- Book **before** Telegram notify when `AUTO_BOOK=true`
- Shared HTML helpers live in `src/smart-cx-utils.ts`
- Network fetch uses `src/fetch-retry.ts` with backoff
- Notification dedup persists in `.notified-slots.json` (24h TTL)
- Do not commit `.env`, `.session.json`, logs, or diagnostic JSON files

## Production

```bash
npm run build && node dist/index.js
```

Cron: `scripts/install-cron.sh` (07:00 daily + pre-release insurance).
