"""Bounded native Windows mouse, keyboard, and window controls."""

from __future__ import annotations

import logging
import platform
from typing import Any, Dict, Sequence

from .registry import ToolError, register
from .tools_input import _active_window, _button, _coordinate, _observation, _pyautogui
from .tools_windows import (
    SW_MAXIMIZE,
    SW_MINIMIZE,
    _close_window_hwnd,
    _find_window_by_title,
    _focus,
    _resolve_target,
    _show_window,
)

log = logging.getLogger("jayra.ui_automation")


def _gui():
    gui = _pyautogui()
    gui.FAILSAFE = True
    return gui


def _input_error(error: Exception) -> ToolError:
    if error.__class__.__name__ == "FailSafeException":
        return ToolError("PyAutoGUI emergency corner fail-safe triggered; action aborted.")
    return ToolError(f"Native UI action failed: {error}")


def click_at(x: int, y: int, button: str = "left") -> Dict[str, Any]:
    x, y = _coordinate({"x": x, "y": y})
    try:
        _gui().click(x=x, y=y, button=_button(button, ("left", "middle", "right")))
    except Exception as error:
        raise _input_error(error) from error
    log.info("[JAYRA UI Automation] mouse click executed.")
    return {"success": True, "result": f"Clicked at ({x}, {y}).", "observation": _observation()}


def double_click(x: int, y: int) -> Dict[str, Any]:
    x, y = _coordinate({"x": x, "y": y})
    try:
        _gui().doubleClick(x=x, y=y, interval=0.12, button="left")
    except Exception as error:
        raise _input_error(error) from error
    log.info("[JAYRA UI Automation] mouse double-click executed.")
    return {"success": True, "result": f"Double-clicked at ({x}, {y}).", "observation": _observation()}


def right_click(x: int, y: int) -> Dict[str, Any]:
    return click_at(x, y, "right")


def scroll(amount: int) -> Dict[str, Any]:
    try:
        units = int(amount)
    except (TypeError, ValueError) as error:
        raise ToolError("Scroll amount must be an integer.") from error
    if units == 0 or abs(units) > 5000:
        raise ToolError("Scroll amount must be between -5000 and 5000 and not zero.")
    try:
        _gui().scroll(units)
    except Exception as error:
        raise _input_error(error) from error
    log.info("[JAYRA UI Automation] mouse scroll executed.")
    return {"success": True, "result": f"Scrolled {units} units.", "observation": _observation()}


def type_text(text: str, interval: float = 0.02) -> Dict[str, Any]:
    if not isinstance(text, str) or not text:
        raise ToolError("Non-empty text is required.")
    if len(text) > 10_000:
        raise ToolError("Text is too long for one input action (maximum 10,000 characters).")
    try:
        delay = max(0.0, min(0.25, float(interval)))
    except (TypeError, ValueError) as error:
        raise ToolError("Typing interval must be a number.") from error
    try:
        _gui().write(text, interval=delay)
    except Exception as error:
        raise _input_error(error) from error
    log.info("[JAYRA UI Automation] keyboard text input executed (%d characters).", len(text))
    return {"success": True, "result": f"Typed {len(text)} characters.", "observation": _observation()}


def press_hotkey(*keys: str) -> Dict[str, Any]:
    normalized = [str(key).strip().lower() for key in keys if str(key).strip()]
    if not normalized or len(normalized) > 8:
        raise ToolError("Provide between one and eight hotkey names.")
    if any(len(key) > 30 for key in normalized):
        raise ToolError("Hotkey names must be 30 characters or fewer.")
    try:
        _gui().hotkey(*normalized)
    except Exception as error:
        raise _input_error(error) from error
    log.info("[JAYRA UI Automation] keyboard hotkey executed.")
    return {"success": True, "result": f"Pressed {'+'.join(normalized)}.", "observation": _observation()}


def _require_windows() -> None:
    if platform.system() != "Windows":
        raise ToolError("Window control is only supported on Windows.")


def focus_window(title: str) -> Dict[str, Any]:
    _require_windows()
    query = str(title or "").strip()
    if not query:
        raise ToolError("A window title is required.")
    hwnd = _find_window_by_title(query)
    if not hwnd:
        raise ToolError(f"No visible window with title containing '{query}'.")
    try:
        _focus(hwnd)
    except Exception as error:
        raise _input_error(error) from error
    log.info("[JAYRA UI Automation] window focus executed.")
    return {"success": True, "result": f"Focused window: {query}.", "active_window": _active_window()}


def _window_action(title: str, action: str) -> Dict[str, Any]:
    _require_windows()
    forwarded: Dict[str, Any] = {"title": title} if title else {}
    hwnd, actual_title = _resolve_target(forwarded)
    if action == "minimize":
        _show_window(hwnd, SW_MINIMIZE)
    elif action == "maximize":
        _show_window(hwnd, SW_MAXIMIZE)
    elif action == "close":
        _close_window_hwnd(hwnd)
    elif action == "focus":
        _focus(hwnd)
    else:
        raise ToolError(f"Unsupported window action: {action}.")
    log.info("[JAYRA UI Automation] window %s executed.", action)
    past_tense = {"minimize": "Minimized", "maximize": "Maximized", "close": "Closed", "focus": "Focused"}[action]
    return {"success": True, "result": f"{past_tense} window: {actual_title or 'active window'}."}


def minimize_window(title: str = "") -> Dict[str, Any]:
    return _window_action(title, "minimize")


def maximize_window(title: str = "") -> Dict[str, Any]:
    return _window_action(title, "maximize")


def close_window(title: str = "") -> Dict[str, Any]:
    return _window_action(title, "close")


@register("gui_click")
def gui_click(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "click_at").lower()
    if action == "scroll":
        return scroll(args.get("amount", 0))
    try:
        x, y = int(args["x"]), int(args["y"])
    except (KeyError, TypeError, ValueError) as error:
        raise ToolError("Integer x and y coordinates are required.") from error
    if action == "double_click":
        return double_click(x, y)
    if action == "right_click":
        return right_click(x, y)
    if action == "click_at":
        return click_at(x, y, str(args.get("button") or "left"))
    raise ToolError(f"Unsupported mouse action: {action}.")


@register("gui_type")
def gui_type(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "type_text").lower()
    if action == "press_hotkey":
        keys = args.get("keys")
        if not isinstance(keys, Sequence) or isinstance(keys, (str, bytes)):
            raise ToolError("keys must be a list of hotkey names.")
        return press_hotkey(*[str(key) for key in keys])
    if action == "type_text":
        return type_text(args.get("text"), args.get("interval", 0.02))
    raise ToolError(f"Unsupported keyboard action: {action}.")


@register("window_control")
def window_control(args: Dict[str, Any]) -> Dict[str, Any]:
    action = str(args.get("action") or "").lower()
    title = str(args.get("title") or "")
    if action == "focus":
        return focus_window(title)
    return _window_action(title, action)


__all__ = [
    "click_at", "double_click", "right_click", "scroll", "type_text", "press_hotkey",
    "focus_window", "minimize_window", "maximize_window", "close_window",
    "gui_click", "gui_type", "window_control",
]