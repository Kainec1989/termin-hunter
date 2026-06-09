#!/usr/bin/env bash
# Установка cron-задачи: запуск Termin-Hunter каждый день в 07:00 (Europe/Berlin)
# + страховочный запуск перед выбросом слотов (Пн/Ср 14:55, Пт 10:55)
#
# Использование:
#   chmod +x scripts/install-cron.sh
#   ./scripts/install-cron.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/termin-hunter.log"
LOCK_FILE="/tmp/termin-hunter.lock"
NPM_BIN="$(command -v npm)"
STDBUF_BIN="$(command -v stdbuf || true)"

if [[ -n "${STDBUF_BIN}" ]]; then
  RUN_CMD="${STDBUF_BIN} -oL ${NPM_BIN} start"
else
  RUN_CMD="${NPM_BIN} start"
fi

CRON_DAILY="0 7 * * * cd ${PROJECT_DIR} && flock -n ${LOCK_FILE} ${RUN_CMD} >> ${LOG_FILE} 2>&1"
CRON_PRE_MON_WED="55 14 * * 1,3 cd ${PROJECT_DIR} && flock -n ${LOCK_FILE} ${RUN_CMD} >> ${LOG_FILE} 2>&1"
CRON_PRE_FRI="55 10 * * 5 cd ${PROJECT_DIR} && flock -n ${LOCK_FILE} ${RUN_CMD} >> ${LOG_FILE} 2>&1"

echo "Termin-Hunter cron installer"
echo "  Проект:  ${PROJECT_DIR}"
echo "  Лог:     ${LOG_FILE}"
echo "  stdbuf:  ${STDBUF_BIN:-не найден (логи также пишутся из logger.ts)}"
echo ""
echo "  Ежедневно 07:00:     ${CRON_DAILY}"
echo "  Пн/Ср 14:55:         ${CRON_PRE_MON_WED}"
echo "  Пт 10:55:            ${CRON_PRE_FRI}"
echo ""

EXISTING="$(crontab -l 2>/dev/null || true)"

if echo "${EXISTING}" | grep -Fq "termin-hunter"; then
  echo "Cron-задача termin-hunter уже установлена. Обновляю..."
  EXISTING="$(echo "${EXISTING}" | grep -Fv "termin-hunter" | grep -Fv "${PROJECT_DIR}" || true)"
fi

{
  echo "${EXISTING}"
  echo "# termin-hunter: ежедневный запуск в 07:00, работа до 19:00 (внутри приложения)"
  echo "${CRON_DAILY}"
  echo "# termin-hunter: страховка перед выбросом слотов (flock пропустит, если процесс уже работает)"
  echo "${CRON_PRE_MON_WED}"
  echo "${CRON_PRE_FRI}"
} | crontab -

echo ""
echo "Готово. Проверка: crontab -l"
echo ""
echo "Важно:"
echo "  • Убедитесь, что в .env заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID"
echo "  • HEADLESS=true для cron (без GUI)"
echo "  • Остановка вручную: /stop в Telegram или kill процесса"
echo "  • Логи: tail -f ${LOG_FILE}"
echo "  • Диагностика API: cat ${PROJECT_DIR}/.last-check.json"
