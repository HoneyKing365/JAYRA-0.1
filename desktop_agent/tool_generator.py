"""
JAYRA Desktop Control Agent — Custom Tool Generator.

Build validated, sandboxed custom desktop tools and hot-load them into the
live Python sidecar registry without a restart.

Security:
  - AST-validated: no imports, no dunder access, no unsafe builtins.
  - Written atomically via temp-file + os.replace.
  - Symlink traversal blocked.
  - Source size capped at 30 KB.
"""

from __future__ import annotations

import ast
import json
import keyword
import logging
import os
import re
import tempfile
import textwrap
from pathlib import Path
from typing import Any, Dict

from .registry import TOOLS, CUSTOM_TOOL_METADATA, ToolError, load_custom_tools, register

log = logging.getLogger("jayra.desktop")
CUSTOM_TOOLS_DIR = Path(
    os.environ.get("JAYRA_CUSTOM_TOOLS_DIR")
    or (Path(__file__).resolve().parent / "custom_tools")
).resolve()
_TOOL_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_TYPE_NAMES: Dict[str, str] = {
    "string": "str",
    "integer": "int",
    "number": "float",
    "boolean": "bool",
    "array": "list[object]",
    "object": "dict[str, object]",
}

# Builtins that custom tools must never call.
_UNSAFE_CALLS = frozenset({
    "open", "exec", "eval", "compile", "__import__", "globals", "locals",
    "vars", "input", "breakpoint", "getattr", "setattr", "delattr", "dir",
    "help", "type", "memoryview", "exit", "quit", "__build_class__",
})


# ---------------------------------------------------------------------------
# Spec validation
# ---------------------------------------------------------------------------

def _validated_spec(spec: Dict[str, Any]) -> tuple[str, str, Dict[str, Any], str]:
    """Parse and validate the raw tool specification dict."""
    if not isinstance(spec, dict):
        raise ToolError("Tool specification must be an object.")
    name = spec.get("name")
    description = spec.get("description")
    schema = spec.get("arguments_schema")
    code = spec.get("code")

    # Name
    if not isinstance(name, str) or not _TOOL_NAME.fullmatch(name) or keyword.iskeyword(name):
        raise ToolError("Tool name must be a valid Python identifier (2-64 chars, letters/numbers/underscore).")
    if name.startswith("_") or name in {"generate_and_register_tool", "generateAndRegisterTool", "reloadTools"}:
        raise ToolError("Tool name is reserved.")

    # Description
    if not isinstance(description, str) or not description.strip() or len(description) > 1000:
        raise ToolError("Tool description must contain 1-1000 characters.")

    # Schema
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ToolError("arguments_schema must be a JSON Schema object.")
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    if not isinstance(properties, dict) or len(properties) > 32:
        raise ToolError("arguments_schema.properties must be an object with at most 32 arguments.")
    if not isinstance(required, list) or any(key not in properties for key in required):
        raise ToolError("arguments_schema.required must reference declared properties.")
    for key, definition in properties.items():
        if not isinstance(key, str) or not key.isidentifier() or keyword.iskeyword(key) or key.startswith("_"):
            raise ToolError(f"Invalid argument name: {key!r}.")
        if not isinstance(definition, dict) or definition.get("type") not in _TYPE_NAMES:
            raise ToolError(f"Argument '{key}' must declare a supported JSON Schema type.")
        if definition.get("description") is not None and not isinstance(definition["description"], str):
            raise ToolError(f"Description for argument '{key}' must be text.")

    # Code body
    if not isinstance(code, str) or not code.strip() or len(code) > 30_000:
        raise ToolError("Python code body must contain 1-30000 characters.")
    return name, description.strip(), schema, textwrap.dedent(code).strip()


# ---------------------------------------------------------------------------
# AST-level source validation
# ---------------------------------------------------------------------------

def _valid_annotation(node: ast.expr) -> bool:
    """Check that a type annotation uses only safe, known types."""
    if isinstance(node, ast.Name) and node.id in {"str", "int", "float", "bool", "dict", "list", "object"}:
        return True
    if isinstance(node, ast.Constant) and node.value is None:
        return True
    if isinstance(node, ast.Subscript) and _valid_annotation(node.value):
        return True
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return _valid_annotation(node.left) and _valid_annotation(node.right)
    return False


