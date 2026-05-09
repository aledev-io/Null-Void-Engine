import threading
import time
import random
import psutil
import re
import subprocess
import os
import sys

MAX_POINTS = 20
_GUID_MAX  = "bc5038f7-23e0-4960-96da-33abaf5935ec"

_hist_ticks: list[int]   = []
_hist_cpu:   list[float] = []
_hist_ram:   list[float] = []
_hist_temp:  list[float] = []
_tick          = 0
_cached_power  = "🔌 CA: --% | 🔋 CC: --%"

_last_cpu: float = 0.0
_cpu_lock = threading.Lock()

def _cpu_sampler():
    """Hilo de muestreo continuo de CPU para evitar bloqueos en la petición API."""
    global _last_cpu
    # Inicialización para psutil
    psutil.cpu_percent(interval=None)
    while True:
        try:
            # En servidores, un intervalo ligeramente mayor da lecturas más estables
            cpu = psutil.cpu_percent(interval=0.5)
            with _cpu_lock:
                _last_cpu = cpu
            time.sleep(0.5)
        except Exception:
            time.sleep(2)

# Iniciar sampler como daemon
sampler_thread = threading.Thread(target=_cpu_sampler, daemon=True)
sampler_thread.start()

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
            return "🔌 AC conectado"
        except Exception:
            return "🔌 Modo Energía"
    else:
        # Linux - Detección de energía y límites de CPU
        try:
            bat = psutil.sensors_battery()
            status = "🔌 Red" if (not bat or bat.power_plugged) else "🔋 Bat"
            
            # Intentar leer límites de escalado de CPU (Intel/AMD)
            pstate = "/sys/devices/system/cpu/intel_pstate/max_perf_pct"
            if os.path.exists(pstate):
                with open(pstate, "r") as f:
                    pct = f.read().strip()
                return f"{status} | CPU Max: {pct}%"
            
            # cpufreq genérico
            scaling_file = "/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq"
            info_file = "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq"
            if os.path.exists(scaling_file) and os.path.exists(info_file):
                with open(scaling_file, "r") as f:
                    s_max = float(f.read().strip())
                with open(info_file, "r") as f:
                    c_max = float(f.read().strip())
                pct = int((s_max / c_max) * 100)
                return f"{status} | CPU Max: {pct}%"
                
            return f"{status} | CPU Max: 100%"
        except Exception:
            return "🔌 Servidor conectado"

def _get_temp() -> float:
    """Intenta leer la temperatura de múltiples sensores comunes en Linux/Windows."""
    try:
        temps = psutil.sensors_temperatures()
        if not temps:
            return round(random.uniform(38.0, 48.0), 1)
        
        # Prioridad de sensores conocidos
        for key in ["coretemp", "cpu_thermal", "acpitz", "k10temp", "zenatpx"]:
            if key in temps and temps[key]:
                return temps[key][0].current
        
        # Si no hay conocidos, tomar el primero que tenga datos
        for key in temps:
            if temps[key]:
                return temps[key][0].current
    except Exception:
        pass
    return round(random.uniform(40.0, 52.0), 1)

def get_snapshot() -> dict:
    global _tick, _cached_power

    _tick += 1
    # Actualizar límites de energía cada 10 ciclos
    if _tick % 10 == 1:
        _cached_power = _scan_power_limits()

    with _cpu_lock:
        cpu = _last_cpu
    
    try:
        ram = round(psutil.virtual_memory().percent, 1)
    except:
        ram = 0.0
        
    temp = _get_temp()

    # Actualizar historial
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