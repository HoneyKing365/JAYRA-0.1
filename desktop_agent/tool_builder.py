"""
JAYRA Desktop Control Agent — Autonomous Tool Builder & Sandbox Runner.

Provides a self-coding agent loop that:
1. Validates proposed tool source code via AST analysis.
2. Executes dry-run test cases in an isolated subprocess sandbox.
3. Compiles, hot-loads, and persists newly generated tools into the sidecar.
4. Supports listing, inspecting, and deleting generated tools.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .registry import CUSTOM_TOOL_METADATA, TOOLS, ToolError, load_custom_tools
from .tool_generator import (
    CUSTOM_TOOLS_DIR,
    build_tool_source,
    validate_tool_source,
    write_tool,
)

log = logging.getLogger("jayra.desktop")


def execute_sandboxed(
    code: str,
    entry_point: str = "main",
    test_input: Optional[Dict[str, Any]] = None,
    timeout_sec: float = 5.0,
) -> Dict[str, Any]:
    """Execute Python code in an isolated subprocess with strict timeouts.

    Returns execution results including stdout, stderr, returned payload,
    and runtime performance.
    """
    if not code or not code.strip():
        return {"ok": False, "error": "Code body cannot be empty."}

    runner_script = f"""
import sys, json, traceback

# Injected code under test:
{code}

# Test harness:
try:
    args = json.loads({json.dumps(json.dumps(test_input or {}))})
    fn = globals().get({json.dumps(entry_point)})
    if callable(fn):
        res = fn(**args) if isinstance(args, dict) else fn()
    else:
        res = {{"executed": True}}
    print("__OUTPUT_START__")
    print(json.dumps({{"ok": True, "result": res}}))
except Exception as exc:
    print("__OUTPUT_START__")
    print(json.dumps({{"ok": False, "error": str(exc), "traceback": traceback.format_exc()}}))
"""

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_file = Path(temp_dir) / "sandbox_test.py"
        temp_file.write_text(runner_script, encoding="utf-8")

        start_time = time.perf_counter()
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(temp_file)],
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                cwd=temp_dir,
                env={
                    "PYTHONPATH": "",
                    "SYSTEMROOT": os.environ.get("SYSTEMROOT", "C:\\Windows"),
                    "PATH": os.environ.get("PATH", ""),
                },
            )
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

            stdout = proc.stdout
            stderr = proc.stderr

            if "__OUTPUT_START__" in stdout:
                parts = stdout.split("__OUTPUT_START__", 1)
                printed_log = parts[0].strip()
                try:
                    payload = json.loads(parts[1].strip())
                    return {
                        "ok": payload.get("ok", False),
                        "result": payload.get("result"),
                        "error": payload.get("error"),
                        "traceback": payload.get("traceback"),
                        "stdout": printed_log,
                        "stderr": stderr.strip(),
                        "exit_code": proc.returncode,
                        "latency_ms": elapsed_ms,
                    }
                except Exception as parse_err:
                    return {
                        "ok": False,
                        "error": f"Failed to parse test harness output: {parse_err}",
                        "stdout": stdout,
                        "stderr": stderr,
                        "exit_code": proc.returncode,
                        "latency_ms": elapsed_ms,
                    }

            if proc.returncode != 0:
                return {
                    "ok": False,
                    "error": stderr.strip() or f"Process exited with code {proc.returncode}",
                    "stdout": stdout.strip(),
                    "stderr": stderr.strip(),
                    "exit_code": proc.returncode,
                    "latency_ms": elapsed_ms,
                }

            return {
                "ok": True,
                "result": stdout.strip(),
                "exit_code": proc.returncode,
                "latency_ms": elapsed_ms,
            }

        except subprocess.TimeoutExpired:
            return {
                "ok": False,
                "error": f"Sandbox execution timed out after {timeout_sec} seconds.",
                "timeout": True,
            }
        except Exception as exc:
            return {"ok": False, "error": f"Sandbox execution error: {exc}"}


def test_and_build_tool(
    spec: Dict[str, Any],
    test_cases: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Autonomous tool compilation and verification pipeline.

    1. Validates AST safety and signatures.
    2. Runs sandboxed unit test cases if provided.
    3. Atomically writes and registers the tool into live memory.
    """
    name = str(spec.get("name") or "").strip()
    if not name:
        return {"ok": False, "error": "Tool specification must include 'name'."}

    # 1. Synthesize and validate source
    try:
        source, metadata = build_tool_source(spec)
    except ToolError as err:
        return {"ok": False, "error": f"Tool validation error: {err.message}"}
    except Exception as exc:
        return {"ok": False, "error": f"Tool build error: {exc}"}

    # 2. Run sandboxed verification if test cases are provided
    test_results: List[Dict[str, Any]] = []
    if test_cases:
        for idx, tc in enumerate(test_cases):
            inp = tc.get("input", {})
            expected = tc.get("expected")
            test_res = execute_sandboxed(
                code=source,
                entry_point=name,
                test_input=inp,
                timeout_sec=5.0,
            )
            passed = test_res.get("ok", False)
            if passed and expected is not None:
                passed = test_res.get("result") == expected

            test_results.append({
                "test_index": idx,
                "input": inp,
                "passed": passed,
                "output": test_res.get("result"),
                "error": test_res.get("error"),
            })

            if not passed:
                return {
                    "ok": False,
                    "error": f"Unit test #{idx + 1} failed: {test_res.get('error') or 'Result mismatch'}",
                    "test_results": test_results,
                    "generated_source": source,
                }

    # 3. Write tool atomically and load into live runtime
    try:
        target, written_meta = write_tool(spec)
        loaded = load_custom_tools()
        if name not in loaded:
            target.unlink(missing_ok=True)
            return {"ok": False, "error": "Tool failed to hot-load into live registry."}

        log.info("[JAYRA Self-Coder] Successfully built and deployed tool: %s", name)
        return {
            "ok": True,
            "tool": CUSTOM_TOOL_METADATA.get(name, written_meta),
            "path": str(target),
            "test_results": test_results,
            "generated_source": source,
        }
    except ToolError as err:
        return {"ok": False, "error": err.message}
    except Exception as exc:
        return {"ok": False, "error": f"Failed to persist tool: {exc}"}


def list_custom_tools() -> List[Dict[str, Any]]:
    """List all registered custom tools and their schemas."""
    tools_list = []
    for name, meta in CUSTOM_TOOL_METADATA.items():
        file_path = CUSTOM_TOOLS_DIR / f"{name}.py"
        tools_list.append({
            "name": name,
            "description": meta.get("description", ""),
            "arguments_schema": meta.get("arguments_schema", {}),
            "path": str(file_path) if file_path.exists() else None,
        })
    return tools_list


def delete_custom_tool(name: str) -> Dict[str, Any]:
    """Remove a custom tool from disk and unregister it from memory."""
    if not name or name not in CUSTOM_TOOL_METADATA:
        return {"ok": False, "error": f"Custom tool '{name}' not found."}

    file_path = CUSTOM_TOOLS_DIR / f"{name}.py"
    if file_path.exists():
        try:
            file_path.unlink()
        except OSError as exc:
            return {"ok": False, "error": f"Failed to delete file {file_path}: {exc}"}

    TOOLS.pop(name, None)
    CUSTOM_TOOL_METADATA.pop(name, None)
    log.info("[JAYRA Tool Builder] Unloaded and removed custom tool: %s", name)
    return {"ok": True, "result": f"Tool '{name}' removed successfully."}
