# JAYRA 0.1.0 — source code

JAYRA is a 3D AI companion for Windows: she talks with you by voice (Google Gemini Live),
can see your screen when you allow it, controls apps and files on your PC, and lives on your
desktop as a character you can drag onto windows.

This pack is the full source. If you just want to use JAYRA, install the setup .exe instead.

## What is NOT included (on purpose)

- **No API key.** You use your own free Gemini key from https://aistudio.google.com.
- **No 3D character model.** The models used while developing JAYRA have licences that forbid
  redistribution. Import your own MMD model (.pmx, or a .zip / folder containing one) in the app:
  the first screen offers **Import my character**, or use Settings → Character → Character Studio.
  Only use models whose licence allows your use.
- No personal data, logs, memories or settings.

## Requirements

- Windows 10 or 11 (64-bit)
- Node.js 20 or newer (https://nodejs.org)
- Python 3.11 (only to run or rebuild the desktop agent from source)

## Run it in development

```
npm install
pip install -r desktop_agent/requirements.txt
npm run dev
```

Open http://localhost:3000 in Chrome. The first screen asks for your Gemini API key
(stored encrypted with Windows DPAPI in your user data folder, never in the project).

Desktop app (Electron, with the desktop companion):

```
npm run app
```

Optional: copy `.env.example` to `.env` for development settings. Do not put a real key in a file
you share.

## Build the installer

1. Build the desktop agent (PyInstaller):
   ```
   python -m pip install -r desktop_agent/requirements.txt
   python -m PyInstaller desktop_agent.spec --noconfirm --clean --distpath agent_dist --workpath agent_build
   ```
2. Build the public installer (no bundled character):
   ```
   npm run dist:public
   ```
   Output: `release-public/JAYRA-Setup-<version>.exe`

`npm run dist` (electron-builder.yml) expects a character in `assets/characters/`, which is not
included; use `dist:public`.

## Plugin extensions

The Central Brain stores signed plugins in `COGNITION_DATA_DIR/plugins`. In packaged
Electron builds, `COGNITION_DATA_DIR` resolves to Electron's writable `userData`
directory, not the read-only installation directory. In source development it uses the
configured cognition data directory (normally `.myraa-data`).

Each plugin is a folder named for its lowercase plugin ID and contains a `manifest.json`
signed package envelope:

```json
{
  "manifest": {
    "schemaVersion": 1,
    "id": "sample-plugin",
    "name": "Sample Plugin",
    "version": "1.0.0",
    "description": "Example tool extension.",
    "tools": [{
      "name": "sample_plugin_echo",
      "description": "Echo a value.",
      "arguments_schema": {
        "type": "object",
        "properties": { "value": { "type": "string" } },
        "required": ["value"]
      },
      "entryPoint": "tools/echo.py",
      "requiredCapabilities": ["code_execution"]
    }]
  },
  "files": [{ "path": "tools/echo.py", "contentBase64": "<base64 source>" }],
  "signature": "<base64 Ed25519 signature>"
}
```

The signature covers the canonical manifest and file list. The runtime validates plugin
IDs, namespaced tool names, schemas, declared capabilities, safe relative entry paths,
package size, and the trusted Ed25519 signature before activation. Plugin packages must
be signed by the key configured as `JAYRA_PLUGIN_PUBLIC_KEY` (PEM or base64 SPKI); unsigned
or invalid packages are rejected and diagnosed. The plugin directory is monitored for
new, changed, and removed packages, and valid tools register or unload live.

To enable updates, set `JAYRA_PLUGIN_UPDATE_URL` to an HTTPS custom endpoint returning a
signed package, or to a GitHub Releases API endpoint with a `.jayra-plugin.json` asset.
Both update sync and local discovery verify the same signature before installing. The
desktop agent validates generated tool code before it is loaded; tool execution continues
to use the normal Central Brain permission and confirmation checks.

Windows executable and installer branding uses `build/icon_vector.ico` (with
`build/icon_vector.png` for tray and notifications). The cosmic `build/icon.png`
remains the in-app favicon and splash artwork.

## Project map

| Folder | What it is |
|---|---|
| `src/` | React UI, the 3D character engine (three.js, MMD/PMX), desktop companion renderer |
| `electron/` | Desktop shell: windows, tray, desktop companion brain, crash recovery |
| `server.ts`, `runtime/` | Local backend (Express + WebSocket), Gemini Live bridge |
| `agent/` | PC-control agent: planner, actions, WhatsApp/chat helpers, safety checks |
| `desktop_agent/` | Python tool server (UI Automation, input, files, apps) |
| `models/` | Model router (Gemini and others) |
| `voice/` | Live voice tools |
| `settings/`, `permissions/`, `secrets/` | Settings, permission engine, DPAPI key store |
| `character_import/` | PMX importer and capability report |
| `cognition/`, `memory/`, `presence/` | Memory, initiative and presence |

## Graphics quality

Settings → Character → Graphics quality: Auto, High, Medium, Optimized, Potato PC.
Auto steps down by itself if the character crashes on a weak GPU.

## Safety

- The API key never reaches the web page; all Gemini calls go through the local backend.
- High-risk actions (sending messages, deleting, installing, purchases) ask for confirmation.
- Text from websites, documents and the screen is treated as untrusted data.
- Stop everything any time with the emergency shortcut (default Ctrl+Alt+Shift+S).
