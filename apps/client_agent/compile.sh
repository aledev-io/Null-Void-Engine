#!/bin/bash
# =====================================================================
# Compilación LOCAL del Agente de Escritorio Null-Void Cloud (PySide6/Qt)
# Genera el ejecutable nativo en client_agent/dist/:
#   Linux:  Null-Void-Agent-Linux
#   macOS:  Null-Void-Agent-Mac
#   Windows: Null-Void-Agent.exe
#
# Build bajo demanda: NO forma parte del arranque de Docker.
# Requiere Python 3.10+ y conexión a Internet (solo la primera vez).
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

log "Iniciando build del Agente de escritorio Null-Void Cloud..."

# 1. Entorno virtual --------------------------------------------------------
if [ ! -d "venv" ]; then
    log "Creando entorno virtual (venv)..."
    python3 -m venv venv
fi
# shellcheck disable=SC1091
source venv/bin/activate
PYREF="$SCRIPT_DIR/venv/bin/python"

# 2. Versión de Python ------------------------------------------------------
if ! "$PYREF" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
    die "Se requiere Python 3.10+ (versión actual: $("$PYREF" --version 2>&1 | cut -d' ' -f2))"
fi

# 3. Dependencias (idempotente; PyInstaller acotado a la serie 6) -----------
# El upgrade de pip es tolerante a fallos: sin red, se continúa con el pip existente.
"$PYREF" -m pip install --upgrade pip >/dev/null 2>&1 || true
if ! "$PYREF" -m pip install --quiet --disable-pip-version-check \
        "pyinstaller>=6,<7" requests watchdog urllib3 PySide6 pywebview; then
    die "No se pudieron instalar las dependencias. Revisa tu conexión a Internet."
fi

# 4. Build y empaquetado (propaga el código de salida real de build_agent.py) --
"$PYREF" build_agent.py

# 5. Verificación del artefacto ---------------------------------------------
case "$(uname -s)" in
    Darwin)      ARTIFACT="dist/Null-Void-Agent-Mac" ;;
    MINGW*|MSYS*|CYGWIN*) ARTIFACT="dist/Null-Void-Agent.exe" ;;
    *)           ARTIFACT="dist/Null-Void-Agent-Linux" ;;
esac

[ -f "$ARTIFACT" ] || die "El build reportó éxito pero no se encontró el artefacto: $ARTIFACT"
chmod +x "$ARTIFACT" 2>/dev/null || true
SIZE="$(du -h "$ARTIFACT" | cut -f1)"

log "============================================================="
log "Build completado con éxito."
log "Artefacto: client_agent/$ARTIFACT ($SIZE)"
log "============================================================="
