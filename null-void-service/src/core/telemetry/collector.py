import os
import sys
import psutil
import socket
import time


def _detect_docker() -> bool:
    try:
        if os.path.exists("/.dockerenv"):
            return True
        cgroup_path = "/proc/1/cgroup"
        if os.path.exists(cgroup_path):
            with open(cgroup_path, "r") as f:
                return "docker" in f.read()
    except Exception:
        pass
    return False


_DOCKER_ENV = _detect_docker()


def _read_cpu_percent() -> float:
    try:
        return round(psutil.cpu_percent(interval=None), 1)
    except Exception as e:
        sys.stderr.write(f"[TELEMETRY][WARN] CPU read failed: {e}\n")
        return 0.0


def _read_ram_percent() -> float:
    try:
        return round(psutil.virtual_memory().percent, 1)
    except Exception as e:
        sys.stderr.write(f"[TELEMETRY][WARN] RAM read failed: {e}\n")
        return 0.0

def _read_process_ram_mb() -> float:
    try:
        p = psutil.Process(os.getpid())
        return round(p.memory_info().rss / (1024 * 1024), 1)
    except Exception:
        return 0.0


def _read_temperature() -> float:
    try:

        max_temp = 0.0

        if _DOCKER_ENV:
            try:
                hwmon_root = "/host_sys/class/hwmon" if os.path.isdir("/host_sys/class/hwmon") else "/sys/class/hwmon"
                if os.path.isdir(hwmon_root):
                    for entry in sorted(os.listdir(hwmon_root)):
                        entry_path = os.path.join(hwmon_root, entry)
                        if not os.path.isdir(entry_path): continue
                        for file in os.listdir(entry_path):
                            if file.endswith("_label"):
                                prefix = file.split("_")[0]
                                label_path = os.path.join(entry_path, file)
                                temp_path = os.path.join(entry_path, f"{prefix}_input")
                                if os.path.exists(temp_path):
                                    with open(label_path) as f:
                                        label = f.read().strip()
                                    if any(kw in label.lower() for kw in ("cpu", "core", "package", "tctl", "tdie", "composite")):
                                        with open(temp_path) as f:
                                            try:
                                                t = round(int(f.read().strip()) / 1000.0, 1)
                                                if t > max_temp:
                                                    max_temp = t
                                            except ValueError:
                                                pass
                
                if max_temp > 0.0:
                    return max_temp
                
                # Fallback to thermal_zone0
                thermal_temp_path = "/sys/class/thermal/thermal_zone0/temp"
                if os.path.exists(thermal_temp_path):
                    with open(thermal_temp_path) as f:
                        return round(int(f.read().strip()) / 1000.0, 1)
            except Exception:
                pass
            return 0.0

        temps = psutil.sensors_temperatures()
        if temps:
            for key in ["coretemp", "cpu_thermal", "acpitz", "k10temp", "zenatpx"]:
                if key in temps and temps[key]:
                    for sensor in temps[key]:
                        if sensor.current > max_temp:
                            max_temp = round(sensor.current, 1)
            if max_temp > 0.0:
                return max_temp
        
        # Native fallback to thermal_zone0
        thermal_temp_path = "/sys/class/thermal/thermal_zone0/temp"
        if os.path.exists(thermal_temp_path):
            with open(thermal_temp_path) as f:
                return round(int(f.read().strip()) / 1000.0, 1)
    except Exception as e:
        sys.stderr.write(f"[TELEMETRY][ERROR] Temperature sensor read failed: {e}\n")
    return 0.0


def _read_power_info() -> str:
    try:
        bat = psutil.sensors_battery()
        is_plugged = True if (not bat or bat.power_plugged) else False
        status = "Red" if is_plugged else "Bat"
        if bat and not is_plugged:
            status = f"{status} ({bat.percent}%)"

        pstate = "/sys/devices/system/cpu/intel_pstate/max_perf_pct"
        if os.path.exists(pstate):
            try:
                with open(pstate) as f:
                    return f"{status} | Límite CPU: {f.read().strip()}%"
            except Exception:
                pass

        return f"{status} | Límite CPU: 100%"

    except Exception as e:
        sys.stderr.write(f"[TELEMETRY][ERROR] Power info read failed: {e}\n")
        return "Servidor conectado"


def _read_network_io() -> dict:
    try:
        net = psutil.net_io_counters()
        return {
            "bytes_sent": net.bytes_sent,
            "bytes_recv": net.bytes_recv,
        }
    except Exception as e:
        sys.stderr.write(f"[TELEMETRY][WARN] Network I/O read failed: {e}\n")
        return {"bytes_sent": 0, "bytes_recv": 0}

