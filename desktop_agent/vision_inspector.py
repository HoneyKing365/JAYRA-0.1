"""High-resolution screen capture payloads for Node's configured vision model."""

from __future__ import annotations

import base64
import io
import logging
from typing import Any, Dict

from .registry import ToolError
from .tools_screenshot import (
    _active_window_bbox,
    _active_window_title,
    _capture,
    _capture_active_display,
    _capture_region,
    _is_myraa_window,
)

log = logging.getLogger("jayra.vision")


def capture_vision_frame(args: Dict[str, Any]) -> Dict[str, Any]:
    from PIL import Image

    prompt = str(args.get("prompt") or "Inspect the visible screen and describe the relevant UI.").strip()
    target = str(args.get("target") or "active_screen").strip().lower()
    max_dim = max(640, min(2560, int(args.get("max_dim", 1920))))
    quality = max(50, min(95, int(args.get("quality", 85))))
    started = __import__("time").perf_counter()
    active_title = _active_window_title()

    try:
        if target == "active_window" and not _is_myraa_window(active_title):
            bounds = _active_window_bbox()
            image = _capture_region(bounds) if bounds else _capture_active_display()[0]
            title = active_title
        elif target == "primary_screen" and not _is_myraa_window(active_title):
            image = _capture_primary_screen()
            title = active_title
        else:
            image, title = _capture_active_display()

        scale = min(1.0, max_dim / max(image.width, image.height))
        if scale < 1.0:
            image = image.resize(
                (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                Image.Resampling.LANCZOS,
            )
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=quality, optimize=True)
        elapsed_ms = round((__import__("time").perf_counter() - started) * 1000)
        log.info("[JAYRA Vision] Screenshot captured (%dx%d, %d ms).", image.width, image.height, elapsed_ms)
        return {
            "success": True,
            "prompt": prompt,
            "active_window": title or active_title or None,
            "width": image.width,
            "height": image.height,
            "image_mime": "image/jpeg",
            "image_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "duration_ms": elapsed_ms,
            "excluded_own_window": _is_myraa_window(active_title),
        }
    except (ToolError, OSError, ValueError) as error:
        return {
            "success": False,
            "error": f"Screen capture unavailable: {error}",
            "active_window": active_title or None,
            "image_base64": None,
        }


def _capture_primary_screen() -> Any:
    try:
        import win32api
        import win32con

        width = win32api.GetSystemMetrics(win32con.SM_CXSCREEN)
        height = win32api.GetSystemMetrics(win32con.SM_CYSCREEN)
        return _capture_region((0, 0, width, height))
    except Exception:
        return _capture()


__all__ = ["capture_vision_frame"]