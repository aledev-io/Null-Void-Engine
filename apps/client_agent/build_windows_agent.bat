@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo =============================================================
echo   Build Windows - Agente Null-Void (Null-Void-Agent.exe)
echo =============================================================
echo.

rem =============================================================
rem 1) VERIFICACION DE SEGURIDAD: cero datos de servidor
rem =============================================================
if defined AGENT_BOOTSTRAP_SERVERS (
    echo [ERROR] AGENT_BOOTSTRAP_SERVERS esta definido en el entorno
    echo         y se incrustaria en el binario.
    echo.
    echo         Quitalo con:  set AGENT_BOOTSTRAP_SERVERS=
    echo         o cierra esta consola y abrela de nuevo, y repite.
    goto :err
)

if exist ".env" (
    findstr /i "AGENT_BOOTSTRAP_SERVERS" ".env" >nul 2>&1
    if not errorlevel 1 (
        echo [ERROR] Se encontro AGENT_BOOTSTRAP_SERVERS en .env
        echo         Quita esa linea o renombra el archivo.
        goto :err
    )
)
if exist "..\.env" (
    findstr /i "AGENT_BOOTSTRAP_SERVERS" "..\.env" >nul 2>&1
    if not errorlevel 1 (
        echo [ERROR] Se encontro AGENT_BOOTSTRAP_SERVERS en ..\.env
        echo         Quita esa linea o renombra el archivo.
        goto :err
    )
)
if exist "..\..\.env" (
    findstr /i "AGENT_BOOTSTRAP_SERVERS" "..\..\.env" >nul 2>&1
    if not errorlevel 1 (
        echo [ERROR] Se encontro AGENT_BOOTSTRAP_SERVERS en ..\..\.env
        echo         Quita esa linea o renombra el archivo.
        goto :err
    )
)
echo [OK] Seguridad: sin AGENT_BOOTSTRAP_SERVERS.
echo      El binario NO llevara datos de servidor; pedira la URL al primer arranque.
echo.

rem =============================================================
rem 2) DETECCION DE PYTHON 3.10+
rem =============================================================
set "PYTHON_CMD="
py -3.11 --version >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3.11"
if not defined PYTHON_CMD (
    py -3.10 --version >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=py -3.10"
)
if not defined PYTHON_CMD (
    python --version >nul 2>&1
    if not errorlevel 1 (
        python -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" >nul 2>&1
        if not errorlevel 1 set "PYTHON_CMD=python"
    )
)

if not defined PYTHON_CMD (
    echo [ERROR] No se encontro Python 3.10 o superior.
    echo.
    echo         Instalalo desde python.org (marca "Add to PATH")
    echo         o con:   winget install Python.Python.3.11
    goto :err
)

for /f "usebackq delims=" %%v in (`%PYTHON_CMD% --version 2^>^&1`) do set "PYVER=%%v"
echo [OK] Python: %PYVER%
echo.

rem =============================================================
rem 3) ENTORNO VIRTUAL
rem =============================================================
if not exist "venv\Scripts\python.exe" (
    echo Creando entorno virtual...
    %PYTHON_CMD% -m venv venv
    if errorlevel 1 (
        echo [ERROR] Fallo al crear el venv.
        goto :err
    )
)
echo [OK] venv listo.

rem =============================================================
rem 4) DEPENDENCIAS (solo desde PyPI; la 1a vez tarda varios minutos)
rem =============================================================
echo Instalando dependencias (pyinstaller, PySide6, watchdog...)
venv\Scripts\python.exe -m pip install --upgrade pip >nul 2>&1
venv\Scripts\python.exe -m pip install --disable-pip-version-check "pyinstaller>=6,<7" requests watchdog urllib3 PySide6 pywebview
if errorlevel 1 (
    echo [ERROR] No se pudieron instalar las dependencias.
    echo         Revisa la conexion a Internet.
    goto :err
)
echo [OK] Dependencias instaladas.
echo.

rem =============================================================
rem 5) COMPILACION (PyInstaller -> Null-Void-Agent.exe)
rem =============================================================
echo Compilando el Agente Null-Void (puede tardar unos minutos)...
venv\Scripts\python.exe build_agent.py
if errorlevel 1 goto :err

rem =============================================================
rem 6) VERIFICACION Y RESUMEN
rem =============================================================
if not exist "dist\Null-Void-Agent.exe" (
    echo [ERROR] No se genero dist\Null-Void-Agent.exe
    goto :err
)

for %%A in ("dist\Null-Void-Agent.exe") do set "SIZE=%%~zA"
set "SHA="
for /f "skip=1 tokens=1" %%h in ('certutil -hashfile "dist\Null-Void-Agent.exe" SHA256') do (
    if not defined SHA set "SHA=%%h"
)

echo.
echo =============================================================
echo   Build completado con exito.
echo   Archivo:  %~dp0dist\Null-Void-Agent.exe
echo   Tamano:   %SIZE% bytes
echo   SHA256:   %SHA%
echo =============================================================
echo.
echo   El binario NO contiene datos de servidor:
echo   la primera vez que lo ejecutes te pedira la URL de tu servidor.
echo.

pause
exit /b 0

:err
echo.
echo [ERROR] Build fallido.
pause
exit /b 1