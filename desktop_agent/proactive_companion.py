"""Collect foreground activity context and emit throttled proactive events."""

from __future__ import annotations

import logging
import platform
import re
import threading
import time
import collections
from dataclasses import dataclass
from typing import Any, Callable, Deque, Dict, List, Optional

log = logging.getLogger("jayra.proactive")

# App / Window Classification
_APP_CATEGORIES: Dict[str, str] = {
    "code.exe": "coding", "devenv.exe": "coding", "idea64.exe": "coding",
    "pycharm64.exe": "coding", "sublime_text.exe": "coding", "notepad++.exe": "coding",
    "windowsterminal.exe": "terminal", "cmd.exe": "terminal",
    "powershell.exe": "terminal", "pwsh.exe": "terminal",
    "chrome.exe": "browser", "msedge.exe": "browser", "firefox.exe": "browser",
    "brave.exe": "browser", "opera.exe": "browser",
    "steam.exe": "gaming", "epicgameslauncher.exe": "gaming", "gog galaxy.exe": "gaming",
    "winword.exe": "writing", "excel.exe": "spreadsheet", "powerpnt.exe": "presentation",
    "onenote.exe": "notes", "notion.exe": "notes", "obsidian.exe": "notes",
    "slack.exe": "messaging", "discord.exe": "messaging", "teams.exe": "messaging",
    "zoom.exe": "video_call", "skype.exe": "video_call",
    "vlc.exe": "media", "mpv.exe": "media", "spotify.exe": "music",
    "photoshop.exe": "design", "figma.exe": "design", "blender.exe": "3d_art",
}

_GAME_TITLE_PATTERN = re.compile(
    r"\b(game|minecraft|fortnite|valorant|csgo|cs2|league of legends|gta|call of duty|apex|overwatch)\b",
    re.IGNORECASE,
)
_YOUTUBE_PATTERN = re.compile(r"youtube\.com|youtu\.be", re.IGNORECASE)
_CODING_TITLE_PATTERN = re.compile(
    r"\.(py|ts|tsx|js|jsx|java|cpp|cs|go|rs|php|rb|kt|swift|html|css|json|yaml|toml|ini|sh|ps1)\b"
    r"|\b(Visual Studio Code|IntelliJ|PyCharm|Vim|Neovim|Emacs)\b",
    re.IGNORECASE,
)

@dataclass
class ScreenSnapshot:
    timestamp: float
    active_window: str
    process_name: str
    app_category: str
    user_idle_seconds: float
    window_changed: bool = False


@dataclass
class ProactiveEvent:
    id: str
    timestamp: float
    mode: str
    category: str
    active_window: str
    process_name: str
    idle_seconds: float
    persona_preset: str
    proactivity_level: str
    context_history: List[Dict[str, Any]]
    reaction_memory: List[Dict[str, Any]]
    screen_available: bool = False
    voice_text: str = ""


