"""
JAYRA Active Screen Consciousness — Proactive Error & Context Detection.

Provides low-resource, periodic monitoring of the active foreground window:
1. Detects native Windows error/crash dialogs (#32770, MessageBox, WER).
2. Detects severe application exceptions, terminal crash traces, and error banners.
3. Cooldown-gated proactive event emission to prevent duplicate alerts.
"""

from __future__ import annotations

import logging
import platform
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional

log = logging.getLogger("jayra.consciousness")

# Known error window classes & patterns
_DIALOG_CLASS = "#32770"
_ERROR_TITLE_PATTERN = re.compile(
    r"\b(error|crash|exception|fatal|unhandled|access violation|stopped working|failed|critical)\b",
    re.IGNORECASE,
)
_DEV_PROCESS_NAMES = frozenset({
    "code.exe", "devenv.exe", "windowsterminal.exe", "cmd.exe",
    "powershell.exe", "pwsh.exe", "pycharm64.exe", "idea64.exe",
})
_EXCEPTION_TEXT_PATTERN = re.compile(
    r"(Traceback \(most recent call last\)|NullPointerException|System\.Exception|"
    r"Unhandled Exception|Fatal Error|SyntaxError:|TypeError:|ReferenceError:|panic:)",
    re.IGNORECASE,
)


class ScreenConsciousnessMonitor:
    def __init__(self, poll_interval_sec: float = 4.0, cooldown_sec: float = 45.0) -> None:
        self.poll_interval_sec = poll_interval_sec
        self.cooldown_sec = cooldown_sec
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_alert_time: Dict[str, float] = {}
        self._latest_detected: Optional[Dict[str, Any]] = None
        self._alert_callbacks: List[Callable[[Dict[str, Any]], None]] = []
        self._lock = threading.Lock()

    def register_callback(self, callback: Callable[[Dict[str, Any]], None]) -> None:
        with self._lock:
            self._alert_callbacks.append(callback)

    def probe_active_window(self) -> Optional[Dict[str, Any]]:
        """Perform a single, non-blocking check of the foreground window."""
        if platform.system() != "Windows":
            return None

        try:
            import win32gui  # type: ignore
            import win32process  # type: ignore
            try:
                import psutil  # type: ignore
            except ImportError:
                psutil = None  # type: ignore

            hwnd = win32gui.GetForegroundWindow()
            if not hwnd:
                return None

            title = (win32gui.GetWindowText(hwnd) or "").strip()
            cls_name = win32gui.GetClassName(hwnd) or ""
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            proc_name = ""
            if pid and psutil is not None:
                try:
                    proc_name = psutil.Process(pid).name().lower()
                except Exception:
                    pass

            is_dialog = cls_name == _DIALOG_CLASS
            has_error_title = bool(_ERROR_TITLE_PATTERN.search(title))

            # Extract child window texts for dialogs or dev tools
            child_texts: List[str] = []
            if is_dialog or proc_name in _DEV_PROCESS_NAMES:
                def enum_child(child_hwnd: int, _lparam: Any) -> bool:
                    try:
                        text = (win32gui.GetWindowText(child_hwnd) or "").strip()
                        if text and len(text) > 3:
                            child_texts.append(text)
                    except Exception:
                        pass
                    return True

                win32gui.EnumChildWindows(hwnd, enum_child, None)

            combined_text = " ".join(child_texts)
            has_exception_in_text = bool(_EXCEPTION_TEXT_PATTERN.search(combined_text))

            # Determine if this window constitutes an active error event
            if (is_dialog and (has_error_title or has_exception_in_text)) or (has_error_title and proc_name in _DEV_PROCESS_NAMES) or has_exception_in_text:
                error_summary = title or "System Alert"
                detailed_msg = ""
                # Pick the longest descriptive child text as error message
                candidates = [t for t in child_texts if len(t) > 10 and not re.match(r"^(ok|cancel|close|yes|no|retry)$", t, re.I)]
                if candidates:
                    detailed_msg = candidates[0]
                else:
                    detailed_msg = combined_text[:300] if combined_text else title

                fingerprint = f"{proc_name}:{title}:{detailed_msg[:60]}"
                now = time.time()
                last_time = self._last_alert_time.get(fingerprint, 0.0)

                if now - last_time < self.cooldown_sec:
                    return None  # On cooldown

                alert = {
                    "id": f"err_{int(now * 1000)}",
                    "timestamp": now,
                    "severity": "critical" if (is_dialog or "fatal" in title.lower()) else "warning",
                    "title": title,
                    "window_class": cls_name,
                    "process": proc_name,
                    "pid": pid,
                    "message": detailed_msg,
                    "is_dialog": is_dialog,
                    "voice_text": f"Dhyan dijiye, active window me ek issue detect hua hai: {detailed_msg[:120]}",
                }

                self._last_alert_time[fingerprint] = now
                with self._lock:
                    self._latest_detected = alert

                log.info("[Screen Consciousness] Proactive error detected: %s (%s)", title, proc_name)
                return alert

        except Exception as exc:
            log.debug("[Screen Consciousness] Window probe exception: %s", exc)
            return None

        return None

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="JAYRAScreenConsciousness")
            self._thread.start()
            log.info("[Screen Consciousness] Monitor loop started (interval: %.1fs).", self.poll_interval_sec)

    def stop(self) -> None:
        with self._lock:
            self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
            self._thread = None
        log.info("[Screen Consciousness] Monitor loop stopped.")

    def _run_loop(self) -> None:
        while self._running:
            try:
                alert = self.probe_active_window()
                if alert:
                    with self._lock:
                        callbacks = list(self._alert_callbacks)
                    for cb in callbacks:
                        try:
                            cb(alert)
                        except Exception as cb_err:
                            log.warning("[Screen Consciousness] Callback error: %s", cb_err)
            except Exception as loop_err:
                log.debug("[Screen Consciousness] Loop error: %s", loop_err)
            time.sleep(self.poll_interval_sec)

    @property
    def latest_alert(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._latest_detected


# Global instance
screen_consciousness = ScreenConsciousnessMonitor()


try:
    from .registry import register

    @register("probeScreenConsciousness")
    def probe_screen_consciousness(args: Dict[str, Any]) -> Dict[str, Any]:
        alert = screen_consciousness.probe_active_window()
        return {
            "result": f"Screen consciousness probed. {'Alert detected: ' + alert['title'] if alert else 'No active error popup.'}",
            "alert": alert,
            "has_alert": alert is not None,
        }
except Exception:
    pass
