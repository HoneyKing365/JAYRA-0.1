from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from desktop_agent import registry
from desktop_agent.registry import ToolError
from desktop_agent.tool_generator import build_tool_source, write_tool


class DynamicToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(dir=Path.cwd())
        self.tools_dir = Path(self.directory.name) / "custom_tools"
        self.name = "dynamicSumTool"

    def tearDown(self) -> None:
        registry.TOOLS.pop(self.name, None)
        registry.CUSTOM_TOOL_METADATA.pop(self.name, None)
        self.directory.cleanup()

    def spec(self, *, code: str = "return {'result': value * (multiplier or 1)}") -> dict:
        return {
            "name": self.name,
            "description": "Multiply an integer by an optional multiplier.",
            "arguments_schema": {
                "type": "object",
                "properties": {
                    "multiplier": {"type": "integer", "description": "Optional multiplier."},
                    "value": {"type": "integer", "description": "Value to multiply."},
                },
                "required": ["value"],
            },
            "code": code,
        }

    def test_generated_function_has_typed_documented_signature(self) -> None:
        source, metadata = build_tool_source(self.spec())
        self.assertIn("def dynamicSumTool(", source)
        self.assertIn("value: int", source)
        self.assertIn("multiplier: int | None = None", source)
        self.assertIn("-> dict[str, object]", source)
        self.assertIn('"Multiply an integer by an optional multiplier."', source)
        self.assertEqual(metadata["name"], self.name)

    def test_invalid_python_is_rejected_before_file_write(self) -> None:
        with self.assertRaisesRegex(ToolError, "invalid Python syntax"):
            write_tool(self.spec(code="if:"), self.tools_dir)
        self.assertFalse(self.tools_dir.exists())

    def test_reflection_builtin_is_rejected_before_file_write(self) -> None:
        code = "return {'type': getattr(value, '__class__')}"
        with self.assertRaisesRegex(ToolError, "Unsafe builtin 'getattr'"):
            write_tool(self.spec(code=code), self.tools_dir)
        self.assertFalse(self.tools_dir.exists())

    def test_reload_registers_custom_function_and_checks_arguments(self) -> None:
        write_tool(self.spec(), self.tools_dir)
        self.assertEqual(registry.load_custom_tools(self.tools_dir), {self.name})
        self.assertEqual(registry.TOOLS[self.name]({"value": 6}), {"result": 6})
        self.assertEqual(registry.TOOLS[self.name]({"value": 6, "multiplier": 4}), {"result": 24})
        with self.assertRaisesRegex(ToolError, "Missing required arguments"):
            registry.TOOLS[self.name]({})
        with self.assertRaisesRegex(ToolError, "Unexpected arguments"):
            registry.TOOLS[self.name]({"value": 2, "extra": True})

    def test_reload_rejects_module_level_executable_statements(self) -> None:
        write_tool(self.spec(), self.tools_dir)
        script = self.tools_dir / f"{self.name}.py"
        script.write_text(script.read_text(encoding="utf-8") + "print('must not execute')\n", encoding="utf-8")
        self.assertEqual(registry.load_custom_tools(self.tools_dir), set())
        self.assertNotIn(self.name, registry.TOOLS)

    def test_custom_tool_must_return_json_serializable_dictionary(self) -> None:
        write_tool(self.spec(code="return {'bad': object()}"), self.tools_dir)
        registry.load_custom_tools(self.tools_dir)
        with self.assertRaisesRegex(ToolError, "JSON serializable"):
            registry.TOOLS[self.name]({"value": 1})

    def test_reload_endpoint_returns_loaded_tool_metadata(self) -> None:
        from desktop_agent import main

        specs = [{"name": self.name, "description": "A test tool.", "arguments_schema": self.spec()["arguments_schema"]}]
        with patch.object(main, "load_custom_tools", return_value={self.name}), patch.object(main, "custom_tool_specs", return_value=specs):
            response = TestClient(main.app).post("/tools/reload")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["loaded"], [self.name])
        self.assertEqual(response.json()["custom_tools"], specs)


if __name__ == "__main__":
    unittest.main()