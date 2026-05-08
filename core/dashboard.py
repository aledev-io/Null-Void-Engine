import threading
import time
import random
import psutil
import re
import subprocess

MAX_POINTS = 20
_GUID_MAX  = "bc5038f7-23e0-4960-96da-33abaf5935ec"

_hist_ticks: list[int]   = []
_hist_cpu:   list[float] = []
_hist_ram:   list[float] = []
_hist_temp:  list[float] = []
_tick          = 0
_cached_power  = "🔌 CA: --% | 🔋 CC: --%"

_last_cpu: float = psutil.cpu_percent(interval=None)
_cpu_lock = threading.Lock()


def _cpu_sampler():
    global _last_cpu
    while True:
        cpu = psutil.cpu_percent(interval=0.1)
        with _cpu_lock:
            _last_cpu = cpu
        time.sleep(0.1)


threading.Thread(target=_cpu_sampler, daemon=True).start()


import sys

def _scan_power_limits() -> str:
    if sys.platform == "win32":
        try:
            res = subprocess.check_output("powercfg /query SCHEME_CURRENT", shell=True, text=True, errors="ignore")
            partes = res.split(_GUID_MAX)
            if len(partes) > 1:
                bloque = partes[1][:400]
                pcts   = re.findall(r"(\d+)\s*%", bloque)
                if len(pcts) >= 2:
                    return f"🔌 Red: {pcts[0]}% | 🔋 Bat: {pcts[1]}%"
                hexs = re.findall(r"0x([0-9a-fA-F]+)", bloque)
                if len(hexs) >= 2:
                    return f"🔌 AC: {int(hexs[-2],16)}% | 🔋 Bat: {int(hexs[-1],16)}%"
            return "🔌 GUID no detectado"
        except Exception:
            return "🔌 Error de escaneo"
    else:
        # Linux - Usar herramientas multiplataforma y leer límite de CPU
        try:
            bat = psutil.sensors_battery()
            status = "🔌 Red" if (not bat or bat.power_plugged) else "🔋 Bat"
            
            import os
            # Intentar leer intel_pstate primero
            if os.path.exists("/sys/devices/system/cpu/intel_pstate/max_perf_pct"):
                with open("/sys/devices/system/cpu/intel_pstate/max_perf_pct", "r") as f:
                    pct = f.read().strip()
                return f"{status} | CPU Max: {pct}%"
            
            # Alternativa: cpufreq genérico
            if os.path.exists("/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq"):
                with open("/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq", "r") as f:
                    s_max = float(f.read().strip())
                with open("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq", "r") as f:
                    c_max = float(f.read().strip())
                pct = int((s_max / c_max) * 100)
                return f"{status} | CPU Max: {pct}%"
                
            return f"{status} | CPU Max: 100%"
        except Exception:
            return "🔌 Error de energía Linux"


def _get_temp() -> float:
    try:
        temps = psutil.sensors_temperatures()
        if "coretemp" in temps and temps["coretemp"]:
            return temps["coretemp"][0].current
    except Exception:
        pass
    return round(random.uniform(40.0, 55.0), 1)


def get_snapshot() -> dict:
    global _tick, _cached_power

    _tick += 1
    if _tick % 5 == 1:
        _cached_power = _scan_power_limits()

    with _cpu_lock:
        cpu = _last_cpu
    ram  = round(psutil.virtual_memory().percent, 1)
    temp = _get_temp()

    for lst, val in [
        (_hist_ticks, _tick),
        (_hist_cpu,   cpu),
        (_hist_ram,   ram),
        (_hist_temp,  temp),
    ]:
        lst.append(val)

    if len(_hist_ticks) > MAX_POINTS:
        for lst in [_hist_ticks, _hist_cpu, _hist_ram, _hist_temp]:
            lst.pop(0)

    return {
        "cpu":   cpu,
        "ram":   ram,
        "temp":  temp,
        "power": _cached_power,
        "hist": {
            "ticks": list(_hist_ticks),
            "cpu":   list(_hist_cpu),
            "ram":   list(_hist_ram),
            "temp":  list(_hist_temp),
        }
    }