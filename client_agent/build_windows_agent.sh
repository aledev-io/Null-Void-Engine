#!/usr/bin/env bash
# =====================================================================
# build_windows_agent.sh — Compilación AUTOMÁTICA del Agente Null-Void
# ---------------------------------------------------------------------
# Ejecutar en Git Bash (Windows) para obtener Null-Void-Agent.exe.
# También compatible con Linux/macOS (genera el binario nativo).
#
# AUTOMÁTICO: crea el venv, instala dependencias y compila sin preguntar.
# SEGURO: no envía ni incrusta ningún dato del servidor:
#   - No sube nada a ningún sitio (solo descarga de PyPI para pip).
#   - Si detecta AGENT_BOOTSTRAP_SERVERS en el entorno o en algún .env
#     del proyecto, ABORTA: el requisito es compilar sin configuración.
#   - El binario resultante pregunta la URL del servidor al primer arranque.
#
# Uso:
#   bash build_windows_agent.sh
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------
# 1. Detección de plataforma
# ---------------------------------------------------------------------
UNAME="$(uname -s)"
case "$UNAME" in
    MINGW*|MSYS*|CYGWIN*)  PLATFORM="windows" ;;
    Darwin)                PLATFORM="macos"   ;;
    Linux)                 PLATFORM="linux"   ;;
    *) die "Plataforma no soportada: $UNAME" ;;
esac

if [ "$PLATFORM" = "linux" ] && grep -qi "microsoft" /proc/version 2>/dev/null; then
    die "Estás en WSL: aquí solo se compilan binarios de Linux. Para obtener Null-Void-Agent.exe usa Git Bash de Windows (o PowerShell con bash) desde el propio Windows."
fi

case "$PLATFORM" in
    windows) ARTIFACT="dist/Null-Void-Agent.exe" ;;
    macos)   ARTIFACT="dist/Null-Void-Agent-Mac" ;;
    *)       ARTIFACT="dist/Null-Void-Agent-Linux" ;;
esac

log "Plataforma detectada: $PLATFORM"
log "Artefacto objetivo:  $ARTIFACT"

# ---------------------------------------------------------------------
# 2. VERIFICACIÓN DE SEGURIDAD: cero configuración de servidor
# ---------------------------------------------------------------------
if [ -n "${AGENT_BOOTSTRAP_SERVERS:-}" ]; then
    die "AGENT_BOOTSTRAP_SERVERS está definido en el entorno y se incrustaría en el binario. Desactívalo (unset AGENT_BOOTSTRAP_SERVERS) y repite: el build debe salir sin datos de servidor."
fi

for env_path in "$SCRIPT_DIR/.env" "$SCRIPT_DIR/../.env" "$SCRIPT_DIR/../../.env"; do
    if [ -f "$env_path" ] && grep -q "^[[:space:]]*AGENT_BOOTSTRAP_SERVERS=" "$env_path" 2>/dev/null; then
        die "Se encontró AGENT_BOOTSTRAP_SERVERS en $env_path. Quita esa línea (o renombra el .env) y repite: el build debe salir sin datos de servidor."
    fi
done
log "Seguridad OK: sin AGENT_BOOTSTRAP_SERVERS. El binario no llevará datos de servidor."

# ---------------------------------------------------------------------
# 3. Detección de Python (3.10+) — Windows puede usar el launcher 'py'
# ---------------------------------------------------------------------
check_python() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then return 1; fi
    if [ "$cmd" = "py" ]; then
        if "$cmd" -3.11 --version >/dev/null 2>&1; then
            PY_REF=("py" "-3.11"); return 0
        fi
        if "$cmd" -3.10 --version >/dev/null 2>&1; then
            PY_REF=("py" "-3.10"); return 0
        fi
        return 1
    fi
    if "$cmd" --version >/dev/null 2>&1 \
       && "$cmd" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
        PY_REF=("$cmd"); return 0
    fi
    return 1
}

PY_REF=()
for cand in py python3 python; do
    if check_python "$cand"; then break; fi
done

if [ -z "${PY_REF[*]:-}" ]; then
    die "No se encontró Python 3.10+. En Windows instálalo desde python.org (marca 'Add to PATH') o con: winget install Python.Python.3.11"
fi
log "Python: $("${PY_REF[@]}" --version 2>&1)"

# ---------------------------------------------------------------------
# 4. Entorno virtual (venv)
# ---------------------------------------------------------------------
VENV_DIR="$SCRIPT_DIR/venv"
if [ ! -d "$VENV_DIR" ]; then
    log "Creando entorno virtual..."
    "${PY_REF[@]}" -m venv "$VENV_DIR"
fi

# En Windows la orquesta vive en Scripts/; en Unix en bin/
if [ -x "$VENV_DIR/Scripts/python.exe" ]; then
    VENV_PY="$VENV_DIR/Scripts/python.exe"
elif [ -x "$VENV_DIR/bin/python" ]; then
    VENV_PY="$VENV_DIR/bin/python"
else
    die "No se encuentra el python del venv en $VENV_DIR"
fi

"$VENV_PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
    || die "El venv no usa Python 3.10+. Bórralo (rm -rf venv) y repite el script."

# ---------------------------------------------------------------------
# 5. Dependencias (solo descarga desde PyPI; primera vez tarda varios
#    minutos por PySide6)
# ---------------------------------------------------------------------
log "Instalando dependencias (primera vez puede tardar varios minutos)..."
"$VENV_PY" -m pip install --upgrade pip >/dev/null 2>&1 || true
"$VENV_PY" -m pip install --quiet --disable-pip-version-check \
    "pyinstaller>=6,<7" requests watchdog urllib3 PySide6 pywebview \
    || die "No se pudieron instalar las dependencias. Revisa la conexión a Internet."

# ---------------------------------------------------------------------
# 6. Compilación (build_agent.py propaga su propio código de salida)
# ---------------------------------------------------------------------
log "Compilando el Agente Null-Void ($PLATFORM)..."
"$VENV_PY" build_agent.py

# ---------------------------------------------------------------------
# 7. Verificación y resumen
# ---------------------------------------------------------------------
[ -f "$ARTIFACT" ] || die "El build reportó éxito pero no se encontró la artefacto: $ARTIFACT"
chmod +x "$ARTIFACT" 2>/dev/null || true

SIZE="$(du -h "$ARTIFACT" | cut -f1)"
if command -v sha256sum >/dev/null 2>&1; then
    HASH="$(sha256sum "$ARTIFACT" | cut -d' ' -f1)"
elif command -v certutil >/dev/null 2>&1; then
    HASH="$(certutil -hashfile "$(cygpath -w "$ARTIFACT")" SHA256 | sed -n '2p' | tr -d ' ')"
else
    HASH="(no disponible)"
fi

log "============================================================="
log "Build completado con éxito."
log "Artefacto: $SCRIPT_DIR/$ARTIFACT ($SIZE)"
log "SHA256:   $HASH"
log "============================================================="
log "El binario NO contiene datos de servidor: pide la URL al primer arranque."
log "Integridad en Windows:  certutil -hashfile \"$ARTIFACT\" SHA256"