class ProactiveCompanionEngine:
    MAX_HISTORY: int = 30
    MAX_REACTION_MEMORY: int = 20

    def __init__(
        self,
        poll_interval_sec: float = 5.0,
        *,
        active_task_threshold_sec: float = 240.0,
        idle_away_threshold_sec: float = 300.0,
        proactive_cooldown_sec: float = 120.0,
        on_proactive_event: Optional[Callable[[ProactiveEvent], None]] = None,
    ) -> None:
        self.poll_interval_sec = poll_interval_sec
        self.active_task_threshold_sec = active_task_threshold_sec
        self.idle_away_threshold_sec = idle_away_threshold_sec
        self.proactive_cooldown_sec = proactive_cooldown_sec
        self._on_proactive_event = on_proactive_event
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._focus_mode: bool = False
        self._focus_mode_expires: Optional[float] = None
        self._proactivity_level: str = "balanced"
        self._persona_preset: str = "friendly_caring"
        self._last_user_chat_at: float = time.time()
        self._last_proactive_at: float = 0.0
        self._history: Deque[ScreenSnapshot] = collections.deque(maxlen=self.MAX_HISTORY)
        self._reaction_memory: Deque[Dict[str, Any]] = collections.deque(maxlen=self.MAX_REACTION_MEMORY)
        self._pending_events: List[ProactiveEvent] = []
        self._event_counter = 0

    def update_settings(
        self,
        *,
        proactivity_level: Optional[str] = None,
        persona_preset: Optional[str] = None,
        active_task_threshold_sec: Optional[float] = None,
        idle_away_threshold_sec: Optional[float] = None,
        proactive_cooldown_sec: Optional[float] = None,
    ) -> None:
        with self._lock:
            if proactivity_level in ("quiet", "balanced", "lively"):
                self._proactivity_level = proactivity_level
            if persona_preset in ("friendly_caring", "fun_witty", "naughty_teasing", "professional_assistant"):
                self._persona_preset = persona_preset
            if active_task_threshold_sec is not None:
                self.active_task_threshold_sec = float(active_task_threshold_sec)
            if idle_away_threshold_sec is not None:
                self.idle_away_threshold_sec = float(idle_away_threshold_sec)
            if proactive_cooldown_sec is not None:
                self.proactive_cooldown_sec = float(proactive_cooldown_sec)

    def set_focus_mode(self, enabled: bool, duration_minutes: Optional[float] = None) -> None:
        with self._lock:
            self._focus_mode = enabled
            if enabled and duration_minutes and duration_minutes > 0:
                self._focus_mode_expires = time.time() + (duration_minutes * 60.0)
            elif not enabled:
                self._focus_mode_expires = None
        log.info("[ProactiveEngine] Focus Mode %s", "ON" if enabled else "OFF")

    @property
    def focus_mode(self) -> bool:
        with self._lock:
            if self._focus_mode and self._focus_mode_expires is not None:
                if time.time() >= self._focus_mode_expires:
                    self._focus_mode = False
                    self._focus_mode_expires = None
                    log.info("[ProactiveEngine] Focus Mode auto-expired.")
            return self._focus_mode

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            last_snap = self._history[-1] if self._history else None
            return {
                "running": self._running,
                "focus_mode": self._focus_mode,
                "focus_mode_expires": self._focus_mode_expires,
                "proactivity_level": self._proactivity_level,
                "persona_preset": self._persona_preset,
                "last_user_chat_seconds_ago": round(now - self._last_user_chat_at, 1),
                "last_proactive_seconds_ago": round(now - self._last_proactive_at, 1) if self._last_proactive_at else None,
                "active_task_threshold_sec": self.active_task_threshold_sec,
                "idle_away_threshold_sec": self.idle_away_threshold_sec,
                "proactive_cooldown_sec": self.proactive_cooldown_sec,
                "history_length": len(self._history),
                "pending_events": len(self._pending_events),
                "current_window": last_snap.active_window if last_snap else None,
                "current_category": last_snap.app_category if last_snap else None,
                "current_idle_sec": last_snap.user_idle_seconds if last_snap else None,
            }

    def record_user_chat_activity(self) -> None:
        with self._lock:
            self._last_user_chat_at = time.time()

    def add_reaction_memory(self, entry: Dict[str, Any]) -> None:
        entry.setdefault("timestamp", time.time())
        with self._lock:
            self._reaction_memory.append(entry)

    def get_reaction_memory(self, limit: int = 5) -> List[Dict[str, Any]]:
        with self._lock:
            items = list(self._reaction_memory)
        return items[-limit:]

    def pop_pending_events(self) -> List[ProactiveEvent]:
        with self._lock:
            events = list(self._pending_events)
            self._pending_events.clear()
        return events

    def _probe_desktop(self) -> Optional[ScreenSnapshot]:
        if platform.system() != "Windows":
            return None
        try:
            import win32gui
            import win32process
            try:
                import psutil
            except ImportError:
                psutil = None

            hwnd = win32gui.GetForegroundWindow()
            title = (win32gui.GetWindowText(hwnd) or "").strip() if hwnd else ""
            _, pid = win32process.GetWindowThreadProcessId(hwnd) if hwnd else (None, None)

            proc_name = ""
            if pid and psutil is not None:
                try:
                    proc_name = psutil.Process(pid).name().lower()
                except Exception:
                    pass

            idle_sec = 0.0
            try:
                import ctypes
                class LASTINPUTINFO(ctypes.Structure):
                    _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
                lii = LASTINPUTINFO()
                lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
                ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
                idle_ms = ctypes.windll.kernel32.GetTickCount() - lii.dwTime
                idle_sec = max(0.0, idle_ms / 1000.0)
            except Exception:
                pass

            category = _APP_CATEGORIES.get(proc_name, "unknown")
            if category == "unknown":
                if _GAME_TITLE_PATTERN.search(title):
                    category = "gaming"
                elif _CODING_TITLE_PATTERN.search(title):
                    category = "coding"
                elif _YOUTUBE_PATTERN.search(title):
                    category = "browser"
                elif proc_name.endswith(".exe"):
                    category = "app"

            return ScreenSnapshot(
                timestamp=time.time(),
                active_window=title[:300],
                process_name=proc_name[:80],
                app_category=category,
                user_idle_seconds=idle_sec,
            )
        except Exception as exc:
            log.debug("[ProactiveEngine] Desktop probe error: %s", exc)
            return None

    def _should_speak(self, now: float, snap: ScreenSnapshot) -> Optional[str]:
        if self.focus_mode:
            return None
        proactivity = self._proactivity_level
        if proactivity == "quiet":
            return None
        if now - self._last_proactive_at < self.proactive_cooldown_sec:
            return None
        chat_idle_sec = now - self._last_user_chat_at
        if proactivity == "lively":
            task_threshold = self.active_task_threshold_sec * 0.75
            away_threshold = self.idle_away_threshold_sec * 0.75
        else:
            task_threshold = self.active_task_threshold_sec
            away_threshold = self.idle_away_threshold_sec
        if snap.user_idle_seconds >= away_threshold and chat_idle_sec >= away_threshold:
            return "idle_away"
        if snap.user_idle_seconds < 60.0 and chat_idle_sec >= task_threshold:
            return "active_task"
        return None

    def _build_context_history_dicts(self) -> List[Dict[str, Any]]:
        with self._lock:
            items = list(self._history)
        return [
            {
                "timestamp": round(s.timestamp),
                "window": s.active_window,
                "process": s.process_name,
                "category": s.app_category,
                "idle_sec": round(s.user_idle_seconds, 1),
            }
            for s in items[-10:]
        ]

    def _emit_proactive_event(self, mode: str, snap: ScreenSnapshot) -> None:
        with self._lock:
            self._event_counter += 1
            event_id = f"proactive_{int(time.time() * 1000)}_{self._event_counter}"
            persona = self._persona_preset
            proactivity = self._proactivity_level

        history_dicts = self._build_context_history_dicts()
        reaction_mem = self.get_reaction_memory(5)

        event = ProactiveEvent(
            id=event_id, timestamp=time.time(), mode=mode,
            category=snap.app_category, active_window=snap.active_window,
            process_name=snap.process_name, idle_seconds=snap.user_idle_seconds,
            persona_preset=persona, proactivity_level=proactivity,
            context_history=history_dicts,
            reaction_memory=reaction_mem, screen_available=False,
        )

        with self._lock:
            self._pending_events.append(event)
            self._last_proactive_at = time.time()

        self.add_reaction_memory({
            "type": "proactive_initiation", "mode": mode,
            "category": snap.app_category, "window": snap.active_window[:120],
            "persona": persona,
        })
        log.info("[ProactiveEngine] Event queued: id=%s mode=%s cat=%s", event_id, mode, snap.app_category)
        if self._on_proactive_event:
            try:
                self._on_proactive_event(event)
            except Exception as cb_err:
                log.warning("[ProactiveEngine] Callback error: %s", cb_err)

    def _run_loop(self) -> None:
        log.info("[ProactiveEngine] Loop started.")
        prev_window = ""
        while self._running:
            try:
                snap = self._probe_desktop()
                if snap is not None:
                    snap.window_changed = (snap.active_window != prev_window)
                    prev_window = snap.active_window
                    with self._lock:
                        self._history.append(snap)
                    mode = self._should_speak(time.time(), snap)
                    if mode is not None:
                        self._emit_proactive_event(mode, snap)
            except Exception as loop_err:
                log.debug("[ProactiveEngine] Loop error: %s", loop_err)
            time.sleep(self.poll_interval_sec)

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="JAYRAProactiveCompanion")
            self._thread.start()
        log.info("[ProactiveEngine] Started.")

    def stop(self) -> None:
        with self._lock:
            self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
            self._thread = None
        log.info("[ProactiveEngine] Stopped.")


