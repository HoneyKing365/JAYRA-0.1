"""Shared safety and subprocess helpers for script runners."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from .registry import ToolError
from .tools_files import _ensure_safe

MAX_EXECUTION_SECONDS = 30


def _script_path(args: Dict[str, Any], extension: str) -> Path:
    supplied = args.get("path")
    if not supplied:
        raise ToolError("Parameter 'path' (script path) is required.")
    script = Path(os.path.expandvars(os.path.expanduser(str(supplied)))).resolve()
    _ensure_safe(script, bool(args.get("allow_anywhere", False)))
    if script.suffix.lower() != extension:
        raise ToolError(f"Script path must end in {extension}.")
    if not script.is_file():
        raise ToolError(f"Script does not exist: {script}")
    return script


def _script_args(args: Dict[str, Any]) -> List[str]:
    supplied = args.get("args") or []
    if isinstance(supplied, str):
        supplied = [supplied]
    if not isinstance(supplied, list):
        raise ToolError("Parameter 'args' must be a list of strings.")
    return [str(value) for value in supplied]


def _run(cmd: List[str], script: Path, args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        timeout = min(MAX_EXECUTION_SECONDS, max(1, int(args.get("timeout", MAX_EXECUTION_SECONDS))))
    except (TypeError, ValueError):
        timeout = MAX_EXECUTION_SECONDS

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(script.parent),
        shell=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        exit_code = process.returncode
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                    check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
        else:
            process.kill()
        stdout, stderr = process.communicate()
        stderr += f"\nExecution exceeded {timeout}s and was terminated."
        exit_code = -1

    return {
        "success": exit_code == 0,
        "stdout": stdout[:8000] + ("...[truncated]" if len(stdout) > 8000 else ""),
        "stderr": stderr[:4000] + ("...[truncated]" if len(stderr) > 4000 else ""),
        "exitCode": exit_code,
    }


__all__ = ["_run", "_script_args", "_script_path"]