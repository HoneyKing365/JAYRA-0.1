from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_agent.registry import ToolError
from desktop_agent.tools_files import _ensure_safe, is_protected_system_path


class ProtectedPathTests(unittest.TestCase):
    def test_detects_windows_and_program_files_roots(self) -> None:
        self.assertTrue(is_protected_system_path(r"C:\Windows\System32\drivers\etc\hosts"))
        self.assertTrue(is_protected_system_path(r"C:\Program Files\JAYRA\app.exe"))
        self.assertTrue(is_protected_system_path(r"C:\ProgramData\service\state.json"))
        self.assertFalse(is_protected_system_path(r"C:\Users\Person\Documents\notes.txt"))

    def test_allow_anywhere_does_not_bypass_protected_roots_without_admin_override(self) -> None:
        protected = Path(r"C:\Windows\System32\drivers\etc\hosts")
        with patch.dict(os.environ, {"JAYRA_ALLOW_PROTECTED_SYSTEM_PATHS": "1"}), patch("desktop_agent.tools_files._is_system_admin", return_value=False):
            with self.assertRaisesRegex(ToolError, "Protected system path"):
                _ensure_safe(protected, allow_anywhere=True)

    def test_protected_root_override_requires_admin_and_explicit_configuration(self) -> None:
        protected = Path(r"C:\Program Files\JAYRA\app.exe")
        with patch.dict(os.environ, {"JAYRA_ALLOW_PROTECTED_SYSTEM_PATHS": "true"}), patch("desktop_agent.tools_files._is_system_admin", return_value=True):
            _ensure_safe(protected, allow_anywhere=True)
        with patch.dict(os.environ, {"JAYRA_ALLOW_PROTECTED_SYSTEM_PATHS": "false"}), patch("desktop_agent.tools_files._is_system_admin", return_value=True):
            with self.assertRaisesRegex(ToolError, "Protected system path"):
                _ensure_safe(protected, allow_anywhere=True)


if __name__ == "__main__":
    unittest.main()