import threading
import time
from collections import deque
from core.telemetry import get_snapshot_with_hist

POLL_INTERVAL = 1.0
MAX_HISTORY = 3600

_live_cache = {}
_history = deque(maxlen=MAX_HISTORY)
_lock = threading.Lock()
_running = False


def _poll_loop():
    global _running
    while _running:
        try:
            snap = get_snapshot_with_hist()
            ts = time.time()
            with _lock:
                _live_cache.clear()
                _live_cache.update(snap)
                _history.append({
                    "ts": ts,
                    "cpu": snap.get("cpu", 0),
                    "ram": snap.get("ram", 0),
                    "temp": snap.get("temp", 0),
                })
        except Exception:
            pass
        time.sleep(POLL_INTERVAL)


def start():
    global _running
    if _running:
        return
    _running = True
    t = threading.Thread(target=_poll_loop, daemon=True)
    t.start()


start()


def get_live():
    with _lock:
        if not _live_cache:
            return get_snapshot_with_hist()
        return dict(_live_cache)


def get_history(minutes=5):
    cutoff = time.time() - minutes * 60
    with _lock:
        return [p for p in _history if p["ts"] >= cutoff]
