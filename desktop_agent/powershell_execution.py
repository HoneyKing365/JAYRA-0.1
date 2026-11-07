"""Bounded execution for Windows PowerShell scripts."""

from __future__ import annotations

import os
import shutil
from typing import Any, Dict

from .registry import ToolError, register
from .script_execution import _run, _script_args, _script_path


@register("runPowerShellScript")
def run_powershell_script(args: Dict[str, Any]) -> Dict[str, Any]:
    if os.name != "nt":
        raise ToolError("PowerShell script execution is only supported on Windows.")
    script = _script_path(args, ".ps1")
    executable = shutil.which("pwsh") or shutil.which("powershell")
    if not executable:
        raise ToolError("PowerShell was not found on this system.")
    command = [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(script)]
    return _run([*command, *_script_args(args)], script, args)


__all__ = ["run_powershell_script"]