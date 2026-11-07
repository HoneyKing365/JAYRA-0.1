"""
System information: CPU, RAM, disk usage, GPU (best-effort), temperature.

All read-only. psutil powers the core metrics; GPU stats come from
nvidia-ml-py3 (pynvml) when an NVIDIA GPU is present, and degrade gracefully
otherwise. Temperature is best-effort via psutil.sensors_temperatures (Linux)
or WMI on Windows when available.
"""

from __future__ import annotations

import platform
from typing import Any, Dict

from .registry import register


def _bytes_human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if n < 1024.0:
            return f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}EB"


@register("systemInfo")
def system_info(args: Dict[str, Any]) -> Dict[str, Any]:
    import psutil

    cpu_percent = psutil.cpu_percent(interval=0.3)
    cpu_count_logical = psutil.cpu_count(logical=True)
    cpu_count_physical = psutil.cpu_count(logical=False) or cpu_count_logical

    vm = psutil.virtual_memory()
    ram_total = vm.total
    ram_used = vm.used
    ram_percent = vm.percent

    # Disk usage on the system drive (and project drive if different).
    disks: Dict[str, Dict[str, Any]] = {}
    seen = set()
    try:
        for part in psutil.disk_partitions(all=False):
            mp = part.mountpoint
            if mp in seen:
                continue
            seen.add(mp)
            try:
                du = psutil.disk_usage(mp)
                disks[mp] = {
                    "total": _bytes_human(du.total),
                    "used": _bytes_human(du.used),
                    "free": _bytes_human(du.free),
                    "percent": du.percent,
                }
            except Exception:
                continue
    except Exception:
        pass

    boot = psutil.boot_time()
    import datetime as _dt

    uptime = _dt.datetime.now() - _dt.datetime.fromtimestamp(boot)

    return {
        "result": (
            f"CPU {cpu_percent}% ({cpu_count_physical} cores / {cpu_count_logical} threads). "
            f"RAM {ram_percent}% ({_bytes_human(ram_used)}/{_bytes_human(ram_total)}). "
            f"{len(disks)} disk(s) monitored. Uptime {uptime}."
        ),
        "cpu": {"percent": cpu_percent, "physical_cores": cpu_count_physical, "logical_cores": cpu_count_logical},
        "ram": {"percent": ram_percent, "used": _bytes_human(ram_used), "total": _bytes_human(ram_total)},
        "disks": disks,
        "uptime_seconds": int(uptime.total_seconds()),
        "os": platform.platform(),
    }


def _gpu_stats() -> list:
    try:
        import pynvml  # type: ignore
        from pynvml import (  # type: ignore
            NVML_TEMPERATURE_GPU,
            NVML_CLOCK_GRAPHICS,
            NVML_CLOCK_MEM,
            nvmlInit,
            nvmlDeviceGetCount,
            nvmlDeviceGetHandleByIndex,
            nvmlDeviceGetName,
            nvmlDeviceGetUtilizationRates,
            nvmlDeviceGetMemoryInfo,
            nvmlDeviceGetTemperature,
            nvmlDeviceGetClockInfo,
        )
    except Exception:
        return []

    gpus = []
    try:
        nvmlInit()
        count = nvmlDeviceGetCount()
        for i in range(count):
            h = nvmlDeviceGetHandleByIndex(i)
            util = nvmlDeviceGetUtilizationRates(h)
            mem = nvmlDeviceGetMemoryInfo(h)
            gpus.append(
                {
                    "index": i,
                    "name": nvmlDeviceGetName(h).decode() if isinstance(nvmlDeviceGetName(h), bytes) else str(nvmlDeviceGetName(h)),
                    "gpu_utilization_percent": util.gpu,
                    "memory_utilization_percent": util.memory,
                    "memory_total": _bytes_human(mem.total),
                    "memory_used": _bytes_human(mem.used),
                    "memory_free": _bytes_human(mem.free),
                    "temperature_c": nvmlDeviceGetTemperature(h, NVML_TEMPERATURE_GPU),
                }
            )
    except Exception:
        return []
    return gpus


@register("gpuInfo")
def gpu_info(args: Dict[str, Any]) -> Dict[str, Any]:
    gpus = _gpu_stats()
    if not gpus:
        return {
            "result": (
                "No NVIDIA GPU stats available via pynvml (no NVIDIA GPU, "
                "driver missing, or nvidia-ml-py3 not installed)."
            ),
            "gpus": [],
        }
    summary = "; ".join(
        f"{g['name']}: {g['gpu_utilization_percent']}% GPU, "
        f"{g['memory_used']}/{g['memory_total']} VRAM, {g['temperature_c']}°C"
        for g in gpus
    )
    return {"result": summary, "gpus": gpus}


