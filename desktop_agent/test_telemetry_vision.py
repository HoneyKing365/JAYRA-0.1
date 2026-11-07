from __future__ import annotations

import base64
import unittest
from unittest.mock import patch

from PIL import Image
from fastapi.testclient import TestClient

from desktop_agent import vision_inspector
from desktop_agent.main import app
from desktop_agent.telemetry import collect_system_telemetry


class TelemetryTests(unittest.TestCase):
    def test_live_telemetry_has_cpu_memory_power_disk_and_process_fields(self) -> None:
        result = collect_system_telemetry()

        self.assertTrue(result["success"])
        self.assertIn("usage_percent", result["cpu"])
        self.assertIn("logical_cores", result["cpu"])
        self.assertIn("total_bytes", result["ram"])
        self.assertIn("available_bytes", result["ram"])
        self.assertIn("battery", result)
        self.assertIn("power", result)
        self.assertTrue(result["disks"])
        self.assertLessEqual(len(result["top_processes"]), 5)

    def test_telemetry_http_endpoint(self) -> None:
        client = TestClient(app)
        response = client.get("/telemetry")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
        tool_response = client.post("/execute", json={"tool": "getSystemTelemetry", "args": {}})
        self.assertEqual(tool_response.status_code, 200)
        self.assertTrue(tool_response.json()["ok"])
        self.assertTrue(tool_response.json()["result"]["success"])


class VisionInspectorTests(unittest.TestCase):
    def test_capture_excludes_jayra_foreground_and_returns_jpeg_base64(self) -> None:
        image = Image.new("RGB", (1600, 900), color="white")
        with patch.object(vision_inspector, "_active_window_title", return_value="JAYRA"), patch.object(
            vision_inspector, "_capture_active_display", return_value=(image, "Desktop")
        ) as capture_display:
            result = vision_inspector.capture_vision_frame({
                "prompt": "Read the visible error.",
                "target": "active_window",
                "max_dim": 1280,
            })

        self.assertTrue(result["success"])
        self.assertTrue(result["excluded_own_window"])
        self.assertEqual(result["active_window"], "Desktop")
        self.assertLessEqual(result["width"], 1280)
        self.assertTrue(base64.b64decode(result["image_base64"]).startswith(b"\xff\xd8"))
        capture_display.assert_called_once()

    def test_inspect_endpoint_returns_graceful_capture_error(self) -> None:
        with patch.object(vision_inspector, "capture_vision_frame", return_value={"success": False, "error": "capture denied"}):
            response = TestClient(app).post("/vision/inspect", json={"prompt": "Inspect this screen."})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["success"], False)
        self.assertEqual(response.json()["error"], "capture denied")


if __name__ == "__main__":
    unittest.main()