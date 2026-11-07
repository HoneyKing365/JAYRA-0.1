from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from desktop_agent import gateway, main


class GatewayTests(unittest.TestCase):
    token = "test-gateway-token-with-at-least-32-characters"

    def request(self, method: str, path: str, *, client_host: str, headers: dict[str, str] | None = None, body: dict | None = None) -> httpx.Response:
        async def send() -> httpx.Response:
            transport = httpx.ASGITransport(app=main.app, client=(client_host, 43210))
            async with httpx.AsyncClient(transport=transport, base_url="http://gateway.test") as client:
                return await client.request(method, path, headers=headers, json=body)

        return asyncio.run(send())

    def test_network_binding_is_disabled_by_default_and_configurable(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(gateway.network_access_enabled())
            self.assertEqual(gateway.agent_bind_host(), "127.0.0.1")
            self.assertEqual(gateway.agent_port(), 8765)
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true"}, clear=True):
            self.assertEqual(gateway.agent_bind_host(), "0.0.0.0")
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true", "JAYRA_AGENT_HOST": "192.168.1.20", "JAYRA_AGENT_PORT": "9001"}, clear=True):
            self.assertEqual(gateway.agent_bind_host(), "192.168.1.20")
            self.assertEqual(gateway.agent_port(), 9001)

    def test_gateway_token_is_generated_and_persisted_when_not_configured(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            token_path = Path(directory) / "gateway.token"
            with patch.object(gateway, "_TOKEN_CACHE", None), patch.object(gateway, "_token_file", return_value=token_path), patch.dict(os.environ, {}, clear=True):
                token = gateway.get_gateway_token()
                self.assertGreaterEqual(len(token), 32)
                self.assertEqual(token_path.read_text(encoding="ascii"), token)

    def test_remote_browser_origins_require_https(self) -> None:
        self.assertTrue(gateway.is_secure_browser_origin("https://tablet.example.test"))
        self.assertTrue(gateway.is_secure_browser_origin("http://localhost:3000"))
        self.assertFalse(gateway.is_secure_browser_origin("http://192.168.1.42:3000"))

    def test_remote_request_without_token_is_rejected(self) -> None:
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true", "JAYRA_GATEWAY_TOKEN": self.token}, clear=True):
            response = self.request("GET", "/gateway/status", client_host="192.168.1.42")
        self.assertEqual(response.status_code, 401)

    def test_valid_remote_token_cannot_call_legacy_tool_dispatch(self) -> None:
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true", "JAYRA_GATEWAY_TOKEN": self.token}, clear=True):
            response = self.request(
                "POST",
                "/execute",
                client_host="192.168.1.42",
                headers={"X-JAYRA-Token": self.token},
                body={"tool": "deleteFile", "args": {"path": "C:/Users/test/notes.txt"}},
            )
        self.assertEqual(response.status_code, 403)

    def test_remote_request_with_token_receives_gateway_status(self) -> None:
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true", "JAYRA_GATEWAY_TOKEN": self.token}, clear=True):
            response = self.request(
                "GET",
                "/gateway/status",
                client_host="192.168.1.42",
                headers={"X-JAYRA-Token": self.token},
            )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["name"], "JAYRA Desktop Control Agent")
        self.assertIn("metrics", payload)

    def test_loopback_requests_remain_unauthenticated(self) -> None:
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true"}, clear=True), patch.object(
            main, "forward_command_to_node", return_value={"ok": True, "taskId": "task-1"}
        ):
            response = self.request(
                "POST",
                "/gateway/command",
                client_host="127.0.0.1",
                body={"prompt": "Open Notepad"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["taskId"], "task-1")

    def test_remote_command_forwards_only_to_local_node_pipeline(self) -> None:
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true", "JAYRA_GATEWAY_TOKEN": self.token}, clear=True), patch.object(
            main, "forward_command_to_node", return_value={"ok": True, "taskId": "task-remote"}
        ) as forward:
            response = self.request(
                "POST",
                "/gateway/command",
                client_host="192.168.1.42",
                headers={"Authorization": f"Bearer {self.token}"},
                body={"prompt": "Open Notepad"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["taskId"], "task-remote")
        forward.assert_called_once_with({"prompt": "Open Notepad"})

    def test_remote_tool_request_is_forwarded_with_arguments(self) -> None:
        command = {"tool": "systemInfo", "args": {"detail": "summary"}}
        with patch.dict(os.environ, {"JAYRA_NETWORK_ACCESS": "true", "JAYRA_GATEWAY_TOKEN": self.token}, clear=True), patch.object(
            main, "forward_command_to_node", return_value={"success": True, "result": {"os": "Windows"}}
        ) as forward:
            response = self.request(
                "POST",
                "/gateway/command",
                client_host="192.168.1.42",
                headers={"X-JAYRA-Token": self.token},
                body=command,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result"]["os"], "Windows")
        forward.assert_called_once_with(command)

    def test_network_disabled_rejects_non_loopback_requests(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            response = self.request("GET", "/gateway/status", client_host="192.168.1.42")
        self.assertEqual(response.status_code, 403)

    def test_mobile_route_serves_the_control_page(self) -> None:
        response = self.request("GET", "/mobile", client_host="testclient")
        self.assertEqual(response.status_code, 200)
        self.assertIn("JAYRA Mobile Control", response.text)
        self.assertIn("/gateway/command", response.text)

    def test_mobile_pwa_manifest_icon_and_worker_are_served(self) -> None:
        manifest = self.request("GET", "/manifest.webmanifest", client_host="testclient")
        icon = self.request("GET", "/mobile-icon.svg", client_host="testclient")
        worker = self.request("GET", "/mobile-sw.js", client_host="testclient")
        self.assertEqual(manifest.status_code, 200)
        self.assertEqual(manifest.json()["short_name"], "JAYRA")
        self.assertEqual(icon.status_code, 200)
        self.assertIn("<svg", icon.text)
        self.assertEqual(worker.status_code, 200)
        self.assertIn("/gateway/", worker.text)

    def test_remote_upload_and_download_preserve_bytes_and_sanitize_name(self) -> None:
        content = b"jayra remote file payload\x00\x01"
        with tempfile.TemporaryDirectory() as directory, patch.object(
            gateway, "remote_upload_directory", return_value=Path(directory) / "remote_uploads"
        ):
            async def upload() -> httpx.Response:
                transport = httpx.ASGITransport(app=main.app, client=("testclient", 43210))
                async with httpx.AsyncClient(transport=transport, base_url="http://gateway.test") as client:
                    return await client.post("/gateway/upload", files={"file": ("..\\private report.txt", content, "text/plain")})

            uploaded = asyncio.run(upload())
            self.assertEqual(uploaded.status_code, 200)
            details = uploaded.json()
            self.assertNotIn("/", details["name"])
            self.assertNotIn("\\", details["name"])
            downloaded = self.request("GET", f"/gateway/download?name={details['name']}", client_host="testclient")
            self.assertEqual(downloaded.status_code, 200)
            self.assertEqual(downloaded.content, content)

    def test_sse_route_delivers_node_events(self) -> None:
        frame = b'data: {"type":"task.updated","payload":{"goal":"Mobile task"}}\n\n'

        def event_lines():
            yield frame

        with patch.object(main, "iter_node_events", event_lines):
            response = self.request("GET", "/gateway/stream", client_host="testclient")
        self.assertEqual(response.status_code, 200)
        self.assertIn(": connected", response.text)
        self.assertIn("Mobile task", response.text)

    def test_mobile_approval_is_forwarded_to_node_confirmation_broker(self) -> None:
        decision = {"confirmation_id": "approval-1", "approved": True}
        with patch.object(main, "forward_approval_to_node", return_value={"ok": True, "outcome": {"success": True}}) as forward:
            response = self.request("POST", "/gateway/approval", client_host="testclient", body=decision)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["outcome"]["success"])
        forward.assert_called_once_with("approval-1", True)


if __name__ == "__main__":
    unittest.main()