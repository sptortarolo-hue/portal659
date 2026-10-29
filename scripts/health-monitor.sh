#!/bin/sh
# Portal 659 — monitor de salud del borde + auto-heal + captura de forense.
#
# Corre en el HOST como root (cron instalado por deploy.yml, cada 2 min) y
# también bajo demanda desde GitHub Actions (health-monitor.yml, --force).
#
# QUÉ mide: http://127.0.0.1/api/health con Host del sitio. Pasa por nginx
# (el único que publica 80/443) → app → Postgres, o sea exactamente lo que
# Cloudflare necesita para no devolver 521. No usa la URL pública a propósito:
# si Cloudflare mismo se cae, el monitor no debe alertar ni reiniciar nada.
# La capa externa (el workflow) mira la URL pública y cubre el caso "host
# entero abajo", que desde adentro es invisible.
#
# QUÉ hace cuando falla 2 veces seguidas (o con --force):
#   1. captura forense ANTES de tocar nada (la evidencia se pierde: dmesg es
#      un ring buffer y journalctl rota)
#   2. si el disco está >= DISK_HEAL_MAX_PCT NO reinicia (no es la causa y
#      puede empeorar) — sólo alerta
#   3. auto-heal acotado: docker daemon → compose up -d (SIN build) → si nginx
#      sigue sin escuchar y el log dice que no puede cargar el certificado,
#      regenera el placeholder y reinicia nginx
#   4. re-verifica y avisa por Telegram con el resumen
#
# Nunca corre `compose up -d --build`: reconstruir desde un monitor es justo el
# chown de CPU/RAM/disco que se sospecha que voltea este VPS de 2GB.
#
# Uso:
#   /opt/portal659-monitor/health-monitor.sh            # modo cron
#   /opt/portal659-monitor/health-monitor.sh --force    # saltea el contador y el cooldown
#   /opt/portal659-monitor/health-monitor.sh --status   # sólo muestra el estado actual
#
# Estado en /opt/portal659-monitor (FUERA de /opt/portal659, que el deploy borra):
#   fails · last-heal · monitor.log · cron.log · forensics-*.log
#
# Env (del /opt/portal659/.env): TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID

set -u

MONITOR_DIR=/opt/portal659-monitor
APP_DIR=/opt/portal659
ENV_FILE=$APP_DIR/.env
LOG=$MONITOR_DIR/monitor.log
FAIL_FILE=$MONITOR_DIR/fails
LAST_HEAL=$MONITOR_DIR/last-heal
# status.json lo lee /admin/monitor (montado read-only en el contenedor app):
# es la única forma de que el panel vea datos del HOST sin meterle el socket de
# docker al contenedor. outages.log es el historial de cortes.
STATUS_FILE=$MONITOR_DIR/status.json
OUTAGES_LOG=$MONITOR_DIR/outages.log

HEAL_COOLDOWN=${HEAL_COOLDOWN:-600}      # segundos entre auto-heals (anti-flapping)
DISK_HEAL_MAX_PCT=${DISK_HEAL_MAX_PCT:-90}
MAX_FAILS=2                              # fallos seguidos antes de actuar
HEAL_WAIT=${HEAL_WAIT:-60}               # segundos que espera tras el heal

CHECK_URL="http://127.0.0.1/api/health"
CHECK_HOST="www.portal659.com.ar"
CONTAINERS="portal659 portal659-nginx portal659-db portal659-printbridge portal659-wabot"

FORCE=0
STATUS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --status) STATUS_ONLY=1 ;;
    *) echo "health-monitor: flag desconocido: $arg" >&2 ;;
  esac
done

mkdir -p "$MONITOR_DIR"
ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

# Log con rotación del MISMO inode (el cron abre con O_APPEND; recrear el
# archivo dejaría el fd escribiendo al borrado — mismo patrón que backup.sh).
log() {
  printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG"
  if [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 500 ]; then
    tail -n 300 "$LOG" > "$LOG.tmp" 2>/dev/null && cat "$LOG.tmp" > "$LOG" && rm -f "$LOG.tmp"
  fi
  printf '%s\n' "$*"
}

readf() { cat "$1" 2>/dev/null || echo ""; }
writef() { printf '%s' "$2" > "$1"; }

