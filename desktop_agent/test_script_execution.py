from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_agent import script_execution
from desktop_agent.python_execution import run_python_script
from desktop_agent.powershell_execution import run_powershell_script
from desktop_agent.registry import ToolError


class ScriptExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir=Path.cwd())
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_python_result_captures_both_streams_and_exit_code(self) -> None:
        script = self.root / "sample.py"
        script.write_text("import sys\nprint('out')\nprint('err', file=sys.stderr)\nsys.exit(3)\n", encoding="utf-8")

        result = run_python_script({"path": str(script)})

        self.assertEqual(result, {
            "success": False,
            "stdout": "out\n",
            "stderr": "err\n",
            "exitCode": 3,
        })

    def test_timeout_is_reported_as_failure(self) -> None:
        script = self.root / "slow.py"
        script.write_text("import time\ntime.sleep(5)\n", encoding="utf-8")

        result = run_python_script({"path": str(script), "timeout": 1})

        self.assertFalse(result["success"])
        self.assertEqual(result["exitCode"], -1)
        self.assertIn("exceeded 1s", result["stderr"])

    def test_runner_rejects_non_py_extension(self) -> None:
        script = self.root / "sample.txt"
        script.write_text("not a script", encoding="utf-8")

        with self.assertRaises(ToolError):
            run_python_script({"path": str(script)})

    def test_timeout_is_capped_at_thirty_seconds(self) -> None:
        script = self.root / "sample.py"
        script.write_text("print('ok')\n", encoding="utf-8")

        with patch.object(script_execution.subprocess, "Popen") as popen:
            popen.return_value.communicate.return_value = ("ok\n", "")
            popen.return_value.returncode = 0
            result = run_python_script({"path": str(script), "timeout": 300})

        self.assertTrue(result["success"])
        self.assertEqual(popen.return_value.communicate.call_args.kwargs["timeout"], 30)

    @unittest.skipUnless(shutil.which("powershell") or shutil.which("pwsh"), "PowerShell is unavailable")
    def test_powershell_result_captures_output(self) -> None:
        script = self.root / "sample.ps1"
        script.write_text("Write-Output 'hello from powershell'\n", encoding="utf-8")

        result = run_powershell_script({"path": str(script)})

        self.assertTrue(result["success"])
        self.assertIn("hello from powershell", result["stdout"])


if __name__ == "__main__":
    unittest.main()