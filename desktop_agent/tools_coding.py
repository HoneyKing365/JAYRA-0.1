"""
Coding assistance: create code files, run Python scripts, scaffold projects.

  createPythonFile   -> write a .py file (uses createFile semantics w/ safety)
  writeCodeFile      -> write an arbitrary-language file with proper extension
  createProjectFolder-> make a folder structure (with optional subfolders)
  runPythonScript    -> execute a .py file with the known-good interpreter,
                        capturing stdout/stderr and exit code.

The Python interpreter used for running scripts is auto-detected so it works
even when the bare `python` shim is broken (common on this machine).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from .registry import ToolError, register
from .tools_files import _ensure_safe


# Extension map for writeCodeFile.
LANG_EXT: Dict[str, str] = {
    "python": "py",
    "py": "py",
    "javascript": "js",
    "js": "js",
    "typescript": "ts",
    "ts": "ts",
    "html": "html",
    "css": "css",
    "json": "json",
    "markdown": "md",
    "md": "md",
    "java": "java",
    "c": "c",
    "cpp": "cpp",
    "csharp": "cs",
    "cs": "cs",
    "go": "go",
    "rust": "rs",
    "rs": "rs",
    "ruby": "rb",
    "rb": "rb",
    "php": "php",
    "shell": "sh",
    "bash": "sh",
    "sh": "sh",
    "sql": "sql",
    "yaml": "yaml",
    "yml": "yaml",
    "xml": "xml",
    "text": "txt",
    "txt": "txt",
}


@register("createPythonFile")
def create_python_file(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path")
    content = args.get("content", "")
    if not path:
        raise ToolError("Parameter 'path' is required.")
    p = Path(os.path.expandvars(os.path.expanduser(str(path)))).resolve()
    if p.suffix.lower() != ".py":
        p = p.with_suffix(".py")
    _ensure_safe(p, bool(args.get("allow_anywhere", False)))
    if p.exists() and not args.get("overwrite"):
        raise ToolError(f"File already exists: {p}. Pass overwrite=true to replace.")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(str(content) + ("" if str(content).endswith("\n") else "\n"), encoding="utf-8")
    return {"result": f"Created Python file: {p}", "path": str(p)}


@register("writeCodeFile")
def write_code_file(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path")
    content = args.get("content", "")
    language = (args.get("language") or "txt").strip().lower()
    if not path:
        raise ToolError("Parameter 'path' is required.")
    p = Path(os.path.expandvars(os.path.expanduser(str(path)))).resolve()
    # If the caller gave a basename without extension, append the language's.
    ext = LANG_EXT.get(language)
    if ext and p.suffix == "":
        p = p.with_suffix("." + ext)
    _ensure_safe(p, bool(args.get("allow_anywhere", False)))
    if p.exists() and not args.get("overwrite"):
        raise ToolError(f"File already exists: {p}. Pass overwrite=true to replace.")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(str(content), encoding="utf-8")
    return {"result": f"Wrote {language} file: {p}", "path": str(p)}


@register("createProjectFolder")
def create_project_folder(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path") or args.get("name")
    if not path:
        raise ToolError("Parameter 'path' (project root) is required.")
    root = Path(os.path.expandvars(os.path.expanduser(str(path)))).resolve()
    allow_anywhere = bool(args.get("allow_anywhere", False))
    _ensure_safe(root, allow_anywhere)
    root.mkdir(parents=True, exist_ok=True)

    subfolders: List[str] = args.get("subfolders") or args.get("structure") or []
    created = [str(root)]
    default_scaffold = {
        "src": None,
        "tests": None,
        "docs": None,
    }
    if args.get("scaffold_standard", False):
        for sub in default_scaffold:
            (root / sub).mkdir(exist_ok=True)
            created.append(str(root / sub))
    if subfolders:
        for sub in subfolders:
            sp = (root / str(sub)).resolve()
            _ensure_safe(sp, allow_anywhere)
            sp.mkdir(parents=True, exist_ok=True)
            created.append(str(sp))

    # Optional starter files.
    files: Dict[str, str] = args.get("files") or {}
    for rel, content in files.items():
        fp = (root / str(rel)).resolve()
        _ensure_safe(fp, allow_anywhere)
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(str(content), encoding="utf-8")
        created.append(str(fp))

    return {"result": f"Project folder created at {root}.", "path": str(root), "created": created}


__all__ = [
    "create_python_file",
    "write_code_file",
    "create_project_folder",
]
