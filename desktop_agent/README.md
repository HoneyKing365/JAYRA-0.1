# JAYRA Desktop Control Agent

A local Python FastAPI service that gives JAYRA **JARVIS-style desktop control** —
open apps, manage files, control volume, take screenshots, OCR the screen, control the
user's real Windows browser, run code, read system stats, and more.

> **This agent does NOT modify JAYRA's UI, personality, or chat system.** It is a pure
> backend tool layer that JAYRA's existing Node bridge (`server.ts`) calls over HTTP.

---

## Prerequisites

| Dependency | Why | Notes |
|---|---|---|
| **Python 3.11+** | Runtime | Use the full interpreter path, e.g. `C:\Users\MSI\AppData\Local\Programs\Python\Python311\python.exe` |
| **pip** | Install Python packages | Ships with Python |
| **Tesseract OCR** *(optional)* | Screen text reading | Download from [UB-Mannheim/tesseract](https://github.com/UB-Mannheim/tesseract/wiki). Non-OCR tools work without it. |

---

## Setup (one-time)

```bash
# 1. Navigate to the project root
cd C:\Users\MSI\Desktop\jayra-ai-assistant

# 2. Install Python dependencies (use the full interpreter path if `python` shim is broken)
"C:\Users\MSI\AppData\Local\Programs\Python\Python311\python.exe" -m pip install -r desktop_agent/requirements.txt

# 3. (Optional) Install Tesseract OCR for screen-reading capabilities
#    Download installer from: https://github.com/UB-Mannheim/tesseract/wiki
#    Install to default path: C:\Program Files\Tesseract-OCR\
```

---

## Run

```bash
# Start the desktop agent on port 8765
"C:\Users\MSI\AppData\Local\Programs\Python\Python311\python.exe" -m desktop_agent.main

# Or with uvicorn directly:
"C:\Users\MSI\AppData\Local\Programs\Python\Python311\python.exe" -m uvicorn desktop_agent.main:app --host 127.0.0.1 --port 8765
```

The agent binds to `127.0.0.1:8765` by default. Then start JAYRA normally with `npm run dev`.

### Optional local-network gateway

Network access is disabled by default. To expose the sidecar to devices on the same trusted LAN, set `JAYRA_NETWORK_ACCESS=true` before starting JAYRA. The auto-launched sidecar then binds to `0.0.0.0` on `JAYRA_AGENT_PORT` (default `8765`). You can set `JAYRA_AGENT_HOST` to a specific local interface IP instead.

Remote requests must send `X-JAYRA-Token: <token>` or `Authorization: Bearer <token>`. Set `JAYRA_GATEWAY_TOKEN` to a random value of at least 32 characters, or let JAYRA generate and store one in `%APPDATA%\JAYRA\gateway.token` (Windows) / `~/.config/jayra/gateway.token` (other platforms). The token is never returned by an API. Configure browser origins with a comma-separated `JAYRA_GATEWAY_ALLOWED_ORIGINS`; CORS is not a substitute for the token.

The gateway exposes `GET /gateway/status` and `POST /gateway/command`. Commands are forwarded to the local Node server and use its ReAct/task engine or permission-bound tool executor. Do not forward port `3000`; it intentionally stays on loopback. Disabling `JAYRA_NETWORK_ACCESS` returns the sidecar to loopback-only operation.

---

## API

### `GET /health`
Returns `{ status: "ok", tools: [...], tool_count: N }`.

### `GET /tools`
Returns the list of registered tool names.

### `GET /telemetry`
Returns live CPU, memory, battery/power, C: drive, and top-process metrics.

### `POST /vision/inspect`
Captures a bounded JPEG frame for Node's configured Gemini Vision model. The API key stays in the Node backend; JAYRA's own foreground window is hidden during capture.

### `POST /automation/mouse`, `/automation/keyboard`, `/automation/window`
Provide bounded native input operations. The desktop corner fail-safe remains enabled; the Node safety policy requires confirmation for these risk-level-3 tools.

### `POST /browser/action`
Run one bounded Playwright Chromium action. Headless mode is the default; install the browser binary with `python -m playwright install chromium` when it is not bundled.

### `POST /execute`
```json
{ "tool": "openApplication", "args": { "name": "notepad" } }
```
Returns:
```json
{ "ok": true, "result": { "result": "Notepad opened." }, "tool": "openApplication" }
```
On error:
```json
{ "ok": false, "error": "File does not exist: ...", "tool": "readFile" }
```

---

## Available Tools

### 🖥️ Applications
| Tool | Description |
|---|---|
| `openApplication` | Open Notepad, Chrome, VS Code, Calculator, Explorer, Task Manager, Settings, etc. |
| `closeApplication` | Close a running application by name |

### 🌐 Websites & Search
| Tool | Description |
|---|---|
| `openWebsite` | Open a named site (YouTube, Gmail, GitHub…) or arbitrary URL in the default browser |
| `searchWeb` | Search any engine (Google, YouTube, GitHub, DuckDuckGo, Bing) |
| `searchYouTube` | Shortcut: search YouTube |
| `searchGoogle` | Shortcut: search Google |
| `searchGitHub` | Shortcut: search GitHub |

### 📁 Files
| Tool | Description |
|---|---|
| `createFile` | Create a text file with content |
| `readFile` | Read a file's contents |
| `renameFile` | Rename a file |
| `deleteFile` | Delete a file (sends to Recycle Bin by default) |
| `moveFile` | Move a file to a new location |
| `openFolder` | Open Desktop, Documents, Downloads, etc. in Explorer |
| `listFiles` | List files in a folder |
| `searchFiles` | Find files by name/extension (e.g. "find my Python files") |

### 🎛️ PC Control
| Tool | Description |
|---|---|
| `volumeUp` | Increase volume |
| `volumeDown` | Decrease volume |
| `setVolume` | Set volume to a specific percentage |
| `muteToggle` | Toggle mute/unmute |
| `requestPowerAction` | **Step 1**: Request confirmation token for shutdown/restart/sleep/lock |
| `executePowerAction` | **Step 2**: Execute the power action with a valid token |

### 🪟 Window Management
| Tool | Description |
|---|---|
| `minimizeWindow` | Minimize active or named window |
| `maximizeWindow` | Maximize active or named window |
| `closeWindow` | Close active or named window |
| `switchApplication` | Switch to a named window, or Alt+Tab cycle |

### 📋 Clipboard
| Tool | Description |
|---|---|
| `copySelected` | Copy selected text (sends Ctrl+C, reads clipboard) |
| `pasteClipboard` | Paste text into the active input |
| `getClipboard` | Read current clipboard contents |
| `clearClipboard` | Empty the clipboard |

### 📸 Screenshot & Screen Reading
| Tool | Description |
|---|---|
| `takeScreenshot` | Capture the full screen |
| `saveScreenshot` | Save screenshot to Pictures/MyraaScreenshots (existing data path) |
| `analyzeScreenshot` | Screenshot + OCR to extract visible text |
| `readScreen` | Read the active window's title + visible text via OCR |
| `inspectScreenVision` | Analyze a fresh screen capture with the configured vision model |

### 🌐 Real Windows Browser
| Tool | Description |
|---|---|
| `openWebsite` | Open a URL in the user's Windows default browser |
| `searchWeb` / `searchGoogle` | Search in the active default-browser tab |
| `searchYouTube` / `searchGitHub` | Open service-specific results in that same tab |
| `viewScreen` / `readScreen` | Observe the browser that is actually visible |
| `clickText` / `typeText` / `hotkey` / `scroll` | Control the visible browser with native input |
| `browser_control` | Headless Chromium navigation, click/fill, extraction, and screenshot; click/fill require confirmation |

### 💻 Coding Assistance
| Tool | Description |
|---|---|
| `createPythonFile` | Write a .py file |
| `writeCodeFile` | Write a code file in any language |
| `createProjectFolder` | Scaffold a project folder with subfolders |
| `runPythonScript` | Execute a Python script (captured output) |

### 📊 System Information
| Tool | Description |
|---|---|
| `systemInfo` | CPU, RAM, disk usage, uptime |
| `getSystemTelemetry` | Live CPU, RAM, battery/power, C: disk, top five processes |
| `gpuInfo` | NVIDIA GPU utilization, VRAM, temperature |
| `temperatureInfo` | All available temperature sensors |

---

## Safety

- **Power actions** (shutdown, restart, sleep, lock) require a **two-step confirmation token**: JAYRA must first call `requestPowerAction` (which issues a single-use, 60-second token), ask the user out loud to confirm, then call `executePowerAction` with the token. Without a valid token, the action is refused.
- **File deletions** go to the Recycle Bin by default (`send2trash`).
- **File operations** are scoped to safe folders (Desktop, Documents, Downloads, Pictures, Music, Videos, home, project root). Paths outside these roots are rejected.
- **Python script execution** has a configurable timeout (default 30s).

---

## Architecture

```
JAYRA voice chat (existing, untouched)
        ↓
Gemini Live API (existing)
        ↓
server.ts — functionCall routing
        ↓
HTTP POST → localhost:8765/execute
        ↓
Python FastAPI desktop_agent
        ↓
pyautogui / pywin32 / psutil / Windows OCR / pytesseract / etc.
        ↓
Windows Desktop
```
