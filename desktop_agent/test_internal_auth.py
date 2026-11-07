from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import patch

from starlette.requests import Request

from desktop_agent.main import node_execution_authentication


def make_request(path: str, token: str | None = None) -> Request:
    headers = [(b"host", b"127.0.0.1")]
    if token is not None:
        headers.append((b"x-jayra-internal-token", token.encode()))
    return Request({
        "type": "http",
        "method": "POST",
        "path": path,
        "headers": headers,
        "query_string": b"",
        "server": ("127.0.0.1", 8765),
        "client": ("127.0.0.1", 3000),
        "scheme": "http",
    })


async def next_request(_request: Request) -> str:
    return "passed"


class NodeExecutionAuthenticationTests(unittest.TestCase):
    def test_node_execution_routes_require_the_configured_runtime_token(self) -> None:
        with patch.dict(os.environ, {"JAYRA_INTERNAL_TOKEN": "runtime-secret"}):
            denied = asyncio.run(node_execution_authentication(make_request("/execute"), next_request))
            self.assertEqual(denied.status_code, 401)

            allowed = asyncio.run(node_execution_authentication(
                make_request("/execute", "runtime-secret"),
                next_request,
            ))
            self.assertEqual(allowed, "passed")

    def test_vision_inspection_also_requires_the_runtime_token(self) -> None:
        with patch.dict(os.environ, {"JAYRA_INTERNAL_TOKEN": "runtime-secret"}):
            response = asyncio.run(node_execution_authentication(make_request("/vision/inspect"), next_request))
        self.assertEqual(response.status_code, 401)

    def test_sidecar_execution_and_sensitive_routes_require_the_runtime_token(self) -> None:
        paths = (
            "/automation/mouse",
            "/browser/action",
            "/tools/sandbox",
            "/tools/custom/example",
            "/observe",
            "/gateway/connect-info",
        )
        with patch.dict(os.environ, {"JAYRA_INTERNAL_TOKEN": "runtime-secret"}):
            for path in paths:
                with self.subTest(path=path):
                    response = asyncio.run(node_execution_authentication(make_request(path), next_request))
                    self.assertEqual(response.status_code, 401)

                    allowed = asyncio.run(node_execution_authentication(
                        make_request(path, "runtime-secret"),
                        next_request,
                    ))
                    self.assertEqual(allowed, "passed")

    def test_standalone_sidecar_keeps_legacy_access_behavior(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            response = asyncio.run(node_execution_authentication(make_request("/automation/mouse"), next_request))
        self.assertEqual(response, "passed")


if __name__ == "__main__":
    unittest.main()
