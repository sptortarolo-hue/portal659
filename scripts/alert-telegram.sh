#!/bin/sh
# Portal 659 — alerta a Telegram (compartida por el monitor del VPS y el de
# GitHub Actions).
#
# Uso:
#   scripts/alert-telegram.sh "mensaje de una línea"
#   echo "mensaje largo" | scripts/alert-telegram.sh
#
# Env:
#   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   credenciales del entorno
#   TELEGRAM_ENV_FILE                       .env alternativo (default /opt/portal659/.env)
#
# Sin credenciales NO rompe nada: imprime en stderr y sale 0 (fail-open, igual
# que el resto de la plataforma: un monitor caído nunca debe ser la causa de
# otra caída). En el VPS las credenciales las escribe el deploy desde los
# secrets TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID; si no están, el monitor
# registra todo igual y sólo no avisa por el chat.

set -u

MSG="$*"
if [ -z "$MSG" ] && [ ! -t 0 ]; then
  MSG=$(cat)
fi
[ -n "$MSG" ] || { echo "alert-telegram: mensaje vacío, nada que enviar" >&2; exit 0; }

# --- credenciales --------------------------------------------------------------
ENV_FILE="${TELEGRAM_ENV_FILE:-/opt/portal659/.env}"
envget() {
  [ -f "$ENV_FILE" ] || return 1
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1 | tr -d '"'"'"' \r'
}

[ -n "${TELEGRAM_BOT_TOKEN:-}" ] || TELEGRAM_BOT_TOKEN=$(envget TELEGRAM_BOT_TOKEN || true)
[ -n "${TELEGRAM_CHAT_ID:-}" ] || TELEGRAM_CHAT_ID=$(envget TELEGRAM_CHAT_ID || true)

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "alert-telegram: sin TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID — la alerta queda sólo en el log" >&2
  printf '%s\n' "$MSG" >&2
  exit 0
fi

# Telegram corta el texto en 4096 chars.
MSG=$(printf '%s' "$MSG" | head -c 4000)

curl -fsS --max-time 20 \
  -o /dev/null \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${MSG}" \
  --data-urlencode "disable_web_page_preview=true" \
  || echo "alert-telegram: falló el envío a Telegram (revisá token/chat id)" >&2