proactive_engine = ProactiveCompanionEngine()

try:
    from .registry import register

    @register("getProactiveEngineState")
    def get_proactive_engine_state(args: Dict[str, Any]) -> Dict[str, Any]:
        return {"success": True, "state": proactive_engine.get_state()}

    @register("setFocusMode")
    def set_focus_mode_tool(args: Dict[str, Any]) -> Dict[str, Any]:
        enabled = bool(args.get("enabled", False))
        duration_minutes = args.get("duration_minutes")
        if duration_minutes is not None:
            duration_minutes = float(duration_minutes)
        proactive_engine.set_focus_mode(enabled, duration_minutes=duration_minutes)
        state = proactive_engine.get_state()
        status = "enabled" if enabled else "disabled"
        duration_str = f" for {duration_minutes} minutes" if duration_minutes else ""
        return {
            "result": f"Focus Mode {status}{duration_str}.",
            "focus_mode": state["focus_mode"],
            "focus_mode_expires": state["focus_mode_expires"],
        }

    @register("recordUserChatActivity")
    def record_user_chat_activity_tool(args: Dict[str, Any]) -> Dict[str, Any]:
        proactive_engine.record_user_chat_activity()
        return {"result": "User chat activity recorded.", "success": True}

    @register("updateProactiveSettings")
    def update_proactive_settings_tool(args: Dict[str, Any]) -> Dict[str, Any]:
        proactive_engine.update_settings(
            proactivity_level=args.get("proactivity_level"),
            persona_preset=args.get("persona_preset"),
            active_task_threshold_sec=args.get("active_task_threshold_sec"),
            idle_away_threshold_sec=args.get("idle_away_threshold_sec"),
            proactive_cooldown_sec=args.get("proactive_cooldown_sec"),
        )
        return {"result": "Proactive engine settings updated.", "success": True, "state": proactive_engine.get_state()}

except Exception:
    pass

__all__ = ["ProactiveCompanionEngine", "ProactiveEvent", "ScreenSnapshot", "proactive_engine"]
