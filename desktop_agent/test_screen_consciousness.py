from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from desktop_agent import main
from desktop_agent.screen_consciousness import ScreenConsciousnessMonitor


class ScreenConsciousnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)
        self.monitor = ScreenConsciousnessMonitor(poll_interval_sec=1.0, cooldown_sec=10.0)

    def tearDown(self) -> None:
        self.monitor.stop()

    def test_probe_returns_none_when_no_error(self) -> None:
        with patch("platform.system", return_value="Windows"):
            with patch("win32gui.GetForegroundWindow", return_value=12345):
                with patch("win32gui.GetWindowText", return_value="Google Chrome - Document"):
                    with patch("win32gui.GetClassName", return_value="Chrome_WidgetWin_1"):
                        with patch("win32process.GetWindowThreadProcessId", return_value=(0, 9999)):
                            alert = self.monitor.probe_active_window()
                            self.assertIsNone(alert)

    def test_probe_detects_system_error_dialog(self) -> None:
        with patch("platform.system", return_value="Windows"):
            with patch("win32gui.GetForegroundWindow", return_value=54321):
                with patch("win32gui.GetWindowText", return_value="Application Error"):
                    with patch("win32gui.GetClassName", return_value="#32770"):
                        with patch("win32process.GetWindowThreadProcessId", return_value=(0, 8888)):
                            def fake_enum_child(_hwnd, callback, _lparam):
                                with patch("win32gui.GetWindowText", return_value="The memory could not be read (0x00000005)."):
                                    callback(111, None)
                                return True

                            with patch("win32gui.EnumChildWindows", side_effect=fake_enum_child):
                                alert = self.monitor.probe_active_window()
                                self.assertIsNotNone(alert)
                                self.assertEqual(alert["severity"], "critical")
                                self.assertEqual(alert["title"], "Application Error")
                                self.assertIn("memory could not be read", alert["message"])
                                self.assertTrue(alert["is_dialog"])
                                self.assertIn("Dhyan dijiye", alert["voice_text"])

    def test_cooldown_prevents_duplicate_alert(self) -> None:
        with patch("platform.system", return_value="Windows"):
            with patch("win32gui.GetForegroundWindow", return_value=54321):
                with patch("win32gui.GetWindowText", return_value="Fatal Crash"):
                    with patch("win32gui.GetClassName", return_value="#32770"):
                        with patch("win32process.GetWindowThreadProcessId", return_value=(0, 8888)):
                            alert1 = self.monitor.probe_active_window()
                            self.assertIsNotNone(alert1)
                            # Second probe immediately for same window
                            alert2 = self.monitor.probe_active_window()
                            self.assertIsNone(alert2)

    def test_api_endpoints(self) -> None:
        state_resp = self.client.get("/consciousness/state")
        self.assertEqual(state_resp.status_code, 200)
        self.assertIn("running", state_resp.json())

        probe_resp = self.client.post("/consciousness/probe")
        self.assertEqual(probe_resp.status_code, 200)
        self.assertIn("alert", probe_resp.json())


if __name__ == "__main__":
    unittest.main()
