"""Secure local-network gateway helpers for the desktop sidecar."""

from __future__ import annotations

import ipaddress
import json
import os
import re
import secrets
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

_TOKEN_LOCK = threading.Lock()
_TOKEN_CACHE: str | None = None
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]+")
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def network_access_enabled() -> bool:
    return os.environ.get("JAYRA_NETWORK_ACCESS", "").strip().lower() in {"1", "true", "yes", "on"}


def agent_bind_host() -> str:
    if not network_access_enabled():
        return "127.0.0.1"
    host = os.environ.get("JAYRA_AGENT_HOST", "0.0.0.0").strip()
    if host in {"0.0.0.0", "::"}:
        return host
    try:
        ipaddress.ip_address(host)
    except ValueError as error:
        raise ValueError("JAYRA_AGENT_HOST must be a local IP address or 0.0.0.0") from error
    return host


def agent_port() -> int:
    try:
        port = int(os.environ.get("JAYRA_AGENT_PORT", "8765"))
    except ValueError:
        return 8765
    return port if 1 <= port <= 65535 else 8765


def is_loopback(host: str | None) -> bool:
    if not host:
        return False
    if host.lower() in {"localhost", "testclient"}:
        return True
    try:
        return ipaddress.ip_address(host.split("%", 1)[0]).is_loopback
    except ValueError:
        return False


def is_secure_browser_origin(origin: str) -> bool:
    try:
        parsed = urlsplit(origin)
        if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password:
            return True
        return parsed.scheme == "http" and is_loopback(parsed.hostname) and not parsed.username and not parsed.password
    except ValueError:
        return False


def _token_file() -> Path:
    configured = os.environ.get("JAYRA_GATEWAY_TOKEN_FILE")
    if configured:
        return Path(configured).expanduser()
    if os.name == "nt" and os.environ.get("APPDATA"):
        return Path(os.environ["APPDATA"]) / "JAYRA" / "gateway.token"
    return Path.home() / ".config" / "jayra" / "gateway.token"


def get_gateway_token() -> str:
    """Return a configured token or create a persistent random token securely."""
    global _TOKEN_CACHE
    configured = os.environ.get("JAYRA_GATEWAY_TOKEN", "").strip()
    if configured:
        if len(configured) < 32:
            raise ValueError("JAYRA_GATEWAY_TOKEN must be at least 32 characters.")
        return configured

    if _TOKEN_CACHE:
        return _TOKEN_CACHE
    with _TOKEN_LOCK:
        if _TOKEN_CACHE:
            return _TOKEN_CACHE
        token_path = _token_file()
        token_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with token_path.open("x", encoding="ascii") as token_stream:
                token_stream.write(secrets.token_urlsafe(48))
            try:
                token_path.chmod(0o600)
            except OSError:
                pass
        except FileExistsError:
            pass
        _TOKEN_CACHE = token_path.read_text(encoding="ascii").strip()
        if len(_TOKEN_CACHE) < 32:
            raise ValueError("Stored JAYRA gateway token is invalid; remove the token file to regenerate it.")
        return _TOKEN_CACHE


def gateway_token_source() -> str:
    return "environment" if os.environ.get("JAYRA_GATEWAY_TOKEN", "").strip() else str(_token_file())


def remote_upload_directory() -> Path:
    project_root = Path(os.environ.get("MYRAA_APP_ROOT", Path.cwd())).resolve()
    target = project_root / "downloads" / "remote_uploads"
    target.mkdir(parents=True, exist_ok=True)
    return target.resolve()


def sanitize_upload_name(filename: str) -> str:
    base = Path(filename.replace("\\", "/")).name
    safe = _SAFE_FILENAME.sub("_", base).strip(" .")[:120]
    if not safe or safe in {".", ".."}:
        safe = "upload.bin"
    if Path(safe).suffix.lower() in {".exe", ".dll", ".bat", ".cmd", ".ps1", ".msi", ".com", ".scr", ".js", ".vbs"}:
        safe = f"{safe}.blocked"
    return safe


def local_network_urls(port: int) -> list[str]:
    addresses: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, type=socket.SOCK_STREAM):
            address = info[4][0].split("%", 1)[0]
            parsed = ipaddress.ip_address(address)
            if not parsed.is_loopback and not parsed.is_link_local and parsed.version == 4:
                addresses.add(str(parsed))
    except OSError:
        pass
    configured_host = os.environ.get("JAYRA_AGENT_HOST", "")
    try:
        configured_ip = ipaddress.ip_address(configured_host)
        if configured_ip.version == 4 and not configured_ip.is_unspecified and not configured_ip.is_loopback:
            addresses.add(str(configured_ip))
    except ValueError:
        pass
    return [f"http://{address}:{port}/mobile" for address in sorted(addresses)]


def valid_gateway_token(candidate: str | None) -> bool:
    return bool(candidate) and secrets.compare_digest(candidate, get_gateway_token())


def forward_command_to_node(command: dict[str, Any]) -> dict[str, Any]:
    """Forward remote work only to the local Node permission/ReAct pipeline."""
    url = os.environ.get("JAYRA_NODE_GATEWAY_URL", "http://127.0.0.1:3000/api/gateway/command")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("JAYRA_NODE_GATEWAY_URL must target the local Node server over HTTP.")
    request = urllib.request.Request(
        url,
        data=json.dumps(command).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read(1_000_001)
            if len(body) > 1_000_000:
                raise ValueError("Node gateway response exceeds one megabyte.")
            return json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read(2_000).decode("utf-8", errors="replace")
        raise RuntimeError(f"Node gateway rejected the command ({error.code}): {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("JAYRA Node task pipeline is unavailable.") from error


def forward_approval_to_node(confirmation_id: str, approved: bool) -> dict[str, Any]:
    url = os.environ.get("JAYRA_NODE_APPROVAL_URL", "http://127.0.0.1:3000/api/cognition/confirm")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("JAYRA_NODE_GATEWAY_URL must target the local Node server over HTTP.")
    request = urllib.request.Request(
        url,
        data=json.dumps({"confirmationId": confirmation_id, "approved": approved}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read(32_000).decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError) as error:
        raise RuntimeError("JAYRA could not forward the mobile approval to its local permission broker.") from error


def iter_node_events():
    url = os.environ.get("JAYRA_NODE_EVENTS_URL", "http://127.0.0.1:3000/api/gateway/events")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("JAYRA_NODE_EVENTS_URL must target the local Node server over HTTP.")
    request = urllib.request.Request(url, headers={"Accept": "text/event-stream"})
    response = urllib.request.urlopen(request, timeout=45)
    try:
        while True:
            line = response.readline(16_384)
            if not line:
                break
            yield line
    finally:
        response.close()