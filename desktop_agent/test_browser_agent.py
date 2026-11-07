from __future__ import annotations

import asyncio
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from desktop_agent.browser_agent import BrowserAgent
from desktop_agent.main import app
from desktop_agent.registry import ToolError, TOOLS


def _chromium_installed() -> bool:
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            return Path(playwright.chromium.executable_path).is_file()
    except Exception:
        return False


class _PageHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"""<!doctype html><title>JAYRA Browser Test</title>
        <label for='query'>Search term</label><input id='query'>
        <button id='submit' onclick=\"document.querySelector('#result').textContent=document.querySelector('#query').value\">Submit</button>
        <p id='result'>Ready</p>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


@unittest.skipUnless(_chromium_installed(), "Playwright Chromium is not installed")
class BrowserAgentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _PageHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.agent = BrowserAgent()
        self.url = f"http://127.0.0.1:{self.server.server_port}/"

    async def asyncTearDown(self) -> None:
        await self.agent.close()
        await asyncio.to_thread(self.server.shutdown)
        self.server.server_close()
        self.thread.join(timeout=2)

    async def test_headless_navigation_fill_click_and_extraction(self) -> None:
        opened = await self.agent.perform({"action": "navigate_to", "url": self.url})
        self.assertTrue(opened["success"])
        self.assertTrue(opened["headless"])
        self.assertEqual(opened["title"], "JAYRA Browser Test")

        await self.agent.perform({"action": "fill_field", "selector_or_text": "Search term", "value": "visible result"})
        await self.agent.perform({"action": "click_element", "selector_or_text": "Submit"})
        extracted = await self.agent.perform({"action": "extract_page_text"})
        self.assertIn("visible result", extracted["text"])
        content = await self.agent.perform({"action": "get_page_content"})
        self.assertIn("JAYRA Browser Test", content["html"])
        image = await self.agent.perform({"action": "take_page_screenshot"})
        self.assertEqual(image["image_mime"], "image/jpeg")
        await self.agent.perform({"action": "close"})

    async def test_rejects_non_http_navigation(self) -> None:
        with self.assertRaisesRegex(ToolError, "http:// or https://"):
            await self.agent.perform({"action": "navigate_to", "url": "file:///C:/Windows/win.ini"})

    def test_browser_tool_registered(self) -> None:
        self.assertIn("browser_control", TOOLS)

    def test_browser_action_endpoint(self) -> None:
        from fastapi.testclient import TestClient

        with TestClient(app) as client:
            response = client.post("/browser/action", json={"action": "navigate_to", "url": self.url})
            result = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(result["success"])
        self.assertTrue(result["headless"])
        self.assertEqual(result["title"], "JAYRA Browser Test")


if __name__ == "__main__":
    unittest.main()