@register("temperatureInfo")
def temperature_info(args: Dict[str, Any]) -> Dict[str, Any]:
    # Prefer GPU temp if available (NVIDIA), then psutil sensors.
    gpus = _gpu_stats()
    temps: Dict[str, Any] = {}
    for g in gpus:
        temps[f"gpu{g['index']}"] = g["temperature_c"]

    try:
        import psutil

        sensors = psutil.sensors_temperatures() if hasattr(psutil, "sensors_temperatures") else {}
        for name, entries in (sensors or {}).items():
            for entry in entries[:1]:
                temps[name] = entry.current
    except Exception:
        pass

    # Windows CPU temps generally require admin + OpenHardwareMonitor/LibreHardwareMonitor.
    if not temps:
        return {
            "result": (
                "Temperature reading unavailable. On Windows, CPU temps need "
                "LibreHardwareMonitor or admin access; GPU temps need an NVIDIA GPU."
            ),
            "temperatures": {},
        }
    summary = ", ".join(f"{k}={v}°C" for k, v in temps.items())
    return {"result": f"Temperatures: {summary}.", "temperatures": temps}


PROTECTED_PROCESSES = frozenset({
    "csrss.exe", "lsass.exe", "smss.exe", "services.exe", "svchost.exe",
    "wininit.exe", "winlogon.exe", "explorer.exe", "dwm.exe", "spoolsv.exe",
    "electron.exe", "python.exe", "pythonw.exe",
})


@register("batteryInfo")
def battery_info(args: Dict[str, Any]) -> Dict[str, Any]:
    import psutil
    battery = psutil.sensors_battery()
    if not battery:
        return {"result": "No battery detected (desktop PC or plugged into AC without battery).", "has_battery": False}
    plugged_str = "plugged in" if battery.power_plugged else "on battery"
    remaining = f"{int(battery.secsleft / 60)} minutes" if battery.secsleft > 0 else "calculating"
    return {
        "result": f"Battery is at {battery.percent}% ({plugged_str}, ~{remaining} remaining).",
        "has_battery": True,
        "percent": battery.percent,
        "power_plugged": battery.power_plugged,
        "seconds_left": battery.secsleft,
    }


@register("networkAdapters")
def network_adapters(args: Dict[str, Any]) -> Dict[str, Any]:
    import psutil
    addrs = psutil.net_if_addrs()
    stats = psutil.net_if_stats()
    interfaces = []
    for name, addr_list in addrs.items():
        st = stats.get(name)
        ip_list = [a.address for a in addr_list if getattr(a.family, "name", "") in ("AF_INET", "AF_INET6")]
        is_up = st.isup if st else False
        if ip_list and is_up:
            interfaces.append({
                "interface": name,
                "is_up": is_up,
                "speed_mbps": st.speed if st else 0,
                "ips": ip_list,
            })
    summary = ", ".join(f"{i['interface']} ({'/'.join(i['ips'])})" for i in interfaces) or "No active network adapters."
    return {"result": f"Active network adapters: {summary}", "adapters": interfaces}


@register("runningProcesses")
def running_processes(args: Dict[str, Any]) -> Dict[str, Any]:
    import psutil
    limit = max(1, min(50, int(args.get("limit") or 15)))
    sort_by = str(args.get("sort_by") or "cpu").lower()
    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "memory_info"]):
        try:
            info = p.info
            mem_mb = round((info["memory_info"].rss if info["memory_info"] else 0) / (1024 * 1024), 1)
            procs.append({
                "pid": info["pid"],
                "name": info["name"] or "",
                "cpu_percent": info["cpu_percent"] or 0.0,
                "memory_percent": round(info["memory_percent"] or 0.0, 1),
                "memory_mb": mem_mb,
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    if sort_by == "memory":
        procs.sort(key=lambda x: x["memory_mb"], reverse=True)
    else:
        procs.sort(key=lambda x: x["cpu_percent"], reverse=True)
    top = procs[:limit]
    summary = "; ".join(f"{p['name']} (PID {p['pid']}, CPU {p['cpu_percent']}%, {p['memory_mb']}MB)" for p in top[:5])
    return {"result": f"Top processes: {summary}", "processes": top}


@register("killProcessByName")
def kill_process_by_name(args: Dict[str, Any]) -> Dict[str, Any]:
    from .registry import ToolError
    import psutil
    name = str(args.get("name") or "").strip().lower()
    if not name:
        raise ToolError("Parameter 'name' is required.")
    if name in PROTECTED_PROCESSES or name.replace(".exe", "") in {p.replace(".exe", "") for p in PROTECTED_PROCESSES}:
        raise ToolError(f"Cannot terminate critical protected system process '{name}'.")
    killed = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            p_name = (p.info["name"] or "").lower()
            if p_name == name or p_name == f"{name}.exe":
                p.terminate()
                killed.append(p.info["pid"])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    if not killed:
        return {"result": f"No running processes found matching '{name}'.", "killed_pids": []}
    return {"result": f"Terminated {len(killed)} process(es) matching '{name}' (PIDs: {killed}).", "killed_pids": killed}


__all__ = [
    "system_info",
    "gpu_info",
    "temperature_info",
    "battery_info",
    "network_adapters",
    "running_processes",
    "kill_process_by_name",
]
