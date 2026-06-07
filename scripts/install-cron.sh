#!/usr/bin/env bash
# Установка cron-задачи: запуск Termin-Hunter каждый день в 07:00 (Europe/Berlin)
#
# Использование:
#   chmod +x scripts/install-cron.sh
#   ./scripts/install-cron.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${PROJECT_DIR}/termin-hunter.log"
LOCK_FILE="/tmp/termin-hunter.lock"
NPM_BIN="$(command -v npm)"

CRON_LINE="0 7 * * * cd ${PROJECT_DIR} && flock -n ${LOCK_FILE} ${NPM_BIN} start >> ${LOG_FILE} 2>&1"

echo "Termin-Hunter cron installer"
echo "  Проект:  ${PROJECT_DIR}"
echo "  Лог:     ${LOG_FILE}"
echo "  Строка:  ${CRON_LINE}"
echo ""

EXISTING="$(crontab -l 2>/dev/null || true)"

if echo "${EXISTING}" | grep -Fq "termin-hunter"; then
  echo "Cron-задача termin-hunter уже установлена. Обновляю..."
  EXISTING="$(echo "${EXISTING}" | grep -Fv "termin-hunter" | grep -Fv "${PROJECT_DIR}" || true)"
fi

{
  echo "${EXISTING}"
  echo "# termin-hunter: ежедневный запуск в 07:00, работа до 19:00 (внутри приложения)"
  echo "${CRON_LINE}"
} | crontab -

echo ""
echo "Готово. Проверка: crontab -l"
echo ""
echo "Важно:"
echo "  • Убедитесь, что в .env заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID"
echo "  • HEADLESS=true для cron (без GUI)"
echo "  • Остановка вручную: /stop в Telegram или kill процесса"
echo "  • Логи: tail -f ${LOG_FILE}"
