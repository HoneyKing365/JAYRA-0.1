"""Bounded execution for Python scripts."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from typing import Any, Dict

from .registry import ToolError, register
from .script_execution import _run, _script_args, _script_path


def _detect_python() -> str:
    executable = sys.executable
    if not getattr(sys, "frozen", False) and executable and Path(executable).exists():
        return executable
    for candidate in ("python", "py", "python3"):
        found = shutil.which(candidate)
        if found:
            return found
    raise ToolError("No usable Python interpreter found on this system.")


@register("runPythonScript")
def run_python_script(args: Dict[str, Any]) -> Dict[str, Any]:
    script = _script_path(args, ".py")
    return _run([_detect_python(), str(script), *_script_args(args)], script, args)


__all__ = ["run_python_script"]