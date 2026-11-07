from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from desktop_agent import ui_automation
from desktop_agent.main import app
from desktop_agent.registry import ToolError, TOOLS


class UiAutomationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.gui = SimpleNamespace(
            FAILSAFE=False,
            click=Mock(),
            doubleClick=Mock(),
            scroll=Mock(),
            write=Mock(),
            hotkey=Mock(),
        )
        self.patches = [
            patch.object(ui_automation, "_pyautogui", return_value=self.gui),
            patch.object(ui_automation, "_coordinate", side_effect=lambda args, *names: (int(args.get(names[0] if names else "x", args.get("x"))), int(args.get(names[1] if len(names) > 1 else "y", args.get("y"))))),
            patch.object(ui_automation, "_observation", return_value={"active_window": {"title": "Test"}}),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_mouse_actions_enable_failsafe_and_use_validated_coordinates(self) -> None:
        result = ui_automation.click_at(20, 30, "right")
        self.gui.click.assert_called_once_with(x=20, y=30, button="right")
        self.assertTrue(self.gui.FAILSAFE)
        self.assertTrue(result["success"])

        ui_automation.double_click(40, 50)
        self.gui.doubleClick.assert_called_once()

    def test_keyboard_actions_are_bounded_and_registered(self) -> None:
        result = ui_automation.type_text("hello", interval=0.02)
        self.gui.write.assert_called_once_with("hello", interval=0.02)
        self.assertTrue(result["success"])

        ui_automation.press_hotkey("ctrl", "c")
        self.gui.hotkey.assert_called_once_with("ctrl", "c")
        self.assertTrue({"gui_click", "gui_type", "window_control"}.issubset(TOOLS))

    def test_window_title_miss_returns_a_clean_error_without_os_input(self) -> None:
        with patch.object(ui_automation, "_require_windows"), patch.object(ui_automation, "_find_window_by_title", return_value=None):
            with self.assertRaisesRegex(ToolError, "No visible window"):
                ui_automation.focus_window("missing-window")

    def test_mouse_endpoint_routes_to_validated_action(self) -> None:
        from fastapi.testclient import TestClient

        with patch.object(ui_automation, "click_at", return_value={"success": True, "result": "clicked"}) as click_at:
            response = TestClient(app).post("/automation/mouse", json={"action": "click_at", "x": 5, "y": 6})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
        click_at.assert_called_once_with(5, 6, "left")

    def test_keyboard_and_window_endpoints_route_to_validated_actions(self) -> None:
        from fastapi.testclient import TestClient

        with patch.object(ui_automation, "type_text", return_value={"success": True}) as type_text, patch.object(
            ui_automation, "focus_window", return_value={"success": True}
        ) as focus_window:
            client = TestClient(app)
            keyboard = client.post("/automation/keyboard", json={"action": "type_text", "text": "hello"})
            window = client.post("/automation/window", json={"action": "focus", "title": "Editor"})

        self.assertEqual(keyboard.status_code, 200)
        self.assertEqual(window.status_code, 200)
        type_text.assert_called_once_with("hello", 0.02)
        focus_window.assert_called_once_with("Editor")


if __name__ == "__main__":
    unittest.main()