from __future__ import annotations

import unittest
import tempfile
import subprocess
from pathlib import Path
from unittest.mock import patch

from desktop_agent.registry import ToolError
from desktop_agent import tools_applications


class ApplicationDiscoveryTests(unittest.TestCase):
    @patch.object(tools_applications, "_indexed_candidates", return_value=[])
    @patch.object(tools_applications, "_registry_candidates", return_value=[])
    def test_explicit_desktop_shortcut_path_resolves_without_browser_name_rules(self, _registry, _index) -> None:
        with tempfile.TemporaryDirectory() as directory:
            shortcut = Path(directory) / "Project Web App.lnk"
            shortcut.touch()
            found = tools_applications._discover_application(str(shortcut))
        self.assertIsNotNone(found)
        self.assertEqual(found["method"], "shortcut_path")
        self.assertEqual(found["label"], "Project Web App")

    def test_exact_installed_name_beats_similar_name(self) -> None:
        self.assertGreater(
            tools_applications._candidate_score("Steam", "Steam"),
            tools_applications._candidate_score("Steam", "SteamTools"),
        )
        self.assertEqual(tools_applications._candidate_score("Steam", "SteamTools"), 0)
        self.assertEqual(tools_applications._candidate_score("Discord", "Adobe Photoshop"), 0)

    @patch.object(tools_applications, "_launch_via_windows_search")
    @patch.object(tools_applications, "_discover_application", return_value=None)
    @patch.object(
        tools_applications.subprocess,
        "run",
        return_value=subprocess.CompletedProcess([], 1, "", "application not found"),
    )
    def test_unknown_app_uses_windows_search_instead_of_supported_list(self, _run, _discover, search) -> None:
        result = tools_applications.open_application({"name": "A New Installed App"})
        search.assert_called_once_with("A New Installed App")
        self.assertEqual(result["method"], "windows_search_keyboard")

    @patch.object(tools_applications, "_launch_priority_target", return_value="default_browser")
    def test_youtube_uses_direct_default_browser_launch(self, launch) -> None:
        result = tools_applications.open_application({"name": "YouTube"})
        launch.assert_called_once_with("https://www.youtube.com/")
        self.assertEqual(result["method"], "default_browser")

    @patch.object(tools_applications, "_launch_priority_target", side_effect=[
        ToolError("No WhatsApp URI handler"),
        "default_browser",
    ])
    @patch.object(tools_applications, "_discover_application", return_value=None)
    def test_whatsapp_falls_back_from_protocol_to_web_app(self, _discover, launch) -> None:
        result = tools_applications.open_application({"name": "WhatsApp"})
        self.assertEqual(launch.call_args_list, [
            unittest.mock.call("whatsapp:"),
            unittest.mock.call("https://web.whatsapp.com/"),
        ])
        self.assertEqual(result["method"], "default_browser")

    @patch.object(tools_applications, "_launch_discovered")
    @patch.object(tools_applications, "_discover_application")
    def test_discovered_app_is_launched(self, discover, launch) -> None:
        discover.return_value = {"label": "Steam", "path": "C:/Steam/steam.exe", "method": "installed_apps"}
        result = tools_applications.open_application({"name": "Steam"})
        launch.assert_called_once_with(discover.return_value)
        self.assertEqual(result["application"], "Steam")

    @patch.object(tools_applications, "_close_windows_with_keyboard", return_value=1)
    @patch.object(tools_applications, "_matching_windows")
    def test_arbitrary_visible_app_closes_with_keyboard(self, matching, close_windows) -> None:
        matching.return_value = [{"hwnd": 10, "title": "Example App", "score": 1000}]
        result = tools_applications.close_application({"name": "Example App"})
        close_windows.assert_called_once()
        self.assertEqual(result["method"], "keyboard_alt_f4")

    @patch.object(tools_applications, "_matching_windows", return_value=[])
    def test_missing_running_app_reports_search_not_allowlist(self, _matching) -> None:
        with self.assertRaises(ToolError) as caught:
            tools_applications.close_application({"name": "Not Running"})
        self.assertIn("not limited by a supported-app list", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
