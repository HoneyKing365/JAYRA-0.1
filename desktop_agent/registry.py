"""
JAYRA Desktop Control Agent — Central tool registry.

Each tool module registers handlers into a flat dict `TOOLS` mapping
tool_name -> callable(args: dict) -> dict.

Handlers return a plain dict, typically {"result": "<status string>"}.
Errors should raise ToolError(message) so main.py can map them to {error}.
Shared state such as confirmation tokens lives on the `State` object so
handlers stay stateless and easy to test.
"""

from __future__ import annotations

import importlib
import ast
import json
import logging
import sys
import threading
from pathlib import Path
from typing import Any, Callable, Dict


class ToolError(Exception):
    """Raised by a tool handler to signal a clean, user-facing failure."""

    def __init__(self, message: str, *, fatal: bool = False):
        super().__init__(message)
        self.message = message
        self.fatal = fatal


class State:
    """Process-wide shared state for tool handlers."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        # Confirmation tokens for dangerous (power) actions.
        # token -> {"action": <tool_name>, "expires": <epoch>}
        self.confirmations: Dict[str, Dict[str, Any]] = {}


STATE = State()

# tool_name -> handler(args: dict) -> dict
TOOLS: Dict[str, Callable[[Dict[str, Any]], Any]] = {}
CUSTOM_TOOL_METADATA: Dict[str, Dict[str, Any]] = {}
_CUSTOM_TOOL_NAMES: set[str] = set()
_CUSTOM_TOOL_LOCK = threading.RLock()
_LOG = logging.getLogger("jayra.desktop")


def register(name: str):
    """Decorator to register a handler under a tool name."""

    def deco(fn: Callable[[Dict[str, Any]], Any]):
        TOOLS[name] = fn
        return fn

    return deco


# The set of all tool names JAYRA may route to this agent.
# Kept in sync with the functionDeclarations added in server.ts.
DESKTOP_TOOL_NAMES = [
    # applications / websites / search
    "openApplication",
    "closeApplication",
    "openWebsite",
    "searchWeb",
    "searchYouTube",
    "searchGoogle",
    "searchGitHub",
    # files
    "createFile",
    "readFile",
    "renameFile",
    "deleteFile",
    "moveFile",
    "openFolder",
    "listFiles",
    "searchFiles",
    # pc control (volume + gated power)
    "volumeUp",
    "volumeDown",
    "muteToggle",
    "setVolume",
    "requestPowerAction",  # first step: issues a confirmation token
    "executePowerAction",  # second step: runs the gated action
    # windows
    "minimizeWindow",
    "maximizeWindow",
    "closeWindow",
    "switchApplication",
    "gui_click",
    "gui_type",
    "window_control",
    "browser_control",
    # generic application-independent input and observation
    "locateText",
    "clickText",
    "moveMouse",
    "click",
    "doubleClick",
    "rightClick",
    "drag",
    "scroll",
    "typeText",
    "pressKey",
    "hotkey",
    "getCursorPosition",
    "getActiveWindow",
    "listVisibleWindows",
    "waitForUi",
    "observeDesktopState",
    # clipboard
    "copySelected",
    "pasteClipboard",
    "getClipboard",
    "clearClipboard",
    # screenshot / screen reading
    "takeScreenshot",
    "saveScreenshot",
    "analyzeScreenshot",
    "readScreen",
    "viewScreen",
    # coding assistance
    "createPythonFile",
    "runPythonScript",
    "runPowerShellScript",
    "createProjectFolder",
    "writeCodeFile",
    # system information
    "systemInfo",
    "getSystemTelemetry",
    "gpuInfo",
    "temperatureInfo",
    # brightness control (V2)
    "brightnessUp",
    "brightnessDown",
    "setBrightness",
    # Windows auto-start management (V2)
    "enableAutoStart",
    "disableAutoStart",
    "getAutoStartStatus",
    # structured perception + element actions (UI Automation)
    "inspectUi",
    "findUi",
    "uiAction",
    "browserState",
    # visual perception, geometry and input state
    "screenFingerprint",
    "captureForVision",
    "getMonitors",
    "inputState",
    "windowControl",
    # file-system perception
    "knownFolder",
    "recentFiles",
    "statPath",
    "copyFile",
    "openPath",
    # unicode typing + file clipboard
    "typeUnicode",
    "copyFilesToClipboard",
    "setClipboardText",
    # desktop icons (companion's icon game)
    "desktopIcons",
    "moveDesktopIcon",
    # File Explorer selection
    "selectFiles",
    "generate_and_register_tool",
]


# --- Eagerly import all tool modules so their @register decorators run. ---
# Each module is imported defensively: a hard import failure here would make
# the whole agent unstartable, which we want to avoid. The modules themselves
# keep optional-dependency imports lazy/try-except.
_MODULE_NAMES = [
    "tools_confirmation",
    "tools_applications",
    "tools_websites",
    "tools_search",
    "tools_files",
    "tools_pc",
    "tools_windows",
    "tools_targeting",
    "tools_input",
    "ui_automation",
    "browser_agent",
    "tools_clipboard",
    "tools_screenshot",
    "tools_coding",
    "telemetry",
    "python_execution",
    "powershell_execution",
    "tools_system",
    "tools_startup",
    "tools_uia",
    "tools_perception",
    "tools_files_ext",
    "tools_input_ext",
    "tools_desktop_icons",
    "tools_explorer",
    "tool_generator",
]


def load_all() -> None:
    for mod_name in _MODULE_NAMES:
        importlib.import_module(f".{mod_name}", package="desktop_agent")
    load_custom_tools()


def custom_tool_specs() -> list[Dict[str, Any]]:
    with _CUSTOM_TOOL_LOCK:
        return [dict(CUSTOM_TOOL_METADATA[name]) for name in sorted(CUSTOM_TOOL_METADATA)]


def _validate_custom_module(path: Path) -> tuple[ast.Module, Dict[str, Any], ast.FunctionDef]:
    source = path.read_text(encoding="utf-8")
    if len(source) > 64_000:
        raise ValueError("custom tool source exceeds 64 KB")
    tree = ast.parse(source, filename=str(path))
    metadata: Dict[str, Any] | None = None
    functions: list[ast.FunctionDef] = []
    for index, statement in enumerate(tree.body):
        if index == 0 and isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant) and isinstance(statement.value.value, str):
            continue
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1 and isinstance(statement.targets[0], ast.Name) and statement.targets[0].id in {"TOOL_METADATA", "TOOL_SPEC"}:
            metadata = ast.literal_eval(statement.value)
            continue
        if isinstance(statement, ast.FunctionDef) and not statement.decorator_list:
            if any(not isinstance(default, ast.Constant) for default in statement.args.defaults):
                raise ValueError("function defaults must be constant literals")
            functions.append(statement)
            continue
        raise ValueError("module-level executable statement is not allowed")

    if not isinstance(metadata, dict) or len(functions) != 1:
        raise ValueError("module must contain tool metadata and one function")
    name = metadata.get("name")
    if not isinstance(name, str) or name != path.stem or functions[0].name != name:
        raise ValueError("tool metadata, function name, and filename must match")
    if name in DESKTOP_TOOL_NAMES:
        raise ValueError("custom tool cannot replace a built-in tool")

    forbidden_calls = {
        "open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars", "input",
        "breakpoint", "getattr", "setattr", "delattr", "dir", "help", "type", "memoryview",
        "exit", "quit", "__build_class__",
    }
    for node in ast.walk(functions[0]):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)):
            raise ValueError("custom tools cannot import modules or mutate global state")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise ValueError("dunder names are not allowed in custom tools")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ValueError("dunder attributes are not allowed in custom tools")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in forbidden_calls:
            raise ValueError(f"unsafe builtin '{node.func.id}' is not allowed")

    return tree, metadata, functions[0]


def load_custom_tools(tools_dir: str | Path | None = None) -> set[str]:
    """Validate and import custom tool modules without restarting the sidecar."""
    if tools_dir is None:
        from .tool_generator import CUSTOM_TOOLS_DIR

        directory = CUSTOM_TOOLS_DIR
    else:
        directory = Path(tools_dir)
    if directory.is_symlink() or not directory.is_dir():
        return set()

    loaded: set[str] = set()
    with _CUSTOM_TOOL_LOCK:
        for old_name in _CUSTOM_TOOL_NAMES:
            TOOLS.pop(old_name, None)
            CUSTOM_TOOL_METADATA.pop(old_name, None)
        _CUSTOM_TOOL_NAMES.clear()

        for path in sorted(directory.glob("*.py")):
            if path.name.startswith("_") or path.is_symlink():
                continue
            module_key = f"_jayra_custom_tool_{path.stem}"
            try:
                _, metadata, function_node = _validate_custom_module(path)
                metadata = dict(metadata)
                schema = metadata.get("arguments_schema")
                if not isinstance(schema, dict) or schema.get("type") != "object" or not isinstance(schema.get("properties", {}), dict):
                    raise ValueError("tool metadata has an invalid argument schema")
                spec = importlib.util.spec_from_file_location(module_key, path)
                if spec is None or spec.loader is None:
                    raise ValueError("unable to create module loader")
                module = importlib.util.module_from_spec(spec)
                sys.modules[module_key] = module
                try:
                    spec.loader.exec_module(module)
                finally:
                    sys.modules.pop(module_key, None)
                handler_fn = getattr(module, function_node.name)
                required = set(schema.get("required", []))
                properties = set(schema.get("properties", {}))

                def handler(args: Dict[str, Any], *, fn=handler_fn, tool_name=metadata["name"], required_args=required, allowed_args=properties):
                    if not isinstance(args, dict):
                        raise ToolError("Tool arguments must be an object.")
                    missing = required_args - set(args)
                    if missing:
                        raise ToolError("Missing required arguments: " + ", ".join(sorted(missing)))
                    unexpected = set(args) - allowed_args
                    if unexpected:
                        raise ToolError("Unexpected arguments: " + ", ".join(sorted(unexpected)))
                    result = fn(**args)
                    if not isinstance(result, dict):
                        raise ToolError(f"Custom tool '{tool_name}' must return a dictionary.")
                    try:
                        json.dumps(result, allow_nan=False)
                    except (TypeError, ValueError) as error:
                        raise ToolError(f"Custom tool '{tool_name}' result must be JSON serializable.") from error
                    return result

                TOOLS[metadata["name"]] = handler
                CUSTOM_TOOL_METADATA[metadata["name"]] = metadata
                _CUSTOM_TOOL_NAMES.add(metadata["name"])
                loaded.add(metadata["name"])
                _LOG.info("[JAYRA Hot-Reload] Successfully loaded and registered new tool into runtime: %s", metadata["name"])
            except Exception as error:
                sys.modules.pop(module_key, None)
                _LOG.warning("[JAYRA Hot-Reload] Skipped %s: %s", path.name, error)
    return loaded


__all__ = ["TOOLS", "STATE", "DESKTOP_TOOL_NAMES", "CUSTOM_TOOL_METADATA", "ToolError", "register", "load_all", "load_custom_tools", "custom_tool_specs"]