def _read_disk_space() -> list:
    disks = []
    
    # Defaults to OS root (/) and the Data Directory (/app/data)
    env_disks = os.getenv("MONITOR_DISKS", "/, /app/data")
    target_mounts = [d.strip() for d in env_disks.split(",") if d.strip()]
    
    for mp in target_mounts:
        # Avoid checking if path does not exist
        if not os.path.exists(mp):
            continue
            
        try:
            usage = psutil.disk_usage(mp)
            device_name = "Sistema (OS)" if mp == "/" else "Almacén (Data)" if mp == "/app/data" else mp
            
            disks.append({
                "device": device_name,
                "mountpoint": mp,
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": usage.percent
            })
        except Exception:
            continue
            
    # Fallback to standard root if somehow it is totally empty
    if not disks:
        try:
            disk = psutil.disk_usage('/')
            disks.append({
                "device": "Sistema (OS)",
                "mountpoint": "/",
                "total": disk.total,
                "used": disk.used,
                "free": disk.free,
                "percent": disk.percent
            })
        except Exception:
            disks.append({"device": "Sistema (OS)", "mountpoint": "/", "total": 0, "used": 0, "free": 0, "percent": 0.0})
            
    return disks

def _read_latency() -> float:
    try:
        start = time.perf_counter()
        with socket.create_connection(("1.1.1.1", 53), timeout=1.0):
            pass
        return round((time.perf_counter() - start) * 1000, 1)
    except Exception as e1:
        try:
            start = time.perf_counter()
            with socket.create_connection(("8.8.8.8", 53), timeout=1.0):
                pass
            return round((time.perf_counter() - start) * 1000, 1)
        except Exception as e2:
            try:
                start = time.perf_counter()
                with socket.create_connection(("8.8.8.8", 443), timeout=1.0):
                    pass
                return round((time.perf_counter() - start) * 1000, 1)
            except Exception as e3:
                return 0.0

_total_requests = 0
_last_req_time = time.time()
_last_total_req = 0
_current_rps = 0.0

def record_request():
    global _total_requests
    _total_requests += 1

def _read_rps() -> float:
    global _last_req_time, _last_total_req, _current_rps
    now = time.time()
    elapsed = now - _last_req_time
    if elapsed >= 1.0:
        _current_rps = round((_total_requests - _last_total_req) / elapsed, 1)
        _last_req_time = now
        _last_total_req = _total_requests
    return _current_rps


def get_snapshot() -> dict:
    return {
        "cpu": _read_cpu_percent(),
        "ram": _read_ram_percent(),
        "temp": _read_temperature(),
        "power": _read_power_info(),
        "network": _read_network_io(),
        "disk": _read_disk_space(),
        "latency": _read_latency(),
        "rps": _read_rps()
    }


_MAX_POINTS = 20
_hist_ticks = 0
_hist_cpu: list[float] = []
_hist_ram: list[float] = []
_hist_temp: list[float] = []
_hist_latency: list[float] = []
_hist_rps: list[float] = []


def get_snapshot_with_hist() -> dict:
    global _hist_ticks
    _hist_ticks += 1
    if _hist_ticks > 1000000:
        _hist_ticks = 1

    cpu = _read_cpu_percent()
    ram = _read_ram_percent()
    temp = _read_temperature()
    disk = _read_disk_space()
    latency = _read_latency()
    rps = _read_rps()

    _hist_cpu.append(cpu)
    _hist_ram.append(ram)
    _hist_temp.append(temp)
    _hist_latency.append(latency)
    _hist_rps.append(rps)

    if len(_hist_cpu) > _MAX_POINTS:
        _hist_cpu.pop(0)
        _hist_ram.pop(0)
        _hist_temp.pop(0)
        _hist_latency.pop(0)
        _hist_rps.pop(0)

    return {
        "cpu": cpu,
        "ram": ram,
        "temp": temp,
        "proc_ram": _read_process_ram_mb(),
        "power": _read_power_info(),
        "network": _read_network_io(),
        "disk": disk,
        "latency": latency,
        "rps": rps,
        "hist": {
            "ticks": list(range(max(0, _hist_ticks - _MAX_POINTS), _hist_ticks)),
            "cpu": list(_hist_cpu),
            "ram": list(_hist_ram),
            "temp": list(_hist_temp),
            "latency": list(_hist_latency),
            "rps": list(_hist_rps)
        },
    }