# --- chequeo -------------------------------------------------------------------
# curl -w '%{http_code}' YA imprime "000" cuando no puede conectar, así que no
# se le agrega un `|| echo 000` (quedaría "000000"). Se normaliza igual por si
# curl no está o devuelve basura.
probe_code() {
  _c=$(curl -s --max-time 10 -H "Host: $CHECK_HOST" -o /dev/null -w '%{http_code}' \
    "$CHECK_URL" 2>/dev/null)
  case "$_c" in
    [0-9][0-9][0-9]) echo "$_c" ;;
    *) echo 000 ;;
  esac
}

is_up() { [ "$(probe_code)" = "200" ]; }

# --- forense -------------------------------------------------------------------
# Se corre ANTES de cualquier acción: si reiniciás primero, el estado que
# explica la caída ya se fue.
forensics() {
  _out=$1
  {
    echo "===== forense Portal 659 — $(ts) ====="
    echo
    echo "--- uptime / carga ---"
    uptime 2>/dev/null || true
    echo
    echo "--- memoria (MB) ---"
    free -m 2>/dev/null || true
    echo
    echo "--- disco ---"
    df -h / /var/lib/docker 2>/dev/null || df -h /
    echo
    echo "--- daemon docker ---"
    systemctl is-active docker 2>/dev/null || echo "(sin systemd o sin unidad docker)"
    systemctl status docker --no-pager -n 5 2>/dev/null | tail -n 8 || true
    echo
    echo "--- contenedores (docker ps -a) ---"
    docker ps -a --format '{{.Names}} | {{.Status}}' 2>&1 || true
    echo
    echo "--- estado detallado por contenedor ---"
    for _c in $CONTAINERS; do
      docker inspect --format '{{.Name}} status={{.State.Status}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}} err={{.State.Error}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' \
        "$_c" 2>/dev/null || echo "$_c: no existe / no inspeccionable"
    done
    echo
    echo "--- quién escucha en 80/443 ---"
    ss -ltnp 2>/dev/null | grep -E ':(80|443) ' || echo "NADIE escucha en 80/443"
    echo
    echo "--- OOM en dmesg (ring buffer: se pierde) ---"
    dmesg -T 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process|Memory cgroup out' | tail -n 25 \
      || echo "(sin dmesg disponible o sin OOM registrado)"
    echo
    echo "--- journalctl docker (últimos 15 min) ---"
    journalctl -u docker --since '-15 min' --no-pager 2>/dev/null | tail -n 60 || true
    echo
    echo "--- logs nginx (la causa más probable de un 521) ---"
    docker logs --tail 60 --timestamps portal659-nginx 2>&1 | tail -n 60 || true
    echo
    echo "--- logs app ---"
    docker logs --tail 50 --timestamps portal659 2>&1 | tail -n 50 || true
    echo
    echo "--- logs db ---"
    docker logs --tail 25 --timestamps portal659-db 2>&1 | tail -n 25 || true
    echo
    echo "--- crons recientes ---"
    tail -n 15 /var/log/portal659-cron.log 2>/dev/null || true
    echo
    echo "--- certs TLS (si faltan, nginx no arranca) ---"
    ls -l /opt/portal659-certs/ 2>&1 || echo "NO EXISTE /opt/portal659-certs"
    for _f in /opt/portal659-certs/origin.pem /opt/portal659-certs/origin.key; do
      if [ -s "$_f" ]; then
        echo "$_f: OK ($(wc -c < "$_f") bytes)"
      else
        echo "$_f: FALTA O VACÍO  <-- nginx muere con 'cannot load certificate'"
      fi
    done
    echo
    echo "--- últimos deploys (GitHub Actions queda en el workflow) ---"
    tail -n 5 "$MONITOR_DIR/cron.log" 2>/dev/null || true
  } > "$_out" 2>&1
}

# --- resumen para Telegram -----------------------------------------------------
container_lines() {
  for _c in $CONTAINERS; do
    _s=$(docker inspect --format '{{.State.Status}} r={{.RestartCount}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' "$_c" 2>/dev/null) \
      && echo "  ${_c#portal659-}: $_s" \
      || echo "  ${_c#portal659-}: no existe"
  done
}

disk_pct() {
  df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}' || echo 0
}

mem_line() {
  free -m 2>/dev/null | awk '/^Mem:/{printf "%sM/%sM usados, swap %sM/%sM", $3, $2, $3, $2} /^Swap:/{printf " | swap %sM/%sM", $3, $2}' \
    || echo "sin dato"
}

alert() { "$MONITOR_DIR/alert-telegram.sh" "$1" || true; }

