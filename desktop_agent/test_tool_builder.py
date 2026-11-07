from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from desktop_agent import main, registry
from desktop_agent.tool_builder import (
    delete_custom_tool,
    execute_sandboxed,
    list_custom_tools,
    test_and_build_tool,
)


class ToolBuilderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(main.app)
        self.tool_name = "testGeneratedTool"

    def tearDown(self) -> None:
        registry.TOOLS.pop(self.tool_name, None)
        registry.CUSTOM_TOOL_METADATA.pop(self.tool_name, None)
        custom_file = Path(__file__).resolve().parent / "custom_tools" / f"{self.tool_name}.py"
        if custom_file.exists():
            custom_file.unlink(missing_ok=True)

    def test_sandboxed_execution_captures_result(self) -> None:
        code = """
def main(a=1, b=2):
    return a + b
"""
        res = execute_sandboxed(code, entry_point="main", test_input={"a": 10, "b": 20})
        self.assertTrue(res["ok"])
        self.assertEqual(res["result"], 30)

    def test_sandboxed_execution_catches_timeout(self) -> None:
        code = """
import time
def main():
    time.sleep(2)
    return "done"
"""
        res = execute_sandboxed(code, entry_point="main", timeout_sec=0.1)
        self.assertFalse(res["ok"])
        self.assertTrue(res.get("timeout"))

    def test_test_and_build_tool_lifecycle(self) -> None:
        spec = {
            "name": self.tool_name,
            "description": "Calculates difference of two integers.",
            "arguments_schema": {
                "type": "object",
                "properties": {
                    "x": {"type": "integer", "description": "First number"},
                    "y": {"type": "integer", "description": "Second number"},
                },
                "required": ["x", "y"],
            },
            "code": "return {'diff': x - y}",
        }
        test_cases = [
            {"input": {"x": 10, "y": 3}, "expected": {"diff": 7}},
        ]
        res = test_and_build_tool(spec, test_cases=test_cases)
        self.assertTrue(res["ok"], res.get("error"))
        self.assertIn(self.tool_name, registry.TOOLS)

        # Verify listed in custom tools
        tools = list_custom_tools()
        self.assertTrue(any(t["name"] == self.tool_name for t in tools))

        # Test execution through registered handler
        exec_res = registry.TOOLS[self.tool_name]({"x": 100, "y": 25})
        self.assertEqual(exec_res, {"diff": 75})

        # Test deletion
        del_res = delete_custom_tool(self.tool_name)
        self.assertTrue(del_res["ok"])
        self.assertNotIn(self.tool_name, registry.TOOLS)

    def test_api_endpoints_work(self) -> None:
        resp = self.client.get("/tools/custom")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("custom_tools", resp.json())

        sandbox_resp = self.client.post("/tools/sandbox", json={
            "code": "def main(): return {'status': 'all_good'}",
            "entry_point": "main",
        })
        self.assertEqual(sandbox_resp.status_code, 200)
        self.assertTrue(sandbox_resp.json()["ok"])
        self.assertEqual(sandbox_resp.json()["result"], {"status": "all_good"})


if __name__ == "__main__":
    unittest.main()
