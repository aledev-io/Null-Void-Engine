#!/bin/bash

# =======================================================
# Script de Compilación para Null-Void Sync Agent
# =======================================================

echo "Iniciando proceso de compilación del Agente de Sincronización..."
echo "-------------------------------------------------------"

# 1. Cambiar al directorio del agente (por si se ejecuta desde fuera)
cd "$(dirname "$0")" || exit 1

# 2. Comprobar/Crear entorno virtual
if [ ! -d "venv" ]; then
    echo "Creando entorno virtual (venv)..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo " Error al crear el entorno virtual. Asegúrate de tener python3-venv instalado."
        exit 1
    fi
fi

# 3. Activar entorno virtual
echo "Activando entorno virtual..."
. venv/bin/activate

# 4. Instalar dependencias necesarias
echo "Verificando e instalando dependencias (PyInstaller, Requests, Watchdog)..."
pip install --upgrade pip > /dev/null 2>&1
pip install pyinstaller requests watchdog urllib3 pywebview > /dev/null 2>&1

# 5. Ejecutar el script de construcción inteligente
echo "Ejecutando el compilador (build_agent.py)..."
python3 build_agent.py

# 6. Desactivar entorno
deactivate

echo "-------------------------------------------------------"
echo "Proceso completado. Si todo ha ido bien, tu binario 'nv-agent' está en la carpeta 'client_agent/dist/'"
