"""
JAYRA Desktop Control Agent — FastAPI entrypoint.

Single dispatch endpoint POST /execute { tool, args } -> { result } | { error }.
JAYRA's Node bridge (server.ts) calls this over HTTP on 127.0.0.1:8765.

Run:
    uvicorn desktop_agent.main:app --host 127.0.0.1 --port 8765
or:
    python -m desktop_agent.main
"""

from __future__ import annotations

import logging
import os
import sys
import inspect
import hmac
import secrets
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from . import __version__
from .registry import DESKTOP_TOOL_NAMES, TOOLS, ToolError, custom_tool_specs, load_all, load_custom_tools
from .perception import collect_snapshot
from .gateway import (
    agent_bind_host,
    agent_port,
    forward_command_to_node,
    forward_approval_to_node,
    get_gateway_token,
    gateway_token_source,
    is_loopback,
    is_secure_browser_origin,
    iter_node_events,
    local_network_urls,
    MAX_UPLOAD_BYTES,
    network_access_enabled,
    remote_upload_directory,
    sanitize_upload_name,
    valid_gateway_token,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("jayra.desktop")


# Load all tool modules so their handlers register before the app starts.
load_all()
log.info("Loaded %d desktop tools: %s", len(TOOLS), ", ".join(sorted(TOOLS)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("JAYRA Desktop Control Agent v%s starting up.", __version__)
    if network_access_enabled():
        try:
            get_gateway_token()
        except (OSError, ValueError) as error:
            log.error("[JAYRA Gateway] Authentication setup failed: %s", error)
            raise RuntimeError("JAYRA gateway authentication could not be initialized securely.") from error
        log.info("[JAYRA Gateway] Network access enabled on %s:%s; token source=%s", agent_bind_host(), agent_port(), gateway_token_source())
    try:
        from .tools_applications import warm_app_index

        warm_app_index()  # installed-app index in the background: fast "open X"
    except Exception as error:  # never block start-up on the index
        log.warning("App index warm-up failed: %s", error)
    try:
        from .screen_consciousness import screen_consciousness
        from .proactive_companion import proactive_engine

        try:
            screen_consciousness.register_callback(
                lambda alert: proactive_engine.add_reaction_memory({
                    "type": "screen_error_detected",
                    "title": alert.get("title", ""),
                    "message": str(alert.get("message", ""))[:120],
                    "process": alert.get("process", ""),
                })
            )
        except Exception as wire_err:
            log.warning("Wiring screen consciousness to proactive engine failed: %s", wire_err)

        screen_consciousness.start()
    except Exception as error:
        log.warning("Screen consciousness startup failed: %s", error)
    try:
        from .proactive_companion import proactive_engine

        proactive_engine.start()
    except Exception as error:
        log.warning("Proactive companion engine startup failed: %s", error)
    yield
    try:
        from .screen_consciousness import screen_consciousness

        screen_consciousness.stop()
    except Exception:
        pass
    try:
        from .proactive_companion import proactive_engine

        proactive_engine.stop()
    except Exception:
        pass
    try:
        from .browser_agent import close_browser_agent

        await close_browser_agent()
    except Exception as error:
        log.warning("Browser shutdown failed: %s", error)
    log.info("JAYRA Desktop Control Agent stopped.")


app = FastAPI(
    title="JAYRA Desktop Control Agent",
    version=__version__,
    description="JARVIS-style desktop automation backend for JAYRA.",
    lifespan=lifespan,
)

# Same-origin Node bridge is the only caller; allow localhost origins flexibly.
# Include the dynamic server port (Electron uses 47130; dev uses 3000).
_server_port = os.environ.get("JAYRA_PORT") or os.environ.get("MYRAA_PORT") or "3000"
_allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    f"http://localhost:{_server_port}",
    f"http://127.0.0.1:{_server_port}",
]
# Deduplicate while preserving order.
_allowed_origins = list(dict.fromkeys(_allowed_origins))
_allowed_origins.extend(
    origin.strip()
    for origin in os.environ.get("JAYRA_GATEWAY_ALLOWED_ORIGINS", "").split(",")
    if origin.strip() and is_secure_browser_origin(origin.strip())
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-JAYRA-Token"],
)

NODE_CONTROLLED_PATHS = frozenset({
    "/execute",
    "/vision/inspect",
    "/automation/mouse",
    "/automation/keyboard",
    "/automation/window",
    "/browser/action",
    "/tools",
    "/tools/custom",
    "/tools/reload",
    "/tools/sandbox",
    "/tools/build",
    "/consciousness/state",
    "/consciousness/probe",
    "/proactive/state",
    "/proactive/events",
    "/proactive/chat-activity",
    "/proactive/focus-mode",
    "/proactive/settings",
    "/proactive/reaction-memory",
    "/gateway/connect-info",
    "/observe",
    "/telemetry",
})


@app.middleware("http")
async def gateway_authentication(request: Request, call_next):
    client_host = request.client.host if request.client else None
    if is_loopback(client_host):
        return await call_next(request)
    if not network_access_enabled():
        return JSONResponse(status_code=403, content={"detail": "JAYRA network access is disabled."})
    if request.method == "OPTIONS":
        return await call_next(request)
    if request.method == "GET" and request.url.path in {"/mobile", "/manifest.webmanifest", "/mobile-icon.svg", "/mobile-sw.js"}:
        return await call_next(request)
    supplied = request.headers.get("x-jayra-token")
    authorization = request.headers.get("authorization", "")
    if not supplied and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    try:
        authorized = valid_gateway_token(supplied)
    except ValueError as error:
        log.error("[JAYRA Gateway] Token configuration error: %s", error)
        return JSONResponse(status_code=503, content={"detail": "JAYRA gateway token is not configured securely."})
    if not authorized:
        return JSONResponse(status_code=401, content={"detail": "A valid JAYRA gateway token is required."})
    allowed_paths = {
        "/mobile", "/manifest.webmanifest", "/gateway/status", "/gateway/command",
        "/gateway/upload", "/gateway/download", "/gateway/stream", "/gateway/approval",
    }
    if request.url.path not in allowed_paths:
        return JSONResponse(status_code=403, content={"detail": "Remote access is limited to the JAYRA mobile gateway."})
    log.info("[JAYRA Gateway] Secure connection established from external IP: %s", client_host)
    return await call_next(request)


@app.middleware("http")
async def node_execution_authentication(request: Request, call_next):
    path = request.url.path
    if path not in NODE_CONTROLLED_PATHS and not path.startswith("/tools/custom/"):
        return await call_next(request)
    expected = os.environ.get("JAYRA_INTERNAL_TOKEN", "").strip()
    if not expected:
        return await call_next(request)
    supplied = request.headers.get("x-jayra-internal-token", "")
    if not hmac.compare_digest(supplied, expected):
        return JSONResponse(status_code=401, content={"detail": "A JAYRA Node runtime token is required."})
    return await call_next(request)


class ExecuteRequest(BaseModel):
    tool: str
    args: Dict[str, Any] = {}


class ExecuteResponse(BaseModel):
    ok: bool
    result: Any = None
    error: str | None = None
    tool: str


class VisionInspectRequest(BaseModel):
    prompt: str = "Inspect the visible screen and describe the relevant UI."
    target: str = "active_screen"
    max_dim: int = 1920
    quality: int = 85


class GatewayCommandRequest(BaseModel):
    prompt: str | None = None
    tool: str | None = None
    args: Dict[str, Any] = {}


class GatewayApprovalRequest(BaseModel):
    confirmation_id: str
    approved: bool


@app.get("/mobile", response_class=HTMLResponse)
def mobile_control() -> HTMLResponse:
    page = Path(__file__).with_name("mobile.html")
    return HTMLResponse(page.read_text(encoding="utf-8"))


@app.get("/manifest.webmanifest")
def mobile_manifest() -> Dict[str, Any]:
    return {
        "name": "JAYRA Mobile Control",
        "short_name": "JAYRA",
        "start_url": "/mobile",
        "display": "standalone",
        "background_color": "#0c1110",
        "theme_color": "#14201d",
        "icons": [{"src": "/mobile-icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}],
    }


@app.get("/mobile-icon.svg", response_class=HTMLResponse)
def mobile_icon() -> HTMLResponse:
    icon = Path(__file__).with_name("mobile-icon.svg").read_text(encoding="utf-8")
    return HTMLResponse(icon, media_type="image/svg+xml")


@app.get("/mobile-sw.js")
def mobile_service_worker() -> Response:
    script = Path(__file__).with_name("mobile-sw.js").read_text(encoding="utf-8")
    return Response(script, media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "name": "JAYRA Desktop Control Agent",
        "version": __version__,
        "tools": sorted(TOOLS.keys()),
        "tool_count": len(TOOLS),
    }


@app.get("/tools")
def list_tools() -> Dict[str, Any]:
    return {"tools": sorted(TOOLS.keys()), "count": len(TOOLS), "custom_tools": custom_tool_specs()}


@app.post("/tools/reload")
def reload_tools() -> Dict[str, Any]:
    loaded = load_custom_tools()
    log.info("[JAYRA Hot-Reload] Reload complete; loaded=%s", ",".join(sorted(loaded)) or "none")
    return {"loaded": sorted(loaded), "custom_tools": custom_tool_specs()}


@app.get("/tools/custom")
def get_custom_tools() -> Dict[str, Any]:
    from .tool_builder import list_custom_tools
    return {"custom_tools": list_custom_tools()}


@app.post("/tools/sandbox")
def run_sandbox(payload: Dict[str, Any]) -> Dict[str, Any]:
    from .tool_builder import execute_sandboxed
    code = str(payload.get("code") or "")
    entry_point = str(payload.get("entry_point") or "main")
    test_input = payload.get("test_input")
    timeout_sec = float(payload.get("timeout_sec") or 5.0)
    return execute_sandboxed(code, entry_point=entry_point, test_input=test_input, timeout_sec=timeout_sec)


@app.post("/tools/build")
def build_custom_tool(payload: Dict[str, Any]) -> Dict[str, Any]:
    from .tool_builder import test_and_build_tool
    spec = payload.get("spec") or payload
    test_cases = payload.get("test_cases")
    return test_and_build_tool(spec, test_cases=test_cases)


@app.delete("/tools/custom/{tool_name}")
def remove_custom_tool(tool_name: str) -> Dict[str, Any]:
    from .tool_builder import delete_custom_tool
    return delete_custom_tool(tool_name)


@app.get("/consciousness/state")
def consciousness_state() -> Dict[str, Any]:
    from .screen_consciousness import screen_consciousness
    return {
        "running": screen_consciousness._running,
        "latest_alert": screen_consciousness.latest_alert,
    }


@app.post("/consciousness/probe")
def consciousness_probe() -> Dict[str, Any]:
    from .screen_consciousness import screen_consciousness
    alert = screen_consciousness.probe_active_window()
    return {"alert": alert}


# ─── Proactive Companion Engine Endpoints ──────────────────────────────────


class FocusModeRequest(BaseModel):
    enabled: bool
    duration_minutes: float | None = None


class ProactiveSettingsRequest(BaseModel):
    proactivity_level: str | None = None
    persona_preset: str | None = None
    active_task_threshold_sec: float | None = None
    idle_away_threshold_sec: float | None = None
    proactive_cooldown_sec: float | None = None


@app.get("/proactive/state")
def proactive_state() -> Dict[str, Any]:
    """Return the current state of the Proactive Companion Engine."""
    try:
        from .proactive_companion import proactive_engine
        return {"ok": True, "state": proactive_engine.get_state()}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "state": None}


@app.get("/proactive/events")
def proactive_events() -> Dict[str, Any]:
    """Drain and return all pending proactive events (server.ts polls this)."""
    try:
        from .proactive_companion import proactive_engine, ProactiveEvent
        import dataclasses
        events = proactive_engine.pop_pending_events()
        serialized = [dataclasses.asdict(e) for e in events]
        return {"ok": True, "events": serialized, "count": len(serialized)}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "events": []}


@app.post("/proactive/dnd")
def proactive_set_dnd(req: FocusModeRequest) -> Dict[str, Any]:
    """Enable or disable Focus Mode / Do Not Disturb."""
    try:
        from .proactive_companion import proactive_engine
        proactive_engine.set_focus_mode(req.enabled, duration_minutes=req.duration_minutes)
        state = proactive_engine.get_state()
        status = "enabled" if req.enabled else "disabled"
        duration_str = f" for {req.duration_minutes} minutes" if req.duration_minutes else ""
        return {
            "ok": True,
            "result": f"Focus Mode {status}{duration_str}. Proactive chatter {'suppressed' if req.enabled else 'resumed'}.",
            "focus_mode": state["focus_mode"],
            "focus_mode_expires": state["focus_mode_expires"],
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/proactive/settings")
def proactive_update_settings(req: ProactiveSettingsRequest) -> Dict[str, Any]:
    """Update Proactive Companion Engine runtime settings."""
    try:
        from .proactive_companion import proactive_engine
        proactive_engine.update_settings(
            proactivity_level=req.proactivity_level,
            persona_preset=req.persona_preset,
            active_task_threshold_sec=req.active_task_threshold_sec,
            idle_away_threshold_sec=req.idle_away_threshold_sec,
            proactive_cooldown_sec=req.proactive_cooldown_sec,
        )
        return {"ok": True, "state": proactive_engine.get_state()}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/proactive/activity")
def proactive_record_activity() -> Dict[str, Any]:
    """Signal user chat activity — resets the proactive inactivity timer."""
    try:
        from .proactive_companion import proactive_engine
        proactive_engine.record_user_chat_activity()
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/proactive/memory")
def proactive_add_reaction_memory(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Add an entry to the proactive reaction memory (narrative context)."""
    try:
        from .proactive_companion import proactive_engine
        proactive_engine.add_reaction_memory(payload)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/gateway/status")
def gateway_status() -> Dict[str, Any]:
    metrics: Dict[str, Any] = {}
    try:
        from .telemetry import collect_system_telemetry

        metrics = collect_system_telemetry()
    except Exception as error:
        log.warning("[JAYRA Gateway] Metrics unavailable: %s", error)
    return {
        "status": "ok",
        "name": "JAYRA Desktop Control Agent",
        "system": os.environ.get("COMPUTERNAME") or os.environ.get("HOSTNAME") or "JAYRA",
        "network_access": network_access_enabled(),
        "tool_count": len(TOOLS),
        "metrics": metrics,
    }


@app.post("/gateway/command")
def gateway_command(request: GatewayCommandRequest) -> Dict[str, Any]:
    prompt = request.prompt.strip() if request.prompt else ""
    tool = request.tool.strip() if request.tool else ""
    if bool(prompt) == bool(tool):
        return {"ok": False, "error": "Provide exactly one non-empty prompt or registered tool."}
    command: Dict[str, Any] = {"prompt": prompt} if prompt else {"tool": tool, "args": request.args or {}}
    log.info("[JAYRA Remote Command] Received %s", "prompt" if prompt else f"tool={tool}")
    try:
        result = forward_command_to_node(command)
    except (RuntimeError, ValueError) as error:
        return {"ok": False, "error": str(error)}
    return result


@app.post("/gateway/approval")
def gateway_approval(request: GatewayApprovalRequest) -> Dict[str, Any]:
    if not request.confirmation_id or len(request.confirmation_id) > 128:
        raise HTTPException(status_code=400, detail="Invalid confirmation id.")
    try:
        return forward_approval_to_node(request.confirmation_id, request.approved)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/gateway/upload")
async def gateway_upload(file: UploadFile = File(...)) -> Dict[str, Any]:
    safe_name = sanitize_upload_name(file.filename or "upload.bin")
    directory = remote_upload_directory()
    target = directory / f"{secrets.token_hex(12)}_{safe_name}"
    written = 0
    try:
        with target.open("xb") as output:
            while chunk := await file.read(64 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Uploads are limited to 20 MB.")
                output.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
    log.info("[JAYRA Gateway] Remote upload saved: %s (%d bytes)", target.name, written)
    return {"ok": True, "name": target.name, "size": written, "download": f"/gateway/download?name={target.name}"}


@app.get("/gateway/download")
def gateway_download(name: str) -> FileResponse:
    if Path(name).name != name or name in {"", ".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid file name.")
    downloads = remote_upload_directory().parent.resolve()
    upload_directory = (downloads / "remote_uploads").resolve()
    candidate = upload_directory / name
    target = candidate if candidate.is_file() else downloads / name
    if target.suffix.lower() in {".exe", ".dll", ".bat", ".cmd", ".ps1", ".msi", ".com", ".scr", ".js", ".vbs"}:
        raise HTTPException(status_code=403, detail="Executable downloads are blocked.")
    if target.is_symlink() or not target.is_file() or target.resolve().parent not in {downloads, upload_directory}:
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(target, filename=name, media_type="application/octet-stream")


@app.get("/gateway/stream")
def gateway_stream():
    def events():
        try:
            yield b": connected\n\n"
            for line in iter_node_events():
                yield line
        except Exception as error:
            log.info("[JAYRA Gateway] SSE relay ended: %s", error)

    return StreamingResponse(events(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    })


@app.get("/gateway/connect-info")
def gateway_connect_info(request: Request) -> Dict[str, Any]:
    client_host = request.client.host if request.client else None
    if not is_loopback(client_host):
        raise HTTPException(status_code=404)
    return {"enabled": network_access_enabled(), "port": agent_port(), "urls": local_network_urls(agent_port()), "token": get_gateway_token()}


@app.get("/observe")
def observe() -> Dict[str, Any]:
    """Return a privacy-limited local desktop metadata snapshot."""
    return collect_snapshot()


@app.get("/telemetry")
def telemetry() -> Dict[str, Any]:
    from .telemetry import collect_system_telemetry

    return collect_system_telemetry()


@app.post("/vision/inspect")
def vision_inspect(req: VisionInspectRequest) -> Dict[str, Any]:
    from .vision_inspector import capture_vision_frame

    return capture_vision_frame(req.model_dump())


@app.post("/automation/mouse")
def automation_mouse(payload: Dict[str, Any]) -> Dict[str, Any]:
    from . import ui_automation

    action = str(payload.get("action") or "").lower()
    try:
        if action == "click_at":
            return ui_automation.click_at(payload.get("x"), payload.get("y"), str(payload.get("button") or "left"))
        if action == "double_click":
            return ui_automation.double_click(payload.get("x"), payload.get("y"))
        if action == "right_click":
            return ui_automation.right_click(payload.get("x"), payload.get("y"))
        if action == "scroll":
            return ui_automation.scroll(payload.get("amount", 0))
        return {"success": False, "error": f"Unsupported mouse action: {action or '(empty)'}"}
    except ToolError as error:
        return {"success": False, "error": error.message}


@app.post("/automation/keyboard")
def automation_keyboard(payload: Dict[str, Any]) -> Dict[str, Any]:
    from . import ui_automation

    action = str(payload.get("action") or "").lower()
    try:
        if action == "type_text":
            return ui_automation.type_text(payload.get("text"), payload.get("interval", 0.02))
        if action == "press_hotkey":
            keys = payload.get("keys")
            if not isinstance(keys, list):
                return {"success": False, "error": "keys must be a list of hotkey names."}
            return ui_automation.press_hotkey(*[str(key) for key in keys])
        return {"success": False, "error": f"Unsupported keyboard action: {action or '(empty)'}"}
    except ToolError as error:
        return {"success": False, "error": error.message}


@app.post("/automation/window")
def automation_window(payload: Dict[str, Any]) -> Dict[str, Any]:
    from . import ui_automation

    action = str(payload.get("action") or "").lower()
    title = str(payload.get("title") or "")
    try:
        handlers = {
            "focus": ui_automation.focus_window,
            "minimize": ui_automation.minimize_window,
            "maximize": ui_automation.maximize_window,
            "close": ui_automation.close_window,
        }
        handler = handlers.get(action)
        if handler is None:
            return {"success": False, "error": f"Unsupported window action: {action or '(empty)'}"}
        return handler(title)
    except ToolError as error:
        return {"success": False, "error": error.message}


@app.post("/browser/action")
async def browser_action(payload: Dict[str, Any]) -> Dict[str, Any]:
    from .browser_agent import browser_agent

    try:
        return await browser_agent.perform(payload)
    except ToolError as error:
        return {"success": False, "error": error.message}


@app.get("/proactive/state")
def proactive_state() -> Dict[str, Any]:
    from .proactive_companion import proactive_engine

    return proactive_engine.get_state()


@app.post("/proactive/chat-activity")
def proactive_chat_activity() -> Dict[str, Any]:
    from .proactive_companion import proactive_engine

    proactive_engine.record_user_chat_activity()
    return {"success": True}


@app.post("/proactive/focus-mode")
def proactive_focus_mode(payload: Dict[str, Any]) -> Dict[str, Any]:
    from .proactive_companion import proactive_engine

    enabled = bool(payload.get("enabled", False))
    duration = payload.get("duration_minutes")
    if duration is not None:
        try:
            duration = float(duration)
        except (ValueError, TypeError):
            duration = None
    proactive_engine.set_focus_mode(enabled, duration_minutes=duration)
    return {"success": True, "state": proactive_engine.get_state()}


@app.get("/proactive/reaction-memory")
def proactive_reaction_memory(limit: int = 5) -> List[Dict[str, Any]]:
    from .proactive_companion import proactive_engine

    return proactive_engine.get_reaction_memory(limit=limit)



@app.post("/execute", response_model=ExecuteResponse)
async def execute(req: ExecuteRequest) -> ExecuteResponse:
    tool = req.tool
    args = req.args or {}
    log.info("EXEC tool=%s args=%s", tool, _short_args(args))

    if tool not in TOOLS:
        known = ", ".join(sorted(TOOLS.keys()))
        return ExecuteResponse(
            ok=False,
            error=f"Unknown tool '{tool}'. Known tools: {known}",
            tool=tool,
        )

    handler = TOOLS[tool]
    try:
        if inspect.iscoroutinefunction(handler):
            out = await handler(args)
        else:
            out = await run_in_threadpool(handler, args)
            if inspect.isawaitable(out):
                out = await out
    except ToolError as e:
        log.warning("ToolError in %s: %s", tool, e.message)
        return ExecuteResponse(ok=False, error=e.message, tool=tool)
    except Exception as e:  # noqa: BLE001
        log.error("Unhandled error in %s: %s\n%s", tool, e, traceback.format_exc())
        return ExecuteResponse(
            ok=False,
            error=f"Internal error in {tool}: {e}",
            tool=tool,
        )

    # Handlers return dicts like {"result": "..."}; pass the whole payload.
    result_text = ""
    if tool == "getSystemTelemetry":
        result_text = "system metrics fetched"
    elif isinstance(out, dict):
        result_text = str(out.get("result", out))
    else:
        result_text = str(out)
    log.info("DONE tool=%s -> %s", tool, result_text[:160])

    return ExecuteResponse(ok=True, result=out, tool=tool)


def _short_args(args: Dict[str, Any]) -> str:
    """Log argument names only; values may contain personal or secret data."""
    return "{keys=[" + ", ".join(sorted(args.keys())) + "]}"


def main() -> None:
    """Allow `python -m desktop_agent.main` to launch uvicorn."""
    import uvicorn

    host = agent_bind_host()
    port = agent_port()
    log.info("Launching uvicorn on %s:%d", host, port)
    uvicorn.run(
        "desktop_agent.main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
