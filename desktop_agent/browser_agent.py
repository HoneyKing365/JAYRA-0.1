"""Async, bounded Chromium browser control for background web tasks."""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict
from urllib.parse import quote_plus, urlparse

from .registry import ToolError, register

log = logging.getLogger("jayra.browser")


class BrowserAgent:
    def __init__(self) -> None:
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None
        self._headless: bool | None = None
        self._lock = asyncio.Lock()

    async def perform(self, args: Dict[str, Any]) -> Dict[str, Any]:
        action = str(args.get("action") or "").strip().lower()
        allowed = {"navigate_to", "search_web", "click_element", "fill_field", "extract_page_text", "get_page_content", "take_page_screenshot", "close"}
        if action not in allowed:
            raise ToolError(f"Unsupported browser action: {action or '(empty)'}.")
        if action in {"navigate_to", "search_web"}:
            self._ensure_url_or_query(action, args)

        requested_headless = args.get("headless")
        if requested_headless is not None and not isinstance(requested_headless, bool):
            raise ToolError("headless must be a boolean.")
        headless = requested_headless if requested_headless is not None else (self._headless if self._headless is not None else True)
        timeout_ms = _bounded_timeout(args.get("timeout_ms", 8_000))

        async with self._lock:
            if action == "close":
                await self._close_unlocked()
                return {"success": True, "action": action, "result": "Browser closed."}
            await self._ensure_started(headless)
            try:
                result = await self._dispatch(action, args, timeout_ms)
            except ToolError:
                raise
            except Exception as error:
                message = str(error)
                if "Timeout" in error.__class__.__name__ or "Timeout" in message:
                    raise ToolError(f"Playwright {action} timed out after {timeout_ms} ms: {message}") from error
                raise ToolError(f"Playwright {action} failed: {message}") from error
            log.info("[JAYRA Browser] action=%s headless=%s completed.", action, headless)
            return {"success": True, "action": action, "headless": headless, **result}

    async def close(self) -> None:
        async with self._lock:
            await self._close_unlocked()

    async def _ensure_started(self, headless: bool) -> None:
        if self._browser is not None and self._browser.is_connected() and self._headless == headless:
            if self._page is not None and not self._page.is_closed():
                return
            self._page = await self._context.new_page()
            return
        await self._close_unlocked()
        if getattr(sys, "frozen", False):
            bundle_root = Path(getattr(sys, "_MEIPASS", ""))
            bundled_browsers = bundle_root / "playwright-browsers"
            if bundled_browsers.is_dir():
                os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(bundled_browsers))
        try:
            from playwright.async_api import async_playwright
        except ImportError as error:
            raise ToolError("Playwright is not installed. Install desktop_agent/requirements.txt and run `python -m playwright install chromium`.") from error
        try:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(headless=headless)
            self._context = await self._browser.new_context()
            self._page = await self._context.new_page()
            self._headless = headless
        except Exception as error:
            await self._close_unlocked()
            message = str(error)
            if "Executable doesn't exist" in message or "playwright install" in message.lower():
                raise ToolError("Chromium is not installed for Playwright. Run `python -m playwright install chromium`.") from error
            raise ToolError(f"Could not start Chromium: {message}") from error

    async def _dispatch(self, action: str, args: Dict[str, Any], timeout_ms: int) -> Dict[str, Any]:
        page = self._page
        if page is None:
            raise ToolError("Browser page is unavailable.")
        if action == "navigate_to":
            url = _http_url(str(args.get("url") or ""))
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            return await self._page_summary()
        if action == "search_web":
            query = str(args.get("query") or "").strip()
            if not query or len(query) > 500:
                raise ToolError("Search query must contain 1 to 500 characters.")
            await page.goto(f"https://www.google.com/search?q={quote_plus(query)}", wait_until="domcontentloaded", timeout=timeout_ms)
            return await self._page_summary()
        if action == "click_element":
            target = _required_target(args)
            locator = await self._find_locator(target, timeout_ms)
            await locator.click(timeout=timeout_ms)
            return {"url": page.url, "title": await page.title(), "clicked": target}
        if action == "fill_field":
            target = _required_target(args)
            value = args.get("value")
            if not isinstance(value, str) or len(value) > 20_000:
                raise ToolError("Field value must be a string of at most 20,000 characters.")
            locator = await self._find_locator(target, timeout_ms, field=True)
            await locator.fill(value, timeout=timeout_ms)
            return {"url": page.url, "title": await page.title(), "filled": target}
        if action == "extract_page_text":
            text = await page.locator("body").inner_text(timeout=timeout_ms)
            return {"url": page.url, "title": await page.title(), "text": text[:20_000]}
        if action == "get_page_content":
            content = await page.content()
            return {"url": page.url, "title": await page.title(), "html": content[:40_000]}
        if action == "take_page_screenshot":
            image = await page.screenshot(type="jpeg", quality=75, full_page=False, timeout=timeout_ms)
            return {"url": page.url, "title": await page.title(), "image_mime": "image/jpeg", "image_base64": base64.b64encode(image).decode("ascii")}
        raise ToolError(f"Unsupported browser action: {action}.")

    async def _find_locator(self, target: str, timeout_ms: int, field: bool = False):
        page = self._page
        candidates = [page.locator(target)]
        if field:
            candidates.insert(0, page.get_by_label(target, exact=True))
        candidates.append(page.get_by_text(target, exact=True))
        for locator in candidates:
            try:
                if await locator.count() and await locator.first.is_visible():
                    return locator.first
            except Exception:
                continue
        raise ToolError(f"No visible browser element matched selector or text '{target}'.")

    async def _page_summary(self) -> Dict[str, Any]:
        return {"url": self._page.url, "title": await self._page.title()}

    async def _close_unlocked(self) -> None:
        if self._browser is not None:
            try:
                await self._browser.close()
            except Exception:
                pass
        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                pass
        self._playwright = self._browser = self._context = self._page = None
        self._headless = None

    @staticmethod
    def _ensure_url_or_query(action: str, args: Dict[str, Any]) -> None:
        if action == "navigate_to":
            _http_url(str(args.get("url") or ""))


def _required_target(args: Dict[str, Any]) -> str:
    target = str(args.get("selector_or_text") or "").strip()
    if not target or len(target) > 500:
        raise ToolError("selector_or_text must contain 1 to 500 characters.")
    return target


def _http_url(value: str) -> str:
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ToolError("Browser navigation only supports valid http:// or https:// URLs.")
    if len(url) > 4_000:
        raise ToolError("URL is too long.")
    return url


def _bounded_timeout(value: Any) -> int:
    try:
        return max(1_000, min(30_000, int(value)))
    except (TypeError, ValueError) as error:
        raise ToolError("timeout_ms must be an integer.") from error


browser_agent = BrowserAgent()


@register("browser_control")
async def browser_control(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_agent.perform(args)


async def close_browser_agent() -> None:
    await browser_agent.close()


__all__ = ["BrowserAgent", "browser_agent", "browser_control", "close_browser_agent"]