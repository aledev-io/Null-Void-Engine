#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compila el Agente de escritorio Null-Void Cloud (PySide6/Qt) a un binario
autocontenido con PyInstaller.

Uso directo:
    python3 build_agent.py        # requiere PyInstaller instalado
    bash compile.sh               # flujo completo: venv + deps + build

Códigos de salida:
    0  éxito
    1  error de compilación o de entorno
    2  otro build ya en curso (lock activo)
"""

import fnmatch
import os
import subprocess
import sys
import time

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
AGENT_SCRIPT = os.path.join(BASE_DIR, "src", "main.py")
RELEASE_SCRIPT = os.path.join(BASE_DIR, "src", "main_release.py")
EXE_NAME = "nv-agent"
LOCK_FILE = os.path.join(BASE_DIR, ".build.lock")
DIST_DIR = os.path.join(BASE_DIR, "dist")
PYINSTALLER_BUILD_DIR = os.path.join(BASE_DIR, "build")

# Variantes de nombre por plataforma (también usadas para limpiar artefactos obsoletos)
TARGET_NAMES = {
    "win32": "Null-Void-Agent.exe",
    "darwin": "Null-Void-Agent-Mac",
    "linux": "Null-Void-Agent-Linux",
}


class BuildError(Exception):
    """Error de build con mensaje claro para el usuario."""


class BuildLockedError(BuildError):
    """Otro build ya está en curso."""


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")


def log_error(msg):
    print(f"[{time.strftime('%H:%M:%S')}] ERROR: {msg}", file=sys.stderr)


def platform_target():
    if sys.platform.startswith("win"):
        return TARGET_NAMES["win32"]
    if sys.platform.startswith("darwin"):
        return TARGET_NAMES["darwin"]
    return TARGET_NAMES["linux"]


def find_bootstrap_servers():
    """Busca AGENT_BOOTSTRAP_SERVERS en el entorno o en los .env."""
    env_servers = os.environ.get("AGENT_BOOTSTRAP_SERVERS")
    if env_servers:
        return [s.strip() for s in env_servers.split(",") if s.strip()]

    env_paths = [
        os.path.join(BASE_DIR, ".env"),
        os.path.join(BASE_DIR, "..", ".env"),
        os.path.join(BASE_DIR, "..", "..", ".env"),
    ]
    for path in env_paths:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("AGENT_BOOTSTRAP_SERVERS="):
                            val = line.split("=", 1)[1].strip().strip('"').strip("'")
                            servers = [s.strip() for s in val.split(",") if s.strip()]
                            if servers:
                                return servers
            except Exception:
                pass
    return []


def acquire_build_lock():
    """Asegura que sólo haya una compilación simultánea (evita race conditions)."""
    if sys.platform.startswith("win"):
        return None  # En Windows flock no está disponible de forma estándar; el control se confía al proceso

    import fcntl

    lock_file = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock_file.close()
        raise BuildLockedError(
            f"Ya hay un build en curso (lock {LOCK_FILE}). "
            "Si no hay ningún build activo, elimina ese archivo y reintenta."
        )
    lock_file.write(str(os.getpid()))
    lock_file.flush()
    return lock_file


def bake_release_script(servers):
    """Inyecta la lista de bootstrap servers en el código del agente."""
    agent_path = AGENT_SCRIPT
    with open(agent_path, "r", encoding="utf-8") as f:
        code = f.read()

    start_marker = "def load_bootstrap_servers():"
    end_marker = "BOOTSTRAP_SERVERS = load_bootstrap_servers()"
    if start_marker not in code or end_marker not in code:
        raise BuildError(
            f"No se encontraron los marcadores de bootstrap en {AGENT_SCRIPT}. "
            "El código del agente ha cambiado; actualiza builder.py."
        )

    baked_code = (
        code.split(start_marker)[0]
        + f"BOOTSTRAP_SERVERS = {servers}\n"
        + code.split(end_marker)[1]
    )
    release_path = RELEASE_SCRIPT
    with open(release_path, "w", encoding="utf-8") as f:
        f.write(baked_code)
    return release_path


def run_pyinstaller(servers):
    release_path = bake_release_script(servers)
    try:
        cmd = [
            sys.executable, "-m", "PyInstaller",
            "--onefile", "--noconsole", "--noconfirm", "--clean",
            f"--workpath={PYINSTALLER_BUILD_DIR}",
            f"--distpath={DIST_DIR}",
            "--hidden-import=watchdog.observers.inotify",
            "--hidden-import=watchdog.observers.polling",
            "--hidden-import=src.ui.qt_gui",
            "--hidden-import=src.api.cloud_api",
            "--hidden-import=PySide6.QtCore",
            "--hidden-import=PySide6.QtGui",
            "--hidden-import=PySide6.QtWidgets",
            "--hidden-import=PySide6.QtSvg",
            "--hidden-import=threading",
            "--name", EXE_NAME,
            release_path,
        ]
        log("Iniciando PyInstaller (binario autocontenido, GUI PySide6/Qt)...")
        subprocess.run(cmd, cwd=BASE_DIR, check=True)
    except FileNotFoundError:
        raise BuildError(
            "PyInstaller no está instalado en este entorno. "
            "Ejecuta compile.sh o `pip install 'pyinstaller>=6,<7'`."
        )
    except subprocess.CalledProcessError as e:
        raise BuildError(f"PyInstaller falló con código {e.returncode}. Revisa la traza anterior.")
    finally:
        if os.path.exists(release_path):
            try:
                os.remove(release_path)
            except OSError:
                pass


def report_missing_modules():
    """Muestra las advertencias relevantes que PyInstaller registró.

    - 'missing module named': imports opcionales/condicionales o específicos de
      otras plataformas; son informativas y no afectan al binario.
    - 'Library not found / could not resolve': dependencias de sistema que el
      binario necesita en el equipo de destino (p. ej. libxcb-cursor de Qt6).
    """
    missing = []
    libs = set()
    if os.path.isdir(PYINSTALLER_BUILD_DIR):
        for root, _dirs, files in os.walk(PYINSTALLER_BUILD_DIR):
            for name in fnmatch.filter(files, "warn-*.txt"):
                path = os.path.join(root, name)
                try:
                    with open(path, "r", encoding="utf-8", errors="replace") as f:
                        for line in f:
                            low = line.lower()
                            if "missing module named" in low:
                                missing.append(line.strip())
                            elif "library not found" in low or "could not resolve" in low:
                                lib = line.strip().split("could not resolve")[-1].strip()
                                libs.add(lib)
                except OSError:
                    continue

    for w in missing:
        log(f"Advertencia de PyInstaller: {w}")

    if libs:
        print()
        log("Aviso de dependencias del sistema (el binario las necesita en el equipo de destino):")
        for lib in sorted(libs):
            log(f"  - {lib}")
        log("En Debian/Ubuntu suelen resolverse con: sudo apt install libxcb-cursor0")


def finalize_artifact():
    """Renombra el binario al nombre final y limpia variantes obsoletas."""
    src_name = EXE_NAME + (".exe" if sys.platform.startswith("win") else "")
    target_name = platform_target()
    src_path = os.path.join(DIST_DIR, src_name)
    target_path = os.path.join(DIST_DIR, target_name)

    if not os.path.exists(src_path):
        raise BuildError(f"No se encontró el binario generado por PyInstaller: {src_path}")

    if src_name != target_name:
        os.replace(src_path, target_path)
        log(f"Artefacto final: {os.path.relpath(target_path, BASE_DIR)}")

    for variant in set(TARGET_NAMES.values()) | {src_name}:
        variant_path = os.path.join(DIST_DIR, variant)
        if variant != target_name and os.path.exists(variant_path):
            try:
                os.remove(variant_path)
            except OSError:
                pass

    size_mb = os.path.getsize(target_path) / (1024 * 1024)
    return target_path, size_mb


def main():
    if sys.version_info < (3, 10):
        log_error(
            f"Se requiere Python 3.10 o superior (actual: "
            f"{sys.version_info.major}.{sys.version_info.minor})."
        )
        return 1

    start = time.time()
    lock = None
    try:
        lock = acquire_build_lock()

        servers = find_bootstrap_servers()
        if servers:
            log(f"Servidores bootstrap detectados: {', '.join(servers)}")
        else:
            log("Sin AGENT_BOOTSTRAP_SERVERS detectable; se compilará sin auto-descubrimiento.")

        run_pyinstaller(servers)
        report_missing_modules()
        artifact_path, size_mb = finalize_artifact()

        print()
        log("=============================================")
        log("Compilación completada con éxito.")
        log(f"Artefacto: client_agent/{os.path.relpath(artifact_path, BASE_DIR)} ({size_mb:.1f} MB)")
        log(f"Tiempo total: {time.time() - start:.0f}s")
        log("=============================================")
        return 0
    except BuildLockedError as e:
        log_error(str(e))
        return 2
    except BuildError as e:
        log_error(str(e))
        return 1
    except Exception as e:
        log_error(f"Error inesperado: {e}")
        return 1
    finally:
        if lock is not None:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())