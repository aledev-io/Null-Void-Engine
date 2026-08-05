import glob
import json
import os
import threading
import time
from datetime import datetime

from config.config import CONFIG


class BackupScheduler:
    def __init__(self):
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._last_run = {}

    def start(self):
        with self._lock:
            if hasattr(self, 'thread') and self.thread.is_alive() and not self._stop_event.is_set():
                return
            self._stop_event.clear()
            self.thread = threading.Thread(target=self._loop, daemon=True, name="BackupScheduler")
            self.thread.start()
            print("[BackupScheduler] Planificador de respaldos automáticos iniciado.")

    def stop(self):
        self._stop_event.set()
        print("[BackupScheduler] Planificador de respaldos detenido.")

    def _loop(self):
        if self._stop_event.wait(5):
            return
        while not self._stop_event.is_set():
            try:
                self._check_backups()
            except Exception as e:
                print(f"[BackupScheduler] Error en el bucle: {e}")
            if self._stop_event.wait(60):
                break

    def _check_backups(self):
        pattern = os.path.join(CONFIG.DATA_DIR, "Cloud", "*", ".backups", "automation.json")
        for cfg_path in glob.glob(pattern):
            try:
                parts = cfg_path.replace("\\", "/").split("/")
                idx = parts.index("Cloud") + 1
                user_id = parts[idx]
            except (ValueError, IndexError):
                continue

            try:
                with open(cfg_path, encoding="utf-8") as f:
                    cfg = json.load(f)
            except Exception:
                continue

            if not cfg.get("enabled"):
                continue
            source_paths = cfg.get("source_paths") or []
            if not source_paths:
                continue

            if not self._should_run(user_id, cfg):
                continue

            print(f"[BackupScheduler] Ejecutando respaldo automático para {user_id}...")
            try:
                from core.backup import run_automated_backup
                result = run_automated_backup(user_id, cfg)
                if result.get("type") == "done":
                    print(f"[BackupScheduler] ✓ Backup exitoso para {user_id}: {result.get('zip_name', '?')} ({result.get('count', 0)} archivos)")
                elif result.get("skipped"):
                    print(f"[BackupScheduler] - Backup omitido para {user_id}: {result.get('reason')}")
                else:
                    print(f"[BackupScheduler] ✗ Error en backup para {user_id}: {result.get('message', 'desconocido')}")
            except Exception as e:
                print(f"[BackupScheduler] Error ejecutando backup para {user_id}: {e}")

    def _should_run(self, user_id, cfg):
        now = datetime.now()
        today_weekday = now.weekday()  # 0=Mon, 6=Sun -> convert: 0=Mon..6=Sun → JS days: 0=Sun,1=Mon..6=Sat. Map now.weekday()+1 mod7.
        js_day = (today_weekday + 1) % 7  # map Python weekday to JS day (0=Sun,1=Mon,...,6=Sat)
        frequency = cfg.get("frequency", "daily")
        days = cfg.get("days", [])

        if frequency == "weekly":
            if not days or js_day not in days:
                return False
        elif frequency == "monthly":
            if now.day != 1:
                return False

        time_str = cfg.get("time", "02:00").strip().zfill(5)
        try:
            h, m = int(time_str[:2]), int(time_str[3:5])
        except (ValueError, IndexError):
            h, m = 2, 0

        target = now.replace(hour=h, minute=m, second=0, microsecond=0)

        if now < target:
            return False

        key = user_id
        last = self._last_run.get(key)
        if last is not None:
            if last >= target.timestamp() - 60:
                return False

        self._last_run[key] = now.timestamp()
        return True


backup_scheduler = BackupScheduler()