def validate_tool_source(source: str, name: str, schema: Dict[str, Any]) -> None:
    """Parse the generated source and enforce structural + security rules."""
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as error:
        raise ToolError(f"Generated tool has invalid Python syntax: {error.msg} (line {error.lineno}).") from error

    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    assignments = [node for node in tree.body if isinstance(node, ast.Assign)]
    if len(functions) != 1 or functions[0].name != name or len(assignments) != 1:
        raise ToolError("Custom tool modules may define only their declared function and TOOL_METADATA.")
    if any(not isinstance(node, (ast.FunctionDef, ast.Assign)) for node in tree.body):
        raise ToolError("Custom tool modules may not execute imports or statements at module load time.")

    function = functions[0]
    if function.decorator_list:
        raise ToolError("Custom tool function must not use decorators.")
    if not ast.get_docstring(function):
        raise ToolError("Custom tool function must include a docstring.")
    if function.returns is None or not _valid_annotation(function.returns):
        raise ToolError("Custom tool return value must have a supported type hint.")
    if any(arg.annotation is None or not _valid_annotation(arg.annotation) for arg in function.args.args):
        raise ToolError("Custom tool parameters must have supported type hints.")
    if {arg.arg for arg in function.args.args} != set(schema.get("properties", {})):
        raise ToolError("Function parameters must match arguments_schema.properties.")
    if function.args.kwonlyargs or function.args.vararg or function.args.kwarg:
        raise ToolError("Custom tool signature cannot use variadic arguments.")
    if any(not isinstance(default, ast.Constant) for default in function.args.defaults):
        raise ToolError("Custom tool defaults must be constant literals.")

    metadata_target = assignments[0].targets[0] if len(assignments[0].targets) == 1 else None
    if not isinstance(metadata_target, ast.Name) or metadata_target.id != "TOOL_METADATA":
        raise ToolError("Custom tool metadata must be assigned to TOOL_METADATA.")

    # Security: walk the entire function body.
    for node in ast.walk(function):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)):
            raise ToolError("Custom tools cannot import modules or mutate global state.")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise ToolError("Dunder names are not allowed in custom tools.")
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            raise ToolError("Dunder attributes are not allowed in custom tools.")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _UNSAFE_CALLS:
            raise ToolError(f"Unsafe builtin '{node.func.id}' is not allowed.")


# ---------------------------------------------------------------------------
# Source generation
# ---------------------------------------------------------------------------

def build_tool_source(spec: Dict[str, Any]) -> tuple[str, Dict[str, Any]]:
    """Generate validated Python source code for a custom tool spec."""
    name, description, schema, code = _validated_spec(spec)
    properties = schema.get("properties", {})
    required = set(schema.get("required", []))

    # Build signature: required parameters first, then optional.
    parameters: list[str] = []
    docs: list[str] = []
    for argument, definition in properties.items():
        annotation = _TYPE_NAMES[definition["type"]]
        optional = argument not in required
        if optional:
            annotation = f"{annotation} | None"
        default = " = None" if optional else ""
        parameters.append(f"{argument}: {annotation}{default}")
        if definition.get("description"):
            docs.append(f"    {argument}: {definition['description']}")

    # Ensure required params come before optional in Python signature.
    parameters.sort(key=lambda item: " = None" in item)

    metadata = {"name": name, "description": description, "arguments_schema": schema}
    doc_escaped = json.dumps(description)

    source = (
        f"TOOL_METADATA = {metadata!r}\n\n"
        f"def {name}({', '.join(parameters)}) -> dict[str, object]:\n"
        f"    {doc_escaped}\n"
        f"{textwrap.indent(code, '    ')}\n"
    )

    validate_tool_source(source, name, schema)
    return source, metadata


# ---------------------------------------------------------------------------
# File writing (atomic)
# ---------------------------------------------------------------------------

def write_tool(spec: Dict[str, Any], tools_dir: str | Path | None = None) -> tuple[Path, Dict[str, Any]]:
    """Write a validated custom tool to disk atomically."""
    source, metadata = build_tool_source(spec)
    directory = Path(tools_dir) if tools_dir is not None else CUSTOM_TOOLS_DIR
    if directory.is_symlink():
        raise ToolError("Custom tools directory must not be a symbolic link.")
    directory.mkdir(parents=True, exist_ok=True)
    root = directory.resolve()
    target = root / f"{metadata['name']}.py"

    if target.exists() or metadata["name"] in TOOLS:
        raise ToolError(f"A tool named '{metadata['name']}' already exists.")
    if target.is_symlink():
        raise ToolError("Custom tool target must not be a symbolic link.")
    if target.parent.resolve() != root:
        raise ToolError("Custom tool path escaped the custom tools directory.")

    log.info("[JAYRA Tool Builder] Writing custom tool script: %s", target.name)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=root, suffix=".tmp", delete=False) as stream:
            temporary_path = stream.name
            stream.write(source)
            stream.flush()
            os.fsync(stream.fileno())
        # Re-validate the written file.
        ast.parse(Path(temporary_path).read_text(encoding="utf-8"), mode="exec")
        os.replace(temporary_path, target)
        temporary_path = None
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
    return target, metadata


# ---------------------------------------------------------------------------
# Registered tool handler
# ---------------------------------------------------------------------------

@register("generate_and_register_tool")
def generate_and_register_tool(args: Dict[str, Any]) -> Dict[str, Any]:
    """Generate a validated custom tool and hot-reload it into the sidecar."""
    spec = {
        "name": args.get("name"),
        "description": args.get("description"),
        "arguments_schema": args.get("arguments_schema"),
        "code": args.get("code"),
    }
    target, metadata = write_tool(spec)
    loaded = load_custom_tools()
    if metadata["name"] not in loaded:
        target.unlink(missing_ok=True)
        raise ToolError("Generated tool did not pass hot-reload validation.")
    log.info(
        "[JAYRA Hot-Reload] Successfully loaded and registered new tool into runtime: %s",
        metadata["name"],
    )
    return {
        "result": f"Custom tool '{metadata['name']}' generated and registered.",
        "tool": CUSTOM_TOOL_METADATA.get(metadata["name"], metadata),
        "path": str(target),
    }


__all__ = [
    "CUSTOM_TOOLS_DIR",
    "build_tool_source",
    "generate_and_register_tool",
    "validate_tool_source",
    "write_tool",
]