# --- auto-heal -----------------------------------------------------------------
# Devuelve 0 si el sitio quedó arriba.
heal() {
  _code=$1
  log "auto-heal: inicio (http=$_code)"

  # 1) daemon
  if ! systemctl is-active --quiet docker 2>/dev/null; then
    log "auto-heal: docker daemon inactivo → systemctl restart docker"
    systemctl restart docker 2>&1 | tail -n 3 || true
    sleep 10
  fi

  # 2) levantar lo caído. Sin --build a propósito (ver cabezal).
  if [ -d "$APP_DIR" ]; then
    ( cd "$APP_DIR" && docker compose up -d 2>&1 | tail -n 15 ) || true
  else
    log "auto-heal: no existe $APP_DIR — no puedo levantar el stack"
  fi
  sleep 8

  # 3) si nginx sigue sin escuchar, puede ser el certificado: nginx parsea
  #    ssl_certificate al arrancar y si falta el .pem O el .key el container
  #    muere entero → 80 y 443 caídos → 521. El deploy sólo regenera el
  #    placeholder si falta el .pem, no si falta el .key.
  if [ "$(probe_code)" != "200" ]; then
    if docker logs --tail 40 portal659-nginx 2>&1 | grep -qi 'cannot load certificate'; then
      log "auto-heal: nginx no puede cargar el certificado → regenero placeholder"
      mkdir -p /opt/portal659-certs
      openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /opt/portal659-certs/origin.key \
        -out /opt/portal659-certs/origin.pem \
        -subj "/CN=portal659.com.ar" 2>/dev/null || true
      docker restart portal659-nginx 2>&1 | tail -n 2 || true
      sleep 8
    else
      # restart genérico: re-resuelve el DNS del upstream 'app'
      log "auto-heal: nginx no responde → docker restart nginx + app"
      docker restart portal659-nginx 2>&1 | tail -n 2 || true
      sleep 5
      docker restart portal659 2>&1 | tail -n 2 || true
    fi
  fi

  # 4) esperar a que levante
  _i=0
  while [ "$_i" -lt "$HEAL_WAIT" ]; do
    if is_up; then
      log "auto-heal: sitio arriba tras ${$_i}s"
      return 0
    fi
    sleep 5
    _i=$((_i + 5))
  done
  is_up
}

# --- manejo del corte ----------------------------------------------------------
handle_outage() {
  _code=$1
  _fails=$2
  _now=$(date -u +%Y%m%d-%H%M%S)
  _forensic="$MONITOR_DIR/forensics-$_now.log"

  log "CORTE detectado: http=$_code (fallos seguidos: $_fails) → capturando forense"
  forensics "$_forensic"

  _disk=$(disk_pct)
  _mem=$(mem_line)
  _healed="no se intentó"
  _verdict=""

  # cooldown: si sanamos hace 10 min y volvió a caer, no reintectar en loop
  _last=$(readf "$LAST_HEAL")
  _wait=0
  if [ -n "$_last" ]; then
    _age=$(( $(date -u +%s) - $_last ))
    if [ "$_age" -lt "$HEAL_COOLDOWN" ] && [ "$FORCE" != "1" ]; then
      _wait=$(( HEAL_COOLDOWN - _age ))
    fi
  fi

  if [ "$_disk" -ge "$DISK_HEAL_MAX_PCT" ]; then
    _healed="NO reinicié: disco al ${_disk}% (reiniciar no arregla disco lleno y puede empeorarlo)"
    log "auto-heal: abortado por disco lleno (${_disk}%)"
  elif [ "$_wait" -gt 0 ] && [ "$FORCE" != "1" ]; then
    _healed="NO reinicié: en cooldown, faltan ${_wait}s del heal anterior"
    log "auto-heal: en cooldown (faltan ${_wait}s)"
  else
    writef "$LAST_HEAL" "$(date -u +%s)"
    if heal "$_code"; then
      _healed="SÍ — el sitio volvió a responder 200"
    else
      _healed="intentado y NO se recuperó (ver forense)"
    fi
  fi

  _up=$(is_up && echo "SÍ" || echo "NO")

  # Historial de cortes (una línea por corte; lo muestra /admin/monitor).
  printf '%s | http=%s | fallos=%s | heal=%s | arriba=%s | forense=%s\n' \
    "$(ts)" "$_code" "$_fails" "$_healed" "$_up" "$(basename "$_forensic")" >> "$OUTAGES_LOG"
  if [ "$(wc -l < "$OUTAGES_LOG" 2>/dev/null || echo 0)" -gt 100 ]; then
    tail -n 60 "$OUTAGES_LOG" > "$OUTAGES_LOG.tmp" 2>/dev/null \
      && cat "$OUTAGES_LOG.tmp" > "$OUTAGES_LOG" && rm -f "$OUTAGES_LOG.tmp"
  fi

  {
    echo "🔴 PORTAL 659 CAÍDO — $(ts)"
    echo
    echo "HTTP: $_code (esperado 200) · fallos seguidos: $_fails"
    echo "Disco: ${_disk}% · Mem: $_mem"
    echo "Load: $(uptime 2>/dev/null | sed 's/.*load average: //')"
    echo
    echo "Contenedores:"
    container_lines
    echo
    echo "Auto-heal: $_healed"
    echo "Sito arriba ahora: $_up"
    echo
    echo "Forense completo: $_forensic"
    echo "Log: $LOG"
    echo
    echo "https://www.portal659.com.ar"
  } > "$MONITOR_DIR/alert.txt" 2>&1
  alert "$(cat "$MONITOR_DIR/alert.txt")"
  writef "$FAIL_FILE" 0

  if [ "$_up" = "NO" ]; then
    log "CORTE sin recuperar —forense en $_forensic"
    return 1
  fi
  log "CORTE recuperado por auto-heal"
  return 0
}

