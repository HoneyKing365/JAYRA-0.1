"""Read-only Windows and psutil system telemetry."""

from __future__ import annotations

import ctypes
import os
import time
from typing import Any, Dict, Optional

from .registry import register


class _SystemPowerStatus(ctypes.Structure):
    _fields_ = [
        ("ACLineStatus", ctypes.c_ubyte),
        ("BatteryFlag", ctypes.c_ubyte),
        ("BatteryLifePercent", ctypes.c_ubyte),
        ("SystemStatusFlag", ctypes.c_ubyte),
        ("BatteryLifeTime", ctypes.c_uint32),
        ("BatteryFullLifeTime", ctypes.c_uint32),
    ]


def _win32_power_status() -> Optional[Dict[str, Any]]:
    if os.name != "nt":
        return None
    try:
        status = _SystemPowerStatus()
        if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)):
            return None
        seconds = int(status.BatteryLifeTime)
        plugged = True if status.ACLineStatus == 1 else False if status.ACLineStatus == 0 else None
        return {
            "percent": None if status.BatteryLifePercent == 255 else int(status.BatteryLifePercent),
            "plugged": plugged,
            "seconds_remaining": None if seconds == 0xFFFFFFFF else seconds,
            "battery_flag": int(status.BatteryFlag),
            "system_status_flag": int(status.SystemStatusFlag),
        }
    except Exception:
        return None


def _process_snapshot(psutil: Any) -> list[Dict[str, Any]]:
    samples = []
    for process in psutil.process_iter(["pid", "name", "memory_info", "memory_percent"]):
        try:
            info = process.info
            cpu_times = process.cpu_times()
            memory = info.get("memory_info")
            samples.append((
                process,
                int(info.get("pid") or process.pid),
                str(info.get("name") or "unknown"),
                float(cpu_times.user + cpu_times.system),
                round(float(info.get("memory_percent") or 0.0), 2),
                int(memory.rss) if memory else 0,
            ))
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue

    sample_started = time.monotonic()
    time.sleep(0.1)
    elapsed = max(0.001, time.monotonic() - sample_started)
    logical_cores = max(1, psutil.cpu_count(logical=True) or 1)
    processes: list[Dict[str, Any]] = []
    for process, pid, name, cpu_before, memory_percent, memory_bytes in samples:
        try:
            cpu_after = process.cpu_times()
            cpu_percent = max(0.0, (cpu_after.user + cpu_after.system - cpu_before) * 100 / (elapsed * logical_cores))
            processes.append({
                "pid": pid,
                "name": name,
                "cpu_percent": round(cpu_percent, 1),
                "memory_percent": memory_percent,
                "memory_bytes": memory_bytes,
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue
    processes.sort(key=lambda item: (item["cpu_percent"] + item["memory_percent"], item["memory_bytes"]), reverse=True)
    return processes[:5]


def collect_system_telemetry() -> Dict[str, Any]:
    import psutil

    cpu_percent = round(float(psutil.cpu_percent(interval=0.1)), 1)
    logical_cores = psutil.cpu_count(logical=True)
    physical_cores = psutil.cpu_count(logical=False)
    frequency = psutil.cpu_freq()
    memory = psutil.virtual_memory()

    power = _win32_power_status()
    battery = None
    try:
        sensed = psutil.sensors_battery()
        if sensed:
            battery = {
                "percent": round(float(sensed.percent), 1),
                "plugged": bool(sensed.power_plugged) if sensed.power_plugged is not None else None,
                "seconds_remaining": int(sensed.secsleft) if sensed.secsleft >= 0 else None,
            }
    except (AttributeError, NotImplementedError, OSError):
        battery = None
    if battery is None and power is not None:
        battery = {key: power[key] for key in ("percent", "plugged", "seconds_remaining")}

    disks = []
    system_drive = os.environ.get("SystemDrive", "C:").rstrip("\\/")
    primary_drive = system_drive + "\\" if os.name == "nt" else "/"
    try:
        usage = psutil.disk_usage(primary_drive)
        disks.append({
            "path": primary_drive,
            "total_bytes": int(usage.total),
            "free_bytes": int(usage.free),
            "used_bytes": int(usage.used),
            "percent": round(float(usage.percent), 1),
        })
    except (OSError, PermissionError):
        disks.append({"path": primary_drive, "available": False})

    return {
        "success": True,
        "cpu": {
            "usage_percent": cpu_percent,
            "logical_cores": logical_cores,
            "physical_cores": physical_cores,
            "frequency_mhz": round(float(frequency.current), 1) if frequency and frequency.current else None,
        },
        "ram": {
            "total_bytes": int(memory.total),
            "available_bytes": int(memory.available),
            "used_bytes": int(memory.used),
            "percent": round(float(memory.percent), 1),
        },
        "battery": battery,
        "power": power,
        "disks": disks,
        "top_processes": _process_snapshot(psutil),
    }


@register("getSystemTelemetry")
def get_system_telemetry(_args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        result = collect_system_telemetry()
        import logging

        logging.getLogger("jayra.telemetry").info("[JAYRA Telemetry] System metrics fetched.")
        return result
    except Exception as error:
        return {
            "success": False,
            "error": f"System telemetry is partially unavailable: {error}",
            "cpu": None,
            "ram": None,
            "battery": None,
            "power": None,
            "disks": [],
            "top_processes": [],
        }


__all__ = ["collect_system_telemetry", "get_system_telemetry"]