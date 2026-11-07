"""Universal Windows application discovery, launch, and graceful close.

Known apps still take the fast path. Unknown names are resolved from PATH,
App Paths, installed-program registry entries, Start-menu shortcuts, and UWP
Start apps. As a final human-style fallback MYRAA uses Windows Search. Closing
targets real visible windows/processes instead of rejecting names that are not
in a hard-coded allow-list.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import json
import subprocess
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from .registry import ToolError, register


def _find_vscode_exe() -> Optional[str]:
    """Find VS Code's Code.exe on Windows across all common install locations.

    Returns the absolute path or None if not found. Deliberately avoids
    code.cmd because subprocess.Popen(shell=False) raises WinError 193 on
    batch files — only real Win32 EXEs are supported by that code path.
    """
    candidates = []
    local_app = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("PROGRAMFILES", "C:\\Program Files")
    program_files_x86 = os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)")
    user_profile = os.environ.get("USERPROFILE", "")

    if local_app:
        candidates.append(os.path.join(local_app, "Programs", "Microsoft VS Code", "Code.exe"))
    if program_files:
        candidates.append(os.path.join(program_files, "Microsoft VS Code", "Code.exe"))
    if program_files_x86:
        candidates.append(os.path.join(program_files_x86, "Microsoft VS Code", "Code.exe"))
    if user_profile:
        candidates.append(os.path.join(user_profile, "AppData", "Local", "Programs", "Microsoft VS Code", "Code.exe"))

    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate

    # Fallback: check PATH for Code.exe (not code.cmd)
    found = shutil.which("Code.exe") or shutil.which("code")
    if found and not found.endswith(".cmd"):
        return found

    return None


_VSCODE_EXE: Optional[str] = None


def _get_vscode_exe() -> Optional[str]:
    """Lazily resolve and cache the VS Code executable path."""
    global _VSCODE_EXE
    if _VSCODE_EXE is None or not os.path.isfile(_VSCODE_EXE):
        _VSCODE_EXE = _find_vscode_exe()
    return _VSCODE_EXE


APP_COMMANDS: Dict[str, Dict[str, str]] = {
    "notepad": {"exe": "notepad.exe", "image": "notepad.exe", "label": "Notepad"},
    "chrome": {"exe": "chrome.exe", "image": "chrome.exe", "label": "Google Chrome"},
    "edge": {"exe": "msedge.exe", "image": "msedge.exe", "label": "Microsoft Edge"},
    # VS Code: always resolved via _get_vscode_exe() so code.cmd is never used directly.
    "vscode": {"vscode_dynamic": "true", "image": "Code.exe", "label": "Visual Studio Code"},
    "calculator": {"shell": "calc", "image": "CalculatorApp.exe", "label": "Calculator"},
    "calc": {"shell": "calc", "image": "CalculatorApp.exe", "label": "Calculator"},
    "file explorer": {"shell": "explorer", "image": "explorer.exe", "label": "File Explorer"},
    "explorer": {"shell": "explorer", "image": "explorer.exe", "label": "File Explorer"},
    "task manager": {"shell": "taskmgr", "image": "Taskmgr.exe", "label": "Task Manager"},
    "taskmanager": {"shell": "taskmgr", "image": "Taskmgr.exe", "label": "Task Manager"},
    "settings": {"uwp": "ms-settings:", "image": "SystemSettings.exe", "label": "Settings"},
    "command prompt": {"exe": "cmd.exe", "image": "cmd.exe", "label": "Command Prompt"},
    "cmd": {"exe": "cmd.exe", "image": "cmd.exe", "label": "Command Prompt"},
    "powershell": {"exe": "powershell.exe", "image": "powershell.exe", "label": "PowerShell"},
    "paint": {"shell": "mspaint", "image": "mspaint.exe", "label": "Paint"},
    "snipping tool": {"uwp": "ms-screenclip:", "image": "ScreenClippingHost.exe", "label": "Snipping Tool"},
}

ALIASES = {
    "code": "vscode", "visual studio code": "vscode", "vs code": "vscode",
    "google chrome": "chrome", "microsoft edge": "edge", "settings app": "settings",
    "windows explorer": "file explorer", "microsoft store": "store",
}

PRIORITY_APP_TARGETS = {
    "whatsapp": ("whatsapp:", "https://web.whatsapp.com/"),
    "instagram": ("instagram:", "https://www.instagram.com/"),
    "youtube": ("https://www.youtube.com/",),
    "store": ("ms-windows-store:",),
}
PRIORITY_SHORTCUT_APPS = {"whatsapp", "instagram"}


def _normalize_name(value: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(value).casefold()))


def _compact(value: Any) -> str:
    return _normalize_name(value).replace(" ", "")


def _resolve_known_app(key: str) -> Optional[Dict[str, str]]:
    norm = _normalize_name(key)
    norm = ALIASES.get(norm, norm)
    return APP_COMMANDS.get(norm)


def _launch_priority_target(target: str) -> str:
    if target.startswith(("http://", "https://")):
        if not webbrowser.open(target, new=2):
            raise ToolError(f"Could not open the default browser for {target}.")
        return "default_browser"
    if platform.system() == "Windows":
        try:
            os.startfile(target)
        except OSError as error:
            try:
                subprocess.Popen(
                    ["cmd.exe", "/c", "start", "", target],
                    shell=False,
                    close_fds=True,
                    creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                    | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
            except OSError as fallback_error:
                raise ToolError(
                    f"Could not open system URI '{target}': {fallback_error}"
                ) from error
    elif not webbrowser.open(target, new=2):
        raise ToolError(f"No handler is registered for system URI '{target}'.")
    return "system_uri"


def _launch_priority_application(name: str) -> Optional[Dict[str, str]]:
    normalized = ALIASES.get(_normalize_name(name), _normalize_name(name))
    targets = PRIORITY_APP_TARGETS.get(normalized)
    if not targets:
        if normalized == "browser":
            if not webbrowser.open("about:blank", new=2):
                raise ToolError("Could not open the default browser.")
            return {
                "result": "Opened a new default browser window.",
                "application": "Default browser",
                "method": "default_browser",
                "fallback_pathway": "direct_priority_launch",
            }
        return None

    failures = []
    for index, target in enumerate(targets):
        try:
            method = _launch_priority_target(target)
            return {
                "result": f"Opened {normalized}.",
                "application": normalized.title(),
                "method": method,
                "fallback_pathway": "direct_priority_launch",
            }
        except Exception as error:
            failures.append(f"{target}: {error}")
        if (
            index == 0
            and normalized in PRIORITY_SHORTCUT_APPS
            and platform.system() == "Windows"
        ):
            try:
                discovered = _discover_application(normalized)
                if discovered:
                    _launch_discovered(discovered)
                    return {
                        "result": f"Opened {discovered['label']}.",
                        "application": discovered["label"],
                        "method": discovered["method"],
                        "fallback_pathway": "priority_shortcut_discovery",
                    }
            except Exception as error:
                failures.append(f"shortcut_discovery_failed: {error}")
    raise ToolError(
        f"Direct launch failed for {normalized}: {'; '.join(failures)}"
    )


def _candidate_score(query: str, label: str) -> int:
    q, candidate = _normalize_name(query), _normalize_name(label)
    if not q or not candidate:
        return 0
    if q == candidate:
        return 1_000
    if _compact(q) == _compact(candidate):
        return 980
    query_tokens, candidate_tokens = set(q.split()), set(candidate.split())
    if query_tokens and query_tokens.issubset(candidate_tokens):
        return 700 - abs(len(candidate) - len(q))
    if candidate_tokens and candidate_tokens.issubset(query_tokens):
        return 660 - abs(len(candidate) - len(q))
    return 0


def _start_menu_dirs() -> Iterable[tuple[Path, bool]]:
    """(directory, recursive). Desktops are scanned top-level only: they often
    hold project folders with hundreds of thousands of files."""
    program_data = os.environ.get("PROGRAMDATA")
    app_data = os.environ.get("APPDATA")
    user_profile = os.environ.get("USERPROFILE")
    if program_data:
        yield Path(program_data) / "Microsoft" / "Windows" / "Start Menu", True
    if app_data:
        yield Path(app_data) / "Microsoft" / "Windows" / "Start Menu", True
    if user_profile:
        yield Path(user_profile) / "Desktop", False
        yield Path(user_profile) / "OneDrive" / "Desktop", False
    public = os.environ.get("PUBLIC")
    if public:
        yield Path(public) / "Desktop", False


def _shortcut_candidates() -> Iterable[Dict[str, str]]:
    for directory, recursive in _start_menu_dirs():
        if not directory.exists():
            continue
        try:
            for path in (directory.rglob("*") if recursive else directory.iterdir()):
                if path.suffix.casefold() in {".lnk", ".url"} and path.is_file():
                    yield {"label": path.stem, "path": str(path), "method": "start_menu"}
        except (OSError, PermissionError):
            continue


def _clean_display_icon(value: str) -> Optional[Path]:
    raw = str(value or "").strip().strip('"')
    raw = re.sub(r",-?\d+$", "", raw).strip().strip('"')
    return Path(os.path.expandvars(raw)) if raw else None


def _registry_candidates(query: str) -> Iterable[Dict[str, str]]:
    if platform.system() != "Windows":
        return
    try:
        import winreg
    except ImportError:
        return

    def value(key, name: Optional[str]) -> str:
        try:
            return str(winreg.QueryValueEx(key, name)[0] or "")
        except OSError:
            return ""

    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            parent = winreg.OpenKey(root, r"Software\Microsoft\Windows\CurrentVersion\App Paths")
        except OSError:
            continue
        with parent:
            index = 0
            while True:
                try:
                    child_name = winreg.EnumKey(parent, index)
                    index += 1
                except OSError:
                    break
                try:
                    with winreg.OpenKey(parent, child_name) as child:
                        executable = Path(os.path.expandvars(value(child, None).strip('"')))
                    if executable.is_file():
                        yield {"label": Path(child_name).stem, "path": str(executable), "method": "app_paths"}
                except OSError:
                    continue

    uninstall_paths = (
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    )
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for registry_path in uninstall_paths:
            try:
                parent = winreg.OpenKey(root, registry_path)
            except OSError:
                continue
            with parent:
                index = 0
                while True:
                    try:
                        child_name = winreg.EnumKey(parent, index)
                        index += 1
                    except OSError:
                        break
                    try:
                        with winreg.OpenKey(parent, child_name) as child:
                            label = value(child, "DisplayName")
                            icon = _clean_display_icon(value(child, "DisplayIcon"))
                            install_raw = value(child, "InstallLocation")
                            install = Path(os.path.expandvars(install_raw)) if install_raw else None
                    except OSError:
                        continue
                    if not label or _candidate_score(query, label) <= 0:
                        continue
                    executable: Optional[Path] = None
                    if icon and icon.is_file() and icon.name.casefold() not in {"uninstall.exe", "unins000.exe"}:
                        executable = icon
                    search_dir = install if install and install.is_dir() else (icon.parent if icon else None)
                    if executable is None and search_dir and search_dir.is_dir():
                        desired = _compact(query)
                        try:
                            exact = [path for path in search_dir.glob("*.exe") if _compact(path.stem) == desired]
                            executable = exact[0] if exact else None
                        except OSError:
                            pass
                    if executable and executable.is_file():
                        yield {"label": label, "path": str(executable), "method": "installed_apps"}


def _uwp_candidates() -> Iterable[Dict[str, str]]:
    if platform.system() != "Windows":
        return
    try:
        command = [
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "Get-StartApps | ForEach-Object { $_.Name + [char]9 + $_.AppID }",
        ]
        output = subprocess.run(
            command, capture_output=True, text=True, timeout=25, check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
        for line in output.splitlines():
            if "\t" in line:
                label, app_id = line.split("\t", 1)
                if label.strip() and app_id.strip():
                    yield {"label": label.strip(), "app_id": app_id.strip(), "method": "windows_apps"}
    except Exception:
        return


# ---- installed-app index ---------------------------------------------------
# Scanning Start-menu shortcuts and Store apps takes seconds (PowerShell's
# Get-StartApps alone is 1-6 s cold), far too slow to do on every "open X".
# The index is built in the background when the agent starts, cached on disk
# for the next start, and refreshed when it is older than 15 minutes.
_INDEX_LOCK = threading.Lock()
_INDEX: Dict[str, Any] = {"built": 0.0, "items": [], "building": False}
_INDEX_READY = threading.Event()
_INDEX_MAX_AGE = 15 * 60


def _index_cache_path() -> Optional[Path]:
    base = os.environ.get("LOCALAPPDATA")
    return Path(base) / "MYRAA" / "app-index.json" if base else None


def _build_index() -> None:
    try:
        items = list(_shortcut_candidates()) + list(_uwp_candidates() or [])
        with _INDEX_LOCK:
            _INDEX["items"] = items
            _INDEX["built"] = time.time()
        cache = _index_cache_path()
        if cache:
            try:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps({"built": _INDEX["built"], "items": items}), encoding="utf-8")
            except OSError:
                pass
    finally:
        with _INDEX_LOCK:
            _INDEX["building"] = False
        _INDEX_READY.set()


def _refresh_index_async() -> None:
    with _INDEX_LOCK:
        if _INDEX["building"]:
            return
        _INDEX["building"] = True
    threading.Thread(target=_build_index, name="myraa-app-index", daemon=True).start()


def _load_index_cache() -> None:
    cache = _index_cache_path()
    try:
        if cache and cache.exists():
            data = json.loads(cache.read_text(encoding="utf-8"))
            if isinstance(data.get("items"), list):
                with _INDEX_LOCK:
                    _INDEX["items"] = [item for item in data["items"] if isinstance(item, dict) and item.get("label")]
                    _INDEX["built"] = float(data.get("built") or 0)
                _INDEX_READY.set()
    except (OSError, ValueError):
        pass


def _indexed_candidates(wait: float = 6.0) -> list[Dict[str, str]]:
    if not _INDEX_READY.is_set():
        _refresh_index_async()
        _INDEX_READY.wait(wait)
    elif time.time() - _INDEX["built"] > _INDEX_MAX_AGE:
        _refresh_index_async()
    with _INDEX_LOCK:
        return list(_INDEX["items"])


def warm_app_index() -> None:
    """Called at agent start: cached index now, a fresh one in the background."""
    if platform.system() != "Windows":
        return
    _load_index_cache()
    _refresh_index_async()


def _discover_application(name: str) -> Optional[Dict[str, str]]:
    raw = str(name).strip()
    direct = shutil.which(raw) or shutil.which(f"{raw}.exe")
    candidates: list[Dict[str, str]] = []
    if direct:
        candidates.append({"label": Path(direct).stem, "path": direct, "method": "path"})
    shortcut = Path(os.path.expandvars(os.path.expanduser(raw.strip('"'))))
    if shortcut.suffix.casefold() in {".lnk", ".url"} and shortcut.is_file():
        return {"label": shortcut.stem, "path": str(shortcut), "method": "shortcut_path"}
    candidates.extend(_registry_candidates(raw) or [])
    candidates.extend(_indexed_candidates())
    ranked = sorted(
        ((candidate, _candidate_score(raw, candidate["label"])) for candidate in candidates),
        key=lambda item: item[1], reverse=True,
    )
    return ranked[0][0] if ranked and ranked[0][1] >= 600 else None


def _launch_known(spec: Dict[str, str]) -> None:
    label = spec.get("label", "Application")
    try:
        if "vscode_dynamic" in spec:
            # Special path: discover Code.exe, never use code.cmd (WinError 193 on Popen with shell=False).
            executable = _get_vscode_exe()
            if not executable:
                # Try general discovery as a last resort
                discovered = _discover_application("Visual Studio Code")
                executable = discovered.get("path") if discovered else None
            if executable:
                try:
                    subprocess.Popen(
                        [executable], shell=False, close_fds=True,
                        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                    )
                    return
                except OSError as os_err:
                    if getattr(os_err, "winerror", None) == 740:
                        raise ToolError(f"{label} requires administrator elevation. Please run JAYRA or open {label} as administrator.")
                    # Fallback: launch via cmd.exe /c start (handles any Win32/cmd paths)
                    subprocess.Popen(["cmd.exe", "/c", "start", "", executable], close_fds=True)
                    return
            # cmd-path fallback: launch code via shell so PATH .cmd resolution works
            try:
                subprocess.Popen(["cmd.exe", "/c", "start", "", "code"], close_fds=True)
            except OSError as fallback_err:
                raise ToolError(f"VS Code was not found on this system. Install it from https://code.visualstudio.com/ ({fallback_err})")
        elif "exe" in spec:
            executable = shutil.which(spec["exe"])
            if not executable:
                discovered = _discover_application(label)
                executable = discovered.get("path") if discovered else None
            if not executable:
                raise ToolError(f"Windows could not find the installed executable for {label}.")
            try:
                subprocess.Popen(
                    [executable], shell=False, close_fds=True,
                    creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                    | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
            except OSError as os_err:
                # Fallback to os.startfile or cmd.exe start
                if getattr(os_err, "winerror", None) == 740:
                    raise ToolError(f"{label} requires administrator elevation. Please run JAYRA or open {label} as administrator.")
                try:
                    os.startfile(executable)
                except Exception:
                    subprocess.Popen(["cmd.exe", "/c", "start", "", executable], close_fds=True)
        elif "shell" in spec:
            subprocess.Popen(["cmd.exe", "/c", "start", "", spec["shell"]], close_fds=True)
        elif "uwp" in spec:
            os.startfile(spec["uwp"])
        else:
            raise ToolError(f"App spec for {label} is incomplete.")
    except ToolError:
        raise
    except Exception as error:
        err_str = str(error)
        if "740" in err_str or "elevation" in err_str.lower():
            raise ToolError(f"{label} requires administrator elevation. Please run as administrator.") from error
        if "permission" in err_str.lower() or "denied" in err_str.lower():
            raise ToolError(f"Access denied launching {label}. Please check permissions.") from error
        raise ToolError(f"Could not launch {label}: {error}") from error


def _launch_discovered(candidate: Dict[str, str]) -> None:
    label = candidate.get("label", "Application")
    try:
        if candidate.get("app_id"):
            subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{candidate['app_id']}"])
        else:
            path = candidate["path"]
            try:
                os.startfile(path)
            except OSError as os_err:
                if getattr(os_err, "winerror", None) == 740:
                    raise ToolError(f"{label} requires administrator elevation. Please open {label} as administrator.")
                # Fallback to shell start
                subprocess.Popen(["cmd.exe", "/c", "start", "", path], close_fds=True)
    except ToolError:
        raise
    except Exception as error:
        err_str = str(error)
        if "740" in err_str or "elevation" in err_str.lower():
            raise ToolError(f"{label} requires administrator elevation. Please run as administrator.") from error
        if "permission" in err_str.lower() or "denied" in err_str.lower():
            raise ToolError(f"Access denied launching {label}. Please check permissions.") from error
        raise ToolError(f"Could not launch {label}: {error}") from error


def _launch_via_windows_search(name: str) -> None:
    try:
        import pyautogui

        pyautogui.FAILSAFE = True
        pyautogui.press("win")
        time.sleep(0.25)
        pyautogui.write(name, interval=0.025)
        time.sleep(0.9)
        pyautogui.press("enter")
    except Exception as error:
        raise ToolError(
            f"Windows Search could not open '{name}'. The installed-app scan also found no match: {error}"
        ) from error


def _matching_windows(name: str) -> list[Dict[str, Any]]:
    if platform.system() != "Windows":
        return []
    try:
        import psutil
        import win32gui
        import win32process
    except ImportError:
        return []
    query = _normalize_name(name)
    known = _resolve_known_app(name)
    expected_image = _compact(Path(known["image"]).stem) if known and known.get("image") else ""
    matches: list[Dict[str, Any]] = []

    def callback(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd).strip()
        if not title:
            return True
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            process_name = psutil.Process(pid).name()
        except Exception:
            pid, process_name = 0, ""
        title_norm = _normalize_name(title)
        process_norm = _compact(Path(process_name).stem)
        score = 0
        if query == title_norm:
            score = 1_000
        elif set(query.split()).issubset(set(title_norm.split())):
            score = 800
        if process_norm == _compact(query) or (expected_image and process_norm == expected_image):
            score = max(score, 950)
        if score:
            matches.append({"hwnd": int(hwnd), "pid": int(pid), "title": title, "process": process_name, "score": score})
        return True

    try:
        win32gui.EnumWindows(callback, None)
    except Exception:
        return []
    return sorted(matches, key=lambda item: item["score"], reverse=True)


def _close_windows_with_keyboard(matches: list[Dict[str, Any]]) -> int:
    import win32gui
    from .tools_windows import _focus
    import pyautogui

    pyautogui.FAILSAFE = True
    closed = 0
    for match in matches[:8]:
        hwnd = match["hwnd"]
        if not win32gui.IsWindow(hwnd) or not win32gui.IsWindowVisible(hwnd):
            continue
        try:
            _focus(hwnd)
            time.sleep(0.12)
            pyautogui.hotkey("alt", "f4")
            closed += 1
            time.sleep(0.18)
        except Exception:
            continue
    return closed


@register("openApplication")
def open_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or args.get("application") or "").strip()
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    
    fallbacks_attempted = []

    try:
        priority_result = _launch_priority_application(name)
        if priority_result:
            return priority_result
    except Exception as err:
        fallbacks_attempted.append(f"priority_launch_failed: {err}")
    
    # Pathway 1: Known Application Fast Launch
    known = _resolve_known_app(name)
    if known:
        try:
            _launch_known(known)
            return {
                "result": f"{known['label']} opened.",
                "application": known["label"],
                "method": "known_app",
                "fallback_pathway": "direct_known_launch"
            }
        except Exception as err:
            fallbacks_attempted.append(f"known_launch_failed: {err}")
    
    # Pathway 2: System Application Discovery (PATH, Registry, Start Menu, UWP)
    discovered = _discover_application(name)
    if not discovered and _INDEX["built"] and time.time() - _INDEX["built"] > 120:
        _INDEX_READY.clear()
        _refresh_index_async()
        _INDEX_READY.wait(12)
        discovered = _discover_application(name)
        
    if discovered:
        try:
            _launch_discovered(discovered)
            return {
                "result": f"Opened installed application {discovered['label']}.",
                "application": discovered["label"],
                "method": discovered["method"],
                "fallback_pathway": "system_catalog_discovery"
            }
        except Exception as err:
            fallbacks_attempted.append(f"discovery_launch_failed: {err}")

    # Pathway 3: PowerShell / Shell Start-Process Fallback
    try:
        escaped_name = name.replace("'", "''")
        ps_cmd = f"Start-Process -FilePath '{escaped_name}' -ErrorAction Stop"
        res = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps_cmd],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if res.returncode == 0:
            return {
                "result": f"Launched '{name}' via Windows PowerShell process management.",
                "application": name,
                "method": "powershell_start_process",
                "fallback_pathway": "shell_execution_fallback"
            }
        details = (res.stderr or res.stdout or "").strip()
        fallbacks_attempted.append(
            f"powershell_start_process_failed: {details or f'exit code {res.returncode}'}"
        )
    except Exception as err:
        fallbacks_attempted.append(f"powershell_fallback_failed: {err}")

    # Pathway 4: Windows Search Human-Style Keyboard Navigation Fallback
    try:
        _launch_via_windows_search(name)
        return {
            "result": f"Asked Windows Search to open '{name}' using keyboard accessibility.",
            "application": name,
            "method": "windows_search_keyboard",
            "fallback_pathway": "keyboard_accessibility_search",
            "prior_fallbacks": fallbacks_attempted
        }
    except Exception as err:
        raise ToolError(
            f"All multi-modal launch pathways failed for '{name}'. "
            f"Attempts: {', '.join(fallbacks_attempted + [str(err)])}"
        )


@register("closeApplication")
def close_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or args.get("application") or "").strip()
    force = bool(args.get("force", False))
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    
    matches = _matching_windows(name)
    if matches:
        # Pathway 1: Keyboard Alt+F4 to active window
        closed = _close_windows_with_keyboard(matches)
        if closed:
            return {
                "result": f"Closed {closed} visible '{name}' window(s) with Alt+F4.",
                "application": name, "windows_closed": closed, "method": "keyboard_alt_f4",
            }
        
        # Pathway 2: Win32 OS WM_CLOSE API message fallback
        try:
            import win32gui
            import win32con
            wm_closed = 0
            for match in matches[:8]:
                hwnd = match["hwnd"]
                if win32gui.IsWindow(hwnd):
                    win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
                    wm_closed += 1
            if wm_closed:
                return {
                    "result": f"Sent WM_CLOSE message to {wm_closed} '{name}' window(s).",
                    "application": name, "windows_closed": wm_closed, "method": "os_accessibility_wm_close"
                }
        except Exception:
            pass

    # Pathway 3: Process Termination (graceful or forced)
    try:
        import psutil

        query = _compact(name)
        known = _resolve_known_app(name)
        expected = _compact(Path(known["image"]).stem) if known and known.get("image") else query
        terminated = 0
        for process in psutil.process_iter(["name"]):
            if _compact(Path(process.info.get("name") or "").stem) in {query, expected}:
                if force:
                    process.kill()
                else:
                    process.terminate()
                terminated += 1
        if terminated:
            return {
                "result": f"{'Force-closed' if force else 'Gracefully closed'} {terminated} '{name}' process(es).",
                "application": name, "processes_closed": terminated, "method": "process_terminate",
            }
    except Exception as error:
        raise ToolError(f"Could not close '{name}': {error}") from error

    raise ToolError(
        f"No running visible window matching '{name}' was found. "
        "The name was searched across all windows and processes; it is not limited by a supported-app list."
    )


@register("focusApplication")
def focus_application(args: Dict[str, Any]) -> Dict[str, Any]:
    """Bring any open application to the front with multi-modal fallback."""
    name = str(args.get("name") or args.get("application") or "").strip()
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    
    matches = _matching_windows(name)
    if not matches:
        raise ToolError(f"No active window matching '{name}' found to focus.")
    
    target = matches[0]
    hwnd = target["hwnd"]
    
    try:
        import win32gui
        import win32con
        from .tools_windows import _focus
        
        # Restore if minimized
        if win32gui.IsIconic(hwnd):
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            time.sleep(0.1)
        
        _focus(hwnd)
        return {
            "result": f"Focused window '{target['title']}' for '{name}'.",
            "hwnd": hwnd,
            "title": target["title"],
            "process": target["process"],
            "method": "win32_set_foreground"
        }
    except Exception as err:
        # Fallback to Alt+Tab cycling
        try:
            import pyautogui
            pyautogui.hotkey("alt", "tab")
            return {
                "result": f"Cycled window focus to '{name}' via keyboard Alt+Tab fallback.",
                "method": "keyboard_alt_tab_fallback",
                "note": str(err)
            }
        except Exception as alt_err:
            raise ToolError(f"Failed to focus '{name}': {err}; Alt+Tab fallback failed: {alt_err}")


@register("listRunningApplications")
def list_running_applications(_args: Dict[str, Any] = None) -> Dict[str, Any]:
    """Enumerate all running visible desktop application windows."""
    try:
        import win32gui
        import win32process
        import psutil
    except ImportError:
        return {"applications": [], "count": 0, "error": "Win32 packages not available"}
    
    apps = []
    
    def enum_cb(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return True
        title = win32gui.GetWindowText(hwnd).strip()
        if not title:
            return True
        # Filter out tiny or zero-size system utility windows
        rect = win32gui.GetWindowRect(hwnd)
        width = rect[2] - rect[0]
        height = rect[3] - rect[1]
        if width < 100 or height < 100:
            return True
            
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            proc_name = psutil.Process(pid).name()
        except Exception:
            pid, proc_name = 0, ""
            
        # Ignore taskbar, program manager, shell
        if proc_name.lower() in {"explorer.exe", "shellexperiencehost.exe", "searchhost.exe"} and title in {"Program Manager", "", "Start"}:
            return True
            
        apps.append({
            "hwnd": int(hwnd),
            "pid": int(pid),
            "title": title,
            "process": proc_name,
            "bounds": {"x": rect[0], "y": rect[1], "width": width, "height": height}
        })
        return True

    try:
        win32gui.EnumWindows(enum_cb, None)
    except Exception as err:
        return {"applications": [], "count": 0, "error": str(err)}
        
    return {"applications": apps, "count": len(apps)}


@register("restartApplication")
def restart_application(args: Dict[str, Any]) -> Dict[str, Any]:
    """Gracefully close and re-launch an application."""
    name = str(args.get("name") or args.get("application") or "").strip()
    if not name:
        raise ToolError("Parameter 'name' is required.")
        
    close_res = None
    try:
        close_res = close_application({"name": name})
        time.sleep(1.0)
    except Exception:
        pass
        
    open_res = open_application({"name": name})
    return {
        "result": f"Restarted '{name}'.",
        "close": close_res,
        "open": open_res
    }


__all__ = [
    "warm_app_index",
    "open_application", "close_application", "focus_application",
    "list_running_applications", "restart_application",
    "APP_COMMANDS", "_candidate_score",
    "_discover_application", "_matching_windows",
]