# --- status.json para /admin/monitor -------------------------------------------
# Se escribe en CADA corrida (no sólo cuando falla): el panel necesita saber que
# el monitor está vivo, no sólo que el sitio está caído. Atómico vía tmp + mv
# (mismo filesystem): una lectura del panel nunca ve JSON a medias.
# Se construye a mano y sin comas colgadas para no depender de jq.
write_status() {
  _http=$1
  _up=$2
  _st="$STATUS_FILE.tmp"

  _mem=$(free -m 2>/dev/null | awk '/^Mem:/{print $3" "$2} /^Swap:/{print $3" "$2}')
  _mem_used=$(echo "$_mem" | awk 'NR==1{print $1}'); _mem_used=${_mem_used:-0}
  _mem_tot=$(echo "$_mem" | awk 'NR==1{print $2}'); _mem_tot=${_mem_tot:-0}
  _swp_used=$(echo "$_mem" | awk 'NR==2{print $1}'); _swp_used=${_swp_used:-0}
  _swp_tot=$(echo "$_mem" | awk 'NR==2{print $2}'); _swp_tot=${_swp_tot:-0}
  _load=$(awk '{print $1" "$2" "$3}' /proc/loadavg 2>/dev/null)
  _upt=$(cut -d. -f1 /proc/uptime 2>/dev/null); _upt=${_upt:-0}

  # contenedores: nombre, estado, salud, restarts, OOM, exit code
  _cjson=""
  for _c in $CONTAINERS; do
    _row=$(docker inspect --format '{{.State.Status}}|{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.ExitCode}}|{{.State.Error}}' \
      "$_c" 2>/dev/null) || continue
    _st_c=$(echo "$_row" | cut -d'|' -f1)
    _rs=$(echo "$_row" | cut -d'|' -f2)
    _oom=$(echo "$_row" | cut -d'|' -f3)
    _ex=$(echo "$_row" | cut -d'|' -f4)
    _err=$(echo "$_row" | cut -d'|' -f5)
    _hl=$(docker inspect --format '{{.State.Health.Status}}' "$_c" 2>/dev/null) || _hl=""
    [ -n "$_hl" ] || _hl="-"
    _err=$(printf '%s' "$_err" | tr -d '"\\' | cut -c1-120)
    [ -n "$_cjson" ] && _cjson="$_cjson,"
    _cjson="$_cjson{\"name\":\"$_c\",\"status\":\"$_st_c\",\"health\":\"$_hl\",\"restarts\":$_rs,\"oom\":$([ "$_oom" = "true" ] && echo true || echo false),\"exit\":$_ex,\"error\":\"$_err\"}"
  done

  # ¿escucha alguien en 80/443? es la firma de un 521
  _l80=no; _l443=no
  _listen=$(ss -ltn 2>/dev/null)
  echo "$_listen" | grep -qE ':80 ' && _l80=yes
  echo "$_listen" | grep -qE ':443 ' && _l443=yes

  _lastheal=$(readf "$LAST_HEAL"); _lastheal=${_lastheal:-0}
  _now=$(date -u +%s)
  _age=0; [ "$_lastheal" -gt 0 ] 2>/dev/null && _age=$(( _now - _lastheal ))

  # Telegram configurado: se informa sí/no, nunca se expone el token.
  _tg=no
  if [ -f "$ENV_FILE" ]; then
    _tok=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENV_FILE" | head -n 1 | tr -d '"'"'"' \r')
    _cid=$(sed -n 's/^TELEGRAM_CHAT_ID=//p' "$ENV_FILE" | head -n 1 | tr -d '"'"'"' \r')
    [ -n "$_tok" ] && [ -n "$_cid" ] && _tg=yes
  fi

  # fails SIEMPRE numérico: si el archivo no existe, un vacío rompería el JSON
  # (el panel le hace JSON.parse). Igual el http del caído: "000" no es un
  # número JSON válido (cero a la izquierda), se normaliza a entero.
  # POSIX puro: dash (Ubuntu /bin/sh) no soporta la base-N del bash (10#N),
  # así que los ceros a la izquierda se recortan con sed.
  _fails_n=$(readf "$FAIL_FILE" | tr -dc '0-9' | sed 's/^0*//')
  [ -n "$_fails_n" ] || _fails_n=0
  _http_n=$(echo "$_http" | tr -dc '0-9' | sed 's/^0*//')
  [ -n "$_http_n" ] || _http_n=0
  cat > "$_st" <<EOF
{
  "ts": "$(ts)",
  "ts_unix": $_now,
  "http": $_http_n,
  "up": $([ "$_up" = "1" ] && echo true || echo false),
  "fails": $_fails_n,
  "disk_pct": $(disk_pct),
  "mem_used_mb": $_mem_used,
  "mem_total_mb": $_mem_tot,
  "swap_used_mb": $_swp_used,
  "swap_total_mb": $_swp_tot,
  "load": "$(echo "$_load" | tr -d '"')",
  "uptime_sec": $_upt,
  "listening_80": $([ "$_l80" = "yes" ] && echo true || echo false),
  "listening_443": $([ "$_l443" = "yes" ] && echo true || echo false),
  "last_heal_unix": $_lastheal,
  "last_heal_ago_sec": $_age,
  "heal_cooldown_sec": $HEAL_COOLDOWN,
  "disk_heal_max_pct": $DISK_HEAL_MAX_PCT,
  "max_fails": $MAX_FAILS,
  "telegram_configured": $([ "$_tg" = "yes" ] && echo true || echo false),
  "containers": [$_cjson]
}
EOF
  mv -f "$_st" "$STATUS_FILE"
}

