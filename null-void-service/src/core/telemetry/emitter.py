import time
import sys
import psutil
import gevent
from gevent.event import Event
from gevent.lock import BoundedSemaphore

from .collector import (
    _read_cpu_percent,
    _read_ram_percent,
    _read_temperature,
    _read_power_info,
    _read_network_io,
)

MAX_POINTS = 20


class TelemetryEmitter:
    def __init__(self, socketio, interval: float = 1.0):
        self._socketio = socketio
        self._interval = interval
        self._lock = BoundedSemaphore(1)
        self._stop_event = Event()
        self._greenlet = None

        self._tick = 0
        self._hist_cpu: list[float] = []
        self._hist_ram: list[float] = []
        self._hist_temp: list[float] = []
        self._last_cpu = 0.0
        self._last_power = "🔌 Red | Límite CPU: 100%"

    def start(self):
        if self._greenlet is not None:
            return
        self._stop_event.clear()
        try:
            psutil.cpu_percent(interval=None)
        except Exception as e:
            sys.stderr.write(f"[TELEMETRY][WARN] psutil init failed: {e}\n")
        self._greenlet = gevent.spawn(self._sampler_loop)

    def stop(self):
        self._stop_event.set()
        g = self._greenlet
        if g is not None:
            g.join(timeout=3.0)
            self._greenlet = None

    def _sampler_loop(self):
        while not self._stop_event.is_set():
            try:
                cpu = psutil.cpu_percent(interval=0.5)
            except Exception as e:
                sys.stderr.write(f"[TELEMETRY][ERROR] CPU sampler failed: {e}\n")
                gevent.sleep(2)
                continue

            ran_ok = self._lock.acquire()
            try:
                self._last_cpu = cpu
            finally:
                if ran_ok:
                    self._lock.release()

            if self._stop_event.is_set():
                break

            try:
                snap = {
                    "cpu": cpu,
                    "ram": _read_ram_percent(),
                    "temp": _read_temperature(),
                    "power": self._last_power,
                    "network": _read_network_io(),
                }
            except Exception as e:
                sys.stderr.write(f"[TELEMETRY][ERROR] Snapshot build failed: {e}\n")
                snap = {
                    "cpu": cpu,
                    "ram": 0.0,
                    "temp": 0.0,
                    "power": "🔌 Servidor conectado",
                    "network": {"bytes_sent": 0, "bytes_recv": 0},
                }

            ran_ok = self._lock.acquire()
            try:
                self._tick += 1
                if self._tick > 1000000:
                    self._tick = 1
                if self._tick % 10 == 1:
                    self._last_power = _read_power_info()
                snap["power"] = self._last_power
                self._hist_cpu.append(cpu)
                self._hist_ram.append(snap["ram"])
                self._hist_temp.append(snap["temp"])
                if len(self._hist_cpu) > MAX_POINTS:
                    self._hist_cpu.pop(0)
                    self._hist_ram.pop(0)
                    self._hist_temp.pop(0)
                snap["hist"] = {
                    "ticks": list(range(max(0, self._tick - MAX_POINTS), self._tick)),
                    "cpu": list(self._hist_cpu),
                    "ram": list(self._hist_ram),
                    "temp": list(self._hist_temp),
                }
                snapshot = dict(snap)
            finally:
                if ran_ok:
                    self._lock.release()

            try:
                self._socketio.emit("telemetry_update", snapshot)
            except Exception as e:
                sys.stderr.write(f"[TELEMETRY][ERROR] SocketIO emit failed: {e}\n")

    def get_snapshot(self) -> dict:
        ran_ok = self._lock.acquire()
        try:
            return {
                "cpu": self._last_cpu,
                "ram": _read_ram_percent(),
                "temp": _read_temperature(),
                "power": self._last_power,
                "network": _read_network_io(),
                "hist": {
                    "ticks": list(range(max(0, self._tick - MAX_POINTS), self._tick)),
                    "cpu": list(self._hist_cpu),
                    "ram": list(self._hist_ram),
                    "temp": list(self._hist_temp),
                },
            }
        finally:
            if ran_ok:
                self._lock.release()


_emitter_instance = None


def init_emitter(socketio, interval: float = 1.0) -> TelemetryEmitter:
    global _emitter_instance
    if _emitter_instance is None:
        _emitter_instance = TelemetryEmitter(socketio, interval)
        _emitter_instance.start()
    return _emitter_instance


def get_emitter() -> TelemetryEmitter | None:
    return _emitter_instance