# --- main ----------------------------------------------------------------------
if [ "$STATUS_ONLY" = "1" ]; then
  echo "http=$(probe_code) fails=$(readf "$FAIL_FILE" | sed 's/^$/0/') disco=$(disk_pct)%"
  container_lines
  exit 0
fi

_code=$(probe_code)
if [ "$_code" = "200" ]; then
  _prev=$(readf "$FAIL_FILE")
  if [ -n "$_prev" ] && [ "$_prev" != "0" ]; then
    log "recuperado tras $_prev fallo(s) seguidos (http=200)"
    printf '🟢 PORTAL 659 RECUPERADO — %s\n\nEstuvo caído %s chequeo(s) seguidos.\nhttps://www.portal659.com.ar\n' \
      "$(ts)" "$_prev" > "$MONITOR_DIR/alert.txt"
    alert "$(cat "$MONITOR_DIR/alert.txt")"
  fi
  writef "$FAIL_FILE" 0
  write_status "$_code" 1
  exit 0
fi

_fails=$(readf "$FAIL_FILE")
[ -n "$_fails" ] || _fails=0
_fails=$((_fails + 1))
writef "$FAIL_FILE" "$_fails"
log "check falló: http=$_code (fallos seguidos: $_fails)"

if [ "$_fails" -ge "$MAX_FAILS" ] || [ "$FORCE" = "1" ]; then
  handle_outage "$_code" "$_fails"
  _rc=$?
  # El status se escribe DESPUÉS del heal: si sanó, el panel tiene que ver el
  # 200 y el contador en 0, no el corte que ya se resolvió.
  write_status "$(probe_code)" $([ "$(probe_code)" = "200" ] && echo 1 || echo 0)
  exit $_rc
fi

# Un solo fallo: no hacemos nada todavía (un redeploy o un restart de nginx
# pueden tardar más que el intervalo del cron).
write_status "$_code" 0
exit 0
