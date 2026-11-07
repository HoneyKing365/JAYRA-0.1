# JAYRA / Myraa — Architecture, Integration & Health Audit

**Reviewed source version:** `0.1.0` (`package.json`)  
**Audit basis:** static source/configuration review of this checkout. Status means reachable from the repository's declared runtime paths; it does not certify external credentials, permissions, hardware, packaging, or provider availability. No application, installer, or live external service was run for this document.

## 1. Project vision and executive summary

### What the project is

JAYRA (also called **Myraa** in internal runtime names and older environment/data paths) is a Windows-first desktop AI companion. It combines a React HUD and optional transparent desktop avatar with voice/chat, an autonomous PC task loop, screen/UI perception, configurable model providers, local settings/memory, and a Python automation sidecar. Its visual presentation includes a 3D MMD/PMX character, a hologram face, and a Jarvis-style orb. A separate Android application is present as a phone companion.

The project is more than a chat front end: Electron owns desktop lifecycle and privileged window/OS integration; the Node process owns application APIs, orchestration, cognition, permissions, persistence, and provider credentials; the Python process supplies Windows UI automation/perception tools. The browser renderer is intentionally not given Node access.

### Core technology stack

| Layer | Technologies evidenced in manifests/source |
|---|---|
| Desktop shell | Electron 43, CommonJS main/preloads, Windows native helpers (`koffi`, Win32 integrations) |
| Web UI | TypeScript 5.8, React 19, Vite 6, Tailwind CSS 4, Motion, Lucide |
| Visual/character rendering | Three.js 0.180, WebGL, `mmd-parser`, custom PMX/MMD loaders, animation/physics/material systems |
| Backend | Node.js (README requires 20+), TypeScript/ESM source, Express 4, `ws` WebSockets, server-sent events |
| AI/model access | `@google/genai` (Gemini and Gemini Live), provider-neutral adapters for Gemini, OpenAI-compatible and Anthropic-compatible APIs |
| Desktop sidecar | Python 3.11, FastAPI, Uvicorn, PyInstaller, PyAutoGUI, pywinauto, MSS, Playwright, Windows/WinRT and telemetry libraries |
| Phone client | Android/Kotlin, Jetpack Compose, Android SDK 35, OkHttp WebSockets, Moshi, coroutines, CameraX/ZXing |
| Persistence/validation | Versioned JSON files, atomic JSON writer, localStorage renderer cache/history; typed schemas and permission policies |
| Build/test | npm scripts, TypeScript compiler, Node test runner, Python unittest, PyInstaller, electron-builder, Gradle |

`package.json`, `desktop_agent/requirements.txt`, `desktop_agent.spec`, and `android/app/build.gradle.kts` are the primary dependency/build references. Some optional providers and local models require user configuration; they are not implicitly available just because an adapter exists.

### High-level topology

```text
 User
  │
  ├── JAYRA desktop ───────────────────────────────────────────────────────────┐
  │   Electron main (electron/main.cjs)                                         │
  │     ├─ owns windows, tray, shortcuts, native dialogs, screen-capture IPC     │
  │     ├─ starts Node backend child (dist/server.cjs)                          │
  │     └─ allowlisted contextBridge APIs (electron/preload.cjs)                │
  │          │                                                                   │
  │          ├── React renderer (src/main.tsx → src/App.tsx)                     │
  │          │     ├─ REST → Express                                             │
  │          │     ├─ WS /live → voice/chat + Live tool calls                    │
  │          │     ├─ WS /events → tasks, confirmations, telemetry, state       │
  │          │     └─ Three.js / WebGL HUD, character, overlays and widgets      │
  │          │                                                                   │
  │          └── Node backend (server.ts + runtime/myraaRuntime.ts)              │
  │                ├─ CentralBrain → ToolRegistry/ToolExecutor → permissions     │
  │                ├─ CognitionRuntime / initiative / structured memory          │
  │                ├─ TaskManager → planner → perception → action → verify      │
  │                ├─ Express REST + WS /live, /events, /mobile-bridge + SSE    │
  │                ├─ model router → configured cloud/local provider APIs       │
  │                ├─ plugin manager → signed manifests/files → hot registration│
  │                └─ loopback HTTP + internal token → Python FastAPI sidecar    │
  │                       └─ Windows input, apps, files, windows, browser,       │
  │                          screenshots, OCR/UIA, telemetry and perception     │
  │                                                                               
  └── Android companion (android/) ── LAN discovery + authenticated bridge ─────┘
                                  (phone bridge commands/events/audio/files)

  Data: per-user application data / configured data directories
        ├─ settings, secrets, permission policy, contacts, memories
        ├─ cognition and model configuration
        └─ plugins and validated dynamic desktop tools
```

In packaged Electron, the backend is launched as a child process and uses the writable user-data directory supplied by Electron. The Python agent may run from source in development or as a frozen PyInstaller sidecar. The React renderer communicates with the backend over the local HTTP/WebSocket contracts; IPC is reserved for shell/overlay integration, not the general model/tool API.

## 2. Subsystem and architecture breakdown

### 2.1 Electron shell and privilege boundary

**Entry and lifecycle:** `package.json` points Electron at `electron/main.cjs`. `bootstrap()` starts the backend, waits for readiness, then creates the main window. The packaged Node backend is `dist/server.cjs`; Electron selects a local server origin for the renderer.

**Window/shell responsibilities:** `electron/main.cjs` manages the main HUD, splash, tray, single-instance behavior, notifications, emergency shortcut, desktop capture mediation, and auxiliary task/confirmation/companion windows. `electron/companion.cjs` supports the optional transparent always-on-top character window. `electron/win32.cjs` and `native/win32.ts` provide Windows-specific helpers.

**Preloads and security boundary:** the main renderer is configured with `contextIsolation: true` and `nodeIntegration: false`; `electron/preload.cjs` exposes named `window.myraa` methods through `contextBridge`, rather than a generic IPC send function. Dedicated overlay preloads (`electron/taskPreload.cjs`, `electron/overlayPreload.cjs`) narrow the available operations further. Task and confirmation overlays forward actions to the backend/shell through explicit IPC topics.

**Important boundary to preserve:** renderer UI state and rendering belong in React; OS privileges, windows, capture mediation, and backend process ownership belong in Electron main. Do not move secrets or unrestricted Node APIs into a renderer during UI redesign.

### 2.2 Node backend, runtime and Central Brain

`server.ts` is the production composition root: it configures data paths and services, starts model/cognition/agent integrations, manages the Python process, registers tools, creates Express and WebSocket services, and serves the renderer in the packaged/development flows. `runtime/myraaRuntime.ts` owns the broader app runtime: settings, permission/confirmation APIs, task-facing surfaces, contacts, telemetry/event fan-out, workspace, utilities, characters/assets and related feature services.

**Central Brain and tools**

- `runtime/centralBrain.ts` is the application façade for context dispatch, tool execution, diagnostics, dynamic desktop tools, plugin lifecycle, cancellation and tool health.
- `cognition/toolRegistry.ts` describes available tools; `cognition/toolExecutor.ts` executes registered handlers under permission/safety checks, confirmation, retry, cancellation and status reporting.
- `CentralBrain` supports explicit fallbacks only when both tools are registered, share a permission scope, and are low-risk/read-only (risk level at most 1). Fallbacks are not general “retry with anything” behavior.
- `runtime/myraaRuntime.ts` also creates a shared `CapabilityController`; action modules retain their handlers while the controller enforces the registered capability boundary.
- `voice/liveAgentTools.ts` declares the Live-facing tools and routes them into task, utility, contact, companion, mobile, summary, weather and telemetry services. Its names include `startTask`, `getTaskStatus`, `controlTask`, `answerTask`, `respondToConfirmation`, `setReminder`, `listReminders`, `setDoNotDisturb`, `setProactivity`, `saveContact`, `sendChatMessage`, `companionAction`, `phoneAction`, `showDailySummary`, `getDailySummaryContext`, `getWeatherAndNews`, and `getSystemTelemetry`.

**Two orchestration loops are in active use**

1. **Live function-call loop:** `agent/reactEngine.ts`, invoked by `server.ts`, handles bounded Live tool iterations (10 per request) and limited correction/recovery attempts. The Live assistant delegates multi-step or screen-dependent work to `startTask`; it should not manually drive a long sequence of low-level UI operations.
2. **Autonomous task loop:** `agent/loop.ts` is used by the task manager in `runtime/myraaRuntime.ts`. It composes perception, planning, risk classification, action execution, observation/verification, recovery, cancellation and task status. Supporting modules include `agent/taskSession.ts`, `agent/scheduler.ts`, `agent/planner/`, `agent/perception/`, `agent/actions/`, `agent/recovery.ts`, `agent/references.ts`, and `agent/cancellation.ts`.

**Cognition and attention:** `cognition/runtime.ts` composes the cognitive pipeline. It normalizes input into `CognitiveEvent`s, updates `SituationModel`, evaluates `AutonomousMind`, retrieves/stores structured memories, runs attention/initiative/safety decisions, and notifies decision listeners. `server.ts` feeds it voice, desktop, task, tool and goal events. `cognition/attentionEngine.ts`, `initiativeEngine.ts`, `safety.ts`, `autonomousMind.ts`, `goalManager.ts`, `planner.ts`, `critic.ts`, `curiosityEngine.ts`, `proactivePresence.ts`, `socialInitiativeEngine.ts`, and `skillManager.ts` provide policy/state and decision support. `cognition/speechOrchestrator.ts` and runtime presence gates regulate whether discretionary speech is emitted.

**Memory and state:** `cognition/structuredMemory.ts` persists/query-ranks structured memories and event-derived episodes. `memory/workingMemory.ts` is intentionally short-lived in-memory context (utterances, referents, active task, recent failures); `memory/contacts.ts` persists contact aliases and resolves app-specific names. Legacy `memories.json` is loaded via `server_memory.ts` and imported into structured memory; `/api/memories` updates the legacy store and synchronizes it. This means “memory” is multiple connected stores, not one database.

**Model routing:** `models/registry.ts` loads built-ins plus user models/providers and persisted selection. `models/router.ts` ranks by task/capability, availability, tier, locality, health, quota and user selection; it adds bounded retries/fallbacks and records usage. Adapters in `models/providers/` cover Gemini, OpenAI-compatible and Anthropic-compatible APIs. `models/network.ts`, `rateLimit.ts`, `retry.ts` and `usage.ts` support routing. Gemini Live voice is a separate realtime session path; the generic router also serves configured conversation/planning/coding/vision/summarization/embedding calls.

**Secrets and paths:** `server_paths.ts` and `secrets/secretStore.ts` provide data and secret storage. README documents Windows DPAPI for user keys and a restricted-file fallback elsewhere. `MYRAA_DATA_DIR` is a legacy/runtime data-root convention; cognition and API Hub may use `COGNITION_DATA_DIR`, so these paths are not necessarily identical.

### 2.3 Express REST, WebSockets and event streams

The backend exposes a **local app API**, not a separately versioned public service. The route families in `server.ts` and `runtime/myraaRuntime.ts` include:

| Surface | Primary routes / contract | Purpose |
|---|---|---|
| Live voice/chat | `WS /live` | Text/audio/control input; Live model audio, transcripts, turn completion, tool/task status and memory synchronization out. |
| Renderer/runtime events | `WS /events` | `{type, at, payload}` events with initial state/task/confirmation snapshots and subsequent `appEvents` fan-out. |
| Phone companion | `WS /mobile-bridge`; `/api/mobile/connect-info`; mobile command/status routes | Pairing/connect metadata, phone status and remote actions, file-transfer/audio/clipboard/session events. |
| SSE alternative | `GET /api/gateway/events` | Server-sent event stream from the shared event hub; seeds pending confirmations. |
| App state/settings | `/api/app-settings`; `/api/settings` | Runtime settings versus renderer-compatibility settings/TTS surface (see health findings). |
| Tasks and approvals | `/api/tasks`, `/api/tasks/recoverable`, `/api/tasks/:id`, `/api/tasks/:id/:action`, `/api/confirmations`, `/api/confirmations/:id`, `/api/cognition/confirm` | Create/list/recover/control tasks, answer questions, and resolve capability/cognition confirmations. |
| Brain/tools/plugins | `/api/brain/status`, `/api/brain/tools`, `/api/brain/tools/refresh`, `/api/brain/tools/generate`, `/api/brain/plugins`, `/api/brain/plugins/sync` | Tool manifest/status, refresh sidecar tools, generated-tool request path, plugin status/install/synchronization. |
| Cognition and API Hub | Cognition status/pause/resume/simulation, goals/skills; API Hub status/search/provider/sync/health/adapter-call routes | Cognitive observability/control and declarative API catalogue/adapter calls. Implementations are in `server.ts`, `cognition/`, and `api_hub/`. |
| Settings and safety | `/api/permissions`, `/api/permissions/:capability`, `/api/permissions/messaging`; persona and settings routes | Inspect/update permission policy, messaging confirmation behavior, persona and settings. |
| Memory and retrospectives | `/api/memories`, `/api/memories/:id`, `/api/kg/summary`, `/api/kg/generate` | Manage memories and daily summary/knowledge-graph cards. |
| Workspace/Code Studio | `/api/workspace/files`, `/api/workspace/file`, create/rename/delete/folder/template/execute routes | Browse and mutate the configured workspace, scaffold, and run bounded workspace commands. |
| HUD services | `/api/weather-news`, `/api/cities/search`, `/api/screen-vision`, `/api/games/tic-tac-toe/move` | Weather/news, city lookup, consented screen vision, and Tic-Tac-Toe. |
| Other runtime services | Contacts, utilities/reminders, automations, characters/assets/poses, telemetry, mobile, notification and diagnostic routes | Feature-specific JSON APIs registered by the runtime/server composition. See `runtime/myraaRuntime.ts` and `server.ts` for the live route definitions. |

Route families above are an architectural index, not a promise of stable external API versioning. The exact payloads and error/status codes must be checked at the handler/client pair before replacing a client. The more UI-specific request/response map is also captured in the source companion inventory `hud.md`; this master document does not make that file a runtime dependency.

`shared/appEvents.ts` defines the UI/event envelope and state-like snapshot replay. It includes task, confirmation, question, presence, conversation, social, model, notification, character cue, speech/voice, diagnostics, workspace briefing and telemetry events. Do not confuse this **application UI event hub** with `cognition/eventBus.ts`, which carries typed cognition events internally.

### 2.4 Python desktop-agent sidecar

`desktop_agent/main.py` creates the FastAPI app, loads the tool registry and serves the sidecar. `desktop_agent/registry.py` dynamically imports built-in tool modules and custom tools. The central execution route is `POST /execute` with a tool name and args; Node's `callDesktopAgent()` forwards the request with an internal-token header. The app also exposes health/tool discovery/reload and routes for observation, telemetry, vision, browser/UI automation, custom-tool lifecycle, proactive events/settings, focus mode and the gateway.

**Tool groups and representative registered operations**

- **Apps/web/search:** `openApplication`, `closeApplication`, `openWebsite`, `searchWeb`, `searchYouTube`, `searchGoogle`, `searchGitHub`.
- **Files:** `createFile`, `readFile`, `renameFile`, `deleteFile`, `moveFile`, `openFolder`, `listFiles`, `searchFiles`, `knownFolder`, `recentFiles`, `statPath`, `copyFile`, `openPath`.
- **Windows/input/targeting:** `getActiveWindow`, `listVisibleWindows`, `switchApplication`, `minimizeWindow`, `maximizeWindow`, `closeWindow`, `window_control`, `gui_click`, `gui_type`, `locateText`, `clickText`, `moveMouse`, `click`, `doubleClick`, `rightClick`, `drag`, `scroll`, `typeText`, `pressKey`, `hotkey`, `getCursorPosition`, `waitForUi`, `observeDesktopState`.
- **System/power:** `volumeUp`, `volumeDown`, `muteToggle`, `setVolume`, `requestPowerAction`, `executePowerAction`, `systemInfo`, `getSystemTelemetry`, `gpuInfo`, `temperatureInfo`, `brightnessUp`, `brightnessDown`, `setBrightness`, `enableAutoStart`, `disableAutoStart`, `getAutoStartStatus`.
- **Browser/UIA/clipboard:** `browser_control`, `browserState`, `inspectUi`, `findUi`, `uiAction`, `copySelected`, `pasteClipboard`, `getClipboard`, `clearClipboard`, `typeUnicode`, `copyFilesToClipboard`, `setClipboardText`.
- **Screen/perception:** `takeScreenshot`, `saveScreenshot`, `analyzeScreenshot`, `readScreen`, `viewScreen`, `screenFingerprint`, `captureForVision`, `getMonitors`, `inputState`, `windowControl`.
- **Code/script execution:** `createPythonFile`, `runPythonScript`, `runPowerShellScript`, `createProjectFolder`, `writeCodeFile`, and bounded scripts.
- **Desktop arrangement:** `desktopIcons`, `moveDesktopIcon`, `selectFiles`.

Tool modules include `tools_applications.py`, `tools_websites.py`, `tools_files.py`, `tools_files_ext.py`, `tools_system.py`, `tools_windows.py`, `tools_input.py`, `tools_input_ext.py`, `tools_targeting.py`, `tools_clipboard.py`, `tools_screenshot.py`, `tools_perception.py`, `tools_coding.py`, `tools_startup.py`, `tools_desktop_icons.py`, `tools_explorer.py`, `browser_agent.py`, `ui_automation.py`, `telemetry.py`, `vision_inspector.py`, `tool_builder.py`, and `tool_generator.py`.

`desktop_agent/proactive_companion.py` observes foreground-app/window category and idle/context history with cadence/cooldown/focus controls. `desktop_agent/perception.py` and `cognition/desktopPerception.ts` pass metadata changes into cognition; that metadata observation is distinct from screenshot capture.

**Dynamic tools:** `tool_builder.py` and `tool_generator.py` validate source/schema and test/register generated Python tools. Signed plugins and Code Studio can request that pathway; Central Brain still mediates execution through permissions and confirmation policy.

### 2.5 Renderer, HUD and character presentation

`index.html` → `src/main.tsx` mounts the normal app behind `ApiKeyGate`/`CrashGuard`, or loads `src/companion/CompanionApp.tsx` for `?mode=companion`. `src/App.tsx` is the primary composition/navigation state owner; `src/components/Sidebar.tsx` and `SettingsPanel.tsx` open reachable views and configure them. `src/lib/appApi.ts` centralizes most backend calls; `src/lib/useAppEvents.ts` consumes event streams.

**Central visual stage modes** (selected from `hud.visualMode` in app settings):

| Mode | Component | Role |
|---|---|---|
| 3D character stage | `src/components/Companion3DStage.tsx` | Selected avatar, animation, gaze, expression, audio synchronization and visual effects. |
| Hologram face | `src/components/HologramFace.tsx` | Alternate face-focused HUD renderer. |
| Jarvis orb | `src/components/JarvisOrb.tsx` | Alternate orb visualizer with quality, particle, bloom, speed and reflection settings. |

The Mark LV overlay (`MarkLvHud.tsx`) is an overlay, not a fourth stage. `SystemTelemetryWidget.tsx` renders system samples; `WeatherNewsWidget.tsx` displays configured-location weather/RSS news. The rest of the active HUD includes `FloatingChatDock`, task/confirmation overlays, `MemoryDashboard`, `DailySummaryCard`, `CodeStudio`, `MiniGamesHub`, model selector, gesture overlay, asset dropzone/modal, and diagnostics console. All are reachable from the main app/settings/companion flows as described in `src/App.tsx` and `src/components/Sidebar.tsx`.

**Character stack:** `src/character/` separates core stage/system/quality, MMD loaders, animation/behavior/face, material/lighting/physics, editor/scene and preview/testing code. `character_import/` stages/imports supported user-owned character assets; `shared/character/` holds reusable appearance/humanoid/profile/rig/secondary schemas. Character Studio is mounted inside the app; the standalone HTML entry is a separate harness.

**Additional mounted experiences:** Code Studio fronts workspace APIs, task dispatch and tool/plugin controls. Memory dashboard uses memory APIs. Mini-games calls Tic-Tac-Toe runtime. The chat dock's saved conversation sessions use `localStorage["jayra.chat-sessions.v1"]`; sending the next turn still uses `/live`. This is not a server-synchronized conversation history.

### 2.6 Settings, permissions, shared services and data

- **Runtime settings:** `settings/appSettings.ts` defines normalized version-3 settings stored as `<data>/app-settings.v3.json`: renderer preferences, behavior/presence, wellness, autonomy, voice/persona, companion/character, graphics/physics/performance, HUD, editor, localization, orb and weather/news.
- **Renderer compatibility settings:** `/api/settings` plus `src/lib/settingsStore.ts` retains a second renderer-facing cache/projection. `settings.json` is also described in source as a compatibility projection for the Python sidecar.
- **Permissions:** `permissions/types.ts` names the capability universe. `permissions/engine.ts` loads persisted allow/ask/deny policies with scoped rules, locked-to-ASK capabilities, trusted/known contacts and session grants. `permissions/controller.ts` is the shared authorize/confirm/execute boundary; `permissions/confirmations.ts` owns pending confirmation lifecycles. The high-impact locked set includes software execution/install, purchase, account change and power control.
- **Shared helpers:** `shared/appEvents.ts`, `jsonFile.ts`, `logger.ts`, `diagnosticLogger.ts`, `redact.ts`, `jsonSchema.ts` and `netSafety.ts` are used across runtime/UI tools for event fan-out, JSON persistence, logs/redaction, schema validation and outbound URL controls.
- **Services:** `services/systemMonitor.ts` supplies telemetry; `services/weatherNews.ts` retrieves weather and RSS headlines. `api_hub/` imports/searches API metadata, stores adapters, checks health and executes constrained adapter calls.
- **Supporting domain state:** `presence/` models user/conversation/social state; `companion/` contains reminders/utilities and wellness; `runtime/` includes workspace, character/assets, automation, knowledge graph, notification sync, mic gating, shadow execution, ambient-vibe and spatial-proximity services.
- **Persistence is mostly local JSON/localStorage, not a central database.** Atomic JSON writes exist in `shared/jsonFile.ts`; working memory and several live event/session structures are in process memory. Data roots differ by feature and environment (see Naming and data-directory notes below).

### 2.7 Plugin, signing and update ecosystem

`runtime/pluginManager.ts` is integrated with `runtime/centralBrain.ts` and the brain routes. It watches a writable per-user plugin directory, validates package shape/manifest/tool schemas/capabilities/paths/size and an Ed25519 signature, then passes Python sources to the sidecar validation/hot-loader. Plugin tools are namespaced; the current signed package contract uses `manifest`, `files` and `signature`. Tool descriptors specify `entryPoint` and `requiredCapabilities`; README's example uses `schemaVersion: 1` and `arguments_schema`.

Remote sync is optional and requires both `JAYRA_PLUGIN_UPDATE_URL` and `JAYRA_PLUGIN_PUBLIC_KEY`. The source can be an HTTPS endpoint or the documented GitHub Releases API form. Local discovery and updates use the same signature verification; the runtime can sync on startup and every six hours, or through the plugin sync API. The documented signed package limit is 5 MB; safe relative paths and plugin-namespaced tool names are required, and the currently supported requested capability is `code_execution`. Built-in `manifest.json` examples are data, not proof a plugin is installed. A valid signature authenticates a package to the configured key; it does not replace runtime permission checks or user confirmation.

Packaged writes belong under Electron's writable `userData`; source mode uses the configured JAYRA/MYRAA data directory or development fallback. `electron-builder.yml`, `electron-builder.public.yml`, `electron/afterPack.cjs`, `desktop_agent.spec`, and README describe packaging. The public installer excludes bundled character models; distributable builds also require a prebuilt `agent_dist/myraa-agent` sidecar.

## 3. Feature and component census

### Status definitions

- **[Connected & Active]** — source is imported/mounted, registered, called, or routed from a declared runtime path. Runtime availability can still depend on permissions, API keys, devices, models, or settings.
- **[Orphaned / Unlinked / Dead Code]** — source exists but no active application import/route/call path was found in the reviewed paths, or it is a separate harness rather than the app path.
- **[Development / Packaging Tooling]** — tests, sample harnesses, CLI/build/configuration assets or generated distribution outputs; not a user-facing runtime feature.

Status is assigned to the listed feature/path. A test file for an active subsystem is tooling, not an orphaned subsystem.

### Connected & Active

| Area | Source census | Verified runtime connection |
|---|---|---|
| Electron and React entry | `electron/main.cjs`, `electron/preload.cjs`, overlay preloads, `src/main.tsx`, `src/App.tsx`, `src/components/ApiKeyGate.tsx`, `CrashGuard.tsx` | Electron starts backend/window; main renderer mounts behind onboarding/error boundary; companion query mounts separately. |
| HUD/navigation/widgets | `Sidebar.tsx`, `SettingsPanel.tsx`, `FloatingChatDock.tsx`, `TaskHud.tsx`, `FloatingTaskHud.tsx`, `FloatingConfirmationOverlay.tsx`, `MemoryDashboard.tsx`, `DailySummaryCard.tsx`, `SystemTelemetryWidget.tsx`, `WeatherNewsWidget.tsx`, `MarkLvHud.tsx`, `CodeStudio.tsx`, `MiniGamesHub.tsx`, `GestureOverlay.tsx`, `ModelSelector.tsx`, asset overlays, `ErrorDiagnosticConsole.tsx` | Main app imports and conditionally renders these; they use runtime routes/events or local renderer state. |
| Visualizer and character | `Companion3DStage.tsx`, `HologramFace.tsx`, `JarvisOrb.tsx`; `src/character/{core,loaders,animation,behaviour,face,materials,lighting,physics,editor,scene}`; `character_import/`; `shared/character/` | Three visualizer branches are selected by app settings; imported character data feeds the character stage/studio. |
| Character validation support | `src/character/testing/CharacterTests.ts`, `src/components/character/ReportPanel.tsx` | Studio's report surface uses the validation helpers; they are support code, not a standalone app screen. |
| Server/runtime | `server.ts`, `runtime/myraaRuntime.ts`, `server_memory.ts`, `server_paths.ts`, `runtime/centralBrain.ts` | Express/runtime composition, APIs, persistent settings, sidecar integration and shell event bridge. |
| Cognition | `cognition/runtime.ts`, `eventBus.ts`, `situationModel.ts`, `attentionEngine.ts`, `initiativeEngine.ts`, `safety.ts`, `autonomousMind.ts`, `socialInitiativeEngine.ts`, `goalManager.ts`, `planner.ts`, `critic.ts`, `skillManager.ts`, `structuredMemory.ts`, `speechOrchestrator.ts` | `server.ts` feeds cognition; `CognitiveRuntime` updates context/memory/initiative and its production decision listener gates/sends speech. |
| Task agent | `agent/loop.ts`, `reactEngine.ts`, `taskSession.ts`, `scheduler.ts`, planner/perception/actions/recovery/references/cancellation/audit/persona/localization/web/shell/download modules | Live calls tools through bounded ReAct; multi-step PC work is delegated to the task manager/agent loop and emits status for HUD. |
| Tool registry and integrations | `cognition/toolRegistry.ts`, `toolExecutor.ts`, `runtime/centralBrain.ts`, `api_hub/`, `desktop_agent/registry.py`, `voice/liveAgentTools.ts` | Native/API/phone/sidecar/dynamic tool descriptors have execution and health paths; the Central Brain provides shared execution and diagnostic surface. |
| Model, keys and voice | `models/`, `secrets/secretStore.ts`, `voice/liveAgentTools.ts`, `voice/transcriptGuard.ts`, `src/lib/audio.ts`, `src/lib/tts.ts`, `src/lib/wakeWord.ts` | Router/provider APIs and Live session bridge serve chat/voice; UI handles capture/playback and visible transcript state. |
| Python desktop agent | `desktop_agent/main.py`, `registry.py`, `tools_*.py`, `browser_agent.py`, `ui_automation.py`, `perception.py`, `vision_inspector.py`, `proactive_companion.py`, `tool_builder.py`, `tool_generator.py` | Node starts/probes sidecar, authenticates internal calls, refreshes tools, forwards execution and observes results. |
| Permission/safety | `permissions/`, `shared/netSafety.ts`, `agent/actions/risk.ts`, `desktop_agent/tools_confirmation.py`, `gateway.py` | Permission engine/controller and confirmation broker guard backend action/tool paths; URL safety and sidecar checks constrain selected operations. |
| Settings and support services | `settings/appSettings.ts`, `presence/`, `memory/`, `companion/`, `services/`, `native/`, `shared/` | Settings feed UI/runtime; presence/cognition gates proactive output; service and shared helpers are called by active APIs. |
| Android/mobile | `mobile/phoneBridge.ts`, `mobile/lanDiscovery.ts`, `android/app/src/main/java/ai/jayra/companion/` | Phone bridge and LAN responder are connected in `server.ts`; separate Compose app uses bridge client/discovery and phone accessibility/device APIs. Android is not built by root npm scripts. |
| Sidecar mobile web client | `desktop_agent/mobile.html`, its web manifest/icon/service worker, `desktop_agent/main.py` | FastAPI serves the page at `GET /mobile` with `/manifest.webmanifest`, `/mobile-icon.svg` and `/mobile-sw.js`; it is a separate mobile-web client from the Android app. |
| Plugin/update system | `runtime/pluginManager.ts`, `runtime/centralBrain.ts`, `desktop_agent/tool_generator.py`, plugin routes | Signed package validation, local watch/load/unload and optional remote sync are connected; tool calls retain normal execution checks. |

### Orphaned / Unlinked / Dead Code

| Path/surface | Finding | Classification note |
|---|---|---|
| `src/components/HoloStage.tsx` | Imported by `src/App.tsx` but not rendered in the inspected App path; active orb mode renders `JarvisOrb` directly. | The component may be reusable; its App import is currently unused. |
| `shared/appEvents.ts`: `react.stage` | Event type is declared, but no matching production publisher was found in the inspected backend; the HUD consumes `reactStatus` over `/live` instead. | A dead event contract, not evidence that ReAct status itself is dead. |
| `cognition/eventBus.ts` subscription API | Event bus supports subscribers and history; no production subscriber was located in the audited runtime. Cognition decisions use `CognitiveRuntime.onDecision`. | Apparently unused subscription surface, not proof of no external consumer. |
| `cognition/architectureMap.ts` | Re-exported by `cognition/index.ts`; no server/runtime consumer was located. | Informational/unconnected in the reviewed paths. |
| `agent/diagnostics/errorInspector.ts` | No importer/call site located; active renderer diagnostics use shared/renderer diagnostic paths. | Standalone utility, not the active diagnosis console. |
| Root `animations/` and `custom_assets/` | Empty placeholders in the repository; runtime asset catalogs live in user data. | Storage placeholders, not actual active asset libraries. |

### Development / Packaging Tooling

| Path/group | Role |
|---|---|
| `package.json` scripts | Dev/build/start/preview, lint, focused tests, aggregate tests, cognition simulation, Electron, installer and character import commands. |
| `tests/`, `cognition/tests/`, `api_hub/tests/`, `desktop_agent/test_*.py`, `src/**/__tests__`/`*.test.ts(x)` | Regression and unit tests; not imported into shipped runtime. |
| `scripts/`, `tools/`, `character_import/_tmp_analyze.ts` | Build launcher/icon, cognition simulation, PMX inspection/import/staging/conversion scripts, including a temporary character analyzer. |
| `desktop_agent.spec`, `electron-builder.yml`, `electron-builder.public.yml`, `electron/afterPack.cjs`, `vite.config.ts`, `tsconfig.json`, Android Gradle files | Build, packaging, bundling and compiler configuration. |
| `character-preview.html`, `src/character/preview/main.tsx`, `character-studio.html`, `src/character/studio/main.tsx`, `ui-preview.html`, `src/dev/uiPreview.tsx` | Standalone character/lip-sync, Studio and HUD/task/approval preview/test entry points; these are not the main application windows. |
| `build/`, `agent_dist/`, `agent_build/`, `dist/`, `release/` | Generated icons, bundles, PyInstaller and installer outputs. Treat generated contents as build artifacts, not source of truth. |
| `README.md`, `features.md`, `hud.md`, `NEW_JAYRA_ANDROID_MASTER_SPEC.md`, `docs/` | Human-authored project/design/integration documentation. `jira.md` is the consolidated audit; keep other docs synchronized when contracts change. |

## 4. Technical health: working paths and risks

### What is structurally working well

- **Clear process separation:** Electron owns desktop privileges; the renderer has a constrained preload; Node owns AI/runtime APIs; Python packages OS automation behind a tool service.
- **Reusable tool boundary:** `CentralBrain` and `ToolExecutor` centralize registration, permission checks, confirmation, cancellation, health reporting and restricted fallback behavior.
- **Explicit task orchestration:** Live quick tools and autonomous multi-step tasks are separate, bounded paths. Task sessions expose status/control and can stop, pause or hand over control.
- **Cognition is connected to real inputs:** voice, desktop metadata, tasks, tools and goals are routed through the cognition runtime; proactive speech also passes presence/safety/DND cadence gates.
- **Model handling is capability-aware:** model definitions include capabilities/locality, and the router considers configuration, connectivity, quota and health rather than blindly cycling provider names.
- **Plugin trust controls exist:** manifest/schema/path/capability/size/signature validation and sidecar source validation precede dynamic activation; plugin tools use ordinary tool policy afterward.
- **Useful safety primitives are present:** scoped permission rules and locked-to-ASK actions, confirmation expiry/cancellation, outbound HTTP URL checks, redacted structured logs and atomic JSON writes.
- **Multiple UI surfaces have real transport:** core widgets use REST/WebSocket/event contracts, not only mock state. This is a source-wiring assessment, not a performance benchmark.

### Broken, inconsistent or fragile integration

1. **Two settings surfaces and caches.** `/api/app-settings` returns the normalized version-3 runtime settings object from `AppSettingsStore`; `/api/settings` is a renderer compatibility surface with its own localStorage cache and `settings.json` projection. UI controls use both. Permission-sensitive renderer changes (notably network/startup settings) receive special handling, while runtime app-settings patches are a different route/policy path. This split invites stale values, divergent validation and future accidental policy bypass; it is not evidence that every current app-settings change bypasses permission checks.
2. **Confirmation routing uses an ID prefix.** The HUD distinguishes cognition confirmations by the `cognition:` prefix and sends them to `/api/cognition/confirm` rather than `/api/confirmations/:id`. This embeds transport/type information in an opaque identifier and couples the renderer to implementation details. Use a typed confirmation DTO with an explicit resolver/kind instead.
3. **Declared and emitted event contracts diverge.** `react.stage` exists in the shared event union but no publisher was found; live task/ReAct presentation currently consumes `/live` `reactStatus`. `CognitiveEventBus` also exposes subscriptions without a production subscriber found in scope. Remove dead contracts or wire a single documented publisher/subscriber path.
4. **Conversation history is client-local.** `FloatingChatDock` persists `jayra.chat-sessions.v1` in localStorage. There is no history API or cross-device synchronization in this path; browser storage loss/profile separation means history is not available on another device or install.
5. **Persistence is fragmented.** Legacy `memories.json`, structured cognition memory, app settings, compatibility `settings.json`, model/permission JSON, localStorage history and phone bridge state have distinct owners and possibly distinct data roots. There is no single migration/backup/sync boundary.
6. **Internal naming/data roots are inconsistent.** User-facing product is JAYRA, while runtime classes, environment keys and files still include MYRAA; `DATA_DIR` and `COGNITION_DATA_DIR` can resolve separately. This complicates support, upgrades, portable builds and multi-instance data ownership.
7. **Build/test coverage is uneven.** `npm test` includes lint and a large test chain, but separate scripts exist for screen vision, real browser, API Hub, predictive shadow, spatial proximity, vibe shifting, knowledge graph, mic gating and notifications that are not in the aggregate `test` script. CI should invoke these intentionally or document why excluded.
8. **Service listeners need lifecycle discipline.** Node and Python sidecars, WebSocket clients, event subscriptions, telemetry timers, plugin filesystem watchers and dynamically loaded tools all require explicit shutdown/unsubscribe/reload behavior. Add repeated start/stop and reload tests; a source audit alone cannot prove leak-free lifecycle.
9. **Some exposed UI/settings are feature-dependent.** Live voice needs a configured key/provider and microphone permissions; screen/desktop actions need the sidecar and relevant capabilities; Android needs pairing/network permissions; a model adapter can exist while not configured. UI should make these unavailable/degraded states explicit rather than imply universal readiness.
10. **An active renderer fallback has an unimplemented response.** `src/App.tsx` can return `Tool ${name} is not implemented.` for a tool callback; the callback is in the mounted app, but the reviewed source did not establish which user path reaches it. Trace callers before relying on or deleting it.

### Performance and security bottlenecks to track

- **Network binding and gateway exposure:** the Node server binds `0.0.0.0`. Python sidecar defaults to `127.0.0.1:8765`; network access is off by default, but when enabled its host defaults to `0.0.0.0` unless `JAYRA_AGENT_HOST` overrides it. Non-loopback gateway requests are denied while network access is off and, when on, require `X-JAYRA-Token` or Bearer auth; allowed remote paths are limited to gateway/mobile/static routes. Loopback calls bypass that gateway token middleware. A separate internal-token middleware protects Node-controlled/custom-tool paths but allows them if `JAYRA_INTERNAL_TOKEN` is unset; the normal Node launcher generates and passes a token. The gateway token is at least 32 characters, generated/persisted when absent, compared in constant time, and exposed by connect-info only to loopback. These are source facts; exposure risk depends on the local-process/network threat model. Prefer loopback-only by default and fail closed if internal auth is not configured.
- **Phone LAN discovery is not encrypted transport:** `mobile/lanDiscovery.ts` explicitly advertises `secure: false`. Pairing/token auth is useful but does not encrypt traffic. Require authenticated TLS or an equivalent protected channel before relying on bridge confidentiality over untrusted Wi-Fi; scope/revoke credentials per device.
- **Screen payload volume and retention:** `ScreenVisionPipeline` caches its latest Node-side frame in memory for about 90 seconds and clears it on expiry/dispose (`server_screenVision.ts`). Python `viewScreen` emits JPEG base64, clamps dimensions to 320–1920 and uses quality 72; disk retention is opt-in. Optional temp copies are capped at 1280px and stale copies (>5 minutes) are removed only during a later cleanup-enabled capture, not by a demonstrated background janitor. `takeScreenshot` defaults to 1280px and includes base64 only when requested, but the inspected path does not clamp its `max_dim`; `saveScreenshot` writes PNGs to `~/Pictures/MyraaScreenshots` with no cleanup shown. `captureForVision` clamps to 320–2048px and JPEG quality 35–90. The 20 MiB limit applies to gateway uploads, not screenshot/frame payloads; no explicit byte cap was located for screenshot base64 or streamed JPEG. Bound payload bytes/concurrency, stream or pass short-lived handles rather than repeat base64 copies, and define cleanup for saved files. Do not treat metadata-only perception as screen capture consent.
- **3D rendering cost:** PMX/MMD materials, physics/cloth, outlines, lighting, particles, reflections and multiple overlay layers can tax integrated GPUs. Existing quality modes and chunk splitting help, but budgets should be measured on low-end GPUs and idle/minimized windows; pause or reduce expensive render/physics work when hidden.
- **Event and data growth:** `appEvents` retains latest state per event type, and logs use a bounded in-memory ring, but other history, plugin status, screen artifacts and phone file transfers have distinct lifetime policies. Test limits under reconnect/failure and avoid unbounded decoded frames or transfer chunks.
- **Local-only history and JSON scale:** localStorage conversation history has no shared retention/index policy; JSON stores are appropriate for small per-user state but can become expensive for high-volume event/memory histories. Add size limits, retention/compaction and a migration path before using these stores as long-term telemetry.
- **Autonomy reliability:** the system has separate Live and task loops, recovery and tool fallback. Their shared contracts, retry/idempotency and cancellation should be regression-tested for non-idempotent actions to avoid duplicate sends or actions after timeout.
- **No benchmark claim:** repository source describes quality/rate-limit controls, not measured throughput or memory ceilings. Capture profiling data for startup, Live latency, frame handling, model retries, and 3D frame time before calling a subsystem “high-performing.”

## 5. Recommendations and roadmap

### 5.1 Preserve contracts during a 3D sci-fi HUD migration

Treat the future HUD as a presentation replacement, not a backend rewrite:

1. Keep the existing renderer/backend adapter (`src/lib/appApi.ts`) and event adapter (`src/lib/useAppEvents.ts`) as the stable boundary. Replace visual components behind the existing `App` state/navigation contracts.
2. Preserve REST methods, paths, request/response shapes, status/error behavior, WebSocket message types, `/events` envelope, SSE semantics, and Electron IPC topic/payloads. In particular retain `/live`, `/events`, `/api/gateway/events`, settings/task/confirmation routes and overlay IPC.
3. Keep the app's semantic state independent of WebGL scene objects. Project current app state into a HUD view model (presence, task stage, confirmation, telemetry, selected model, voice state), then render that view model as holographic panels/3D labels.
4. Put the 3D UI in a separate canvas/layer from the avatar stage so an expensive scene cannot block settings, chat, approval controls or accessibility affordances. Keep normal DOM controls available for keyboard, screen readers and reduced motion.
5. Add contract tests against the current API/event/IPC shape before changing presentation; add screenshot/performance tests for low-end GPUs and verify event reconnect/state resynchronization.
6. Migrate one screen at a time (shell/telemetry, then task/confirmation, then chat/settings); do not change backend contracts to fit visual convenience. If a contract must evolve, version and migrate it explicitly.

### 5.2 Refactoring and cleanup sequence

**First (correctness/maintainability):**

- Define one typed settings DTO/store contract; make `/api/settings` a deliberate compatibility adapter to canonical `/api/app-settings`, then deprecate the duplicate only after old renderer/sidecar consumers are migrated.
- Replace `cognition:` prefix checks with typed confirmation source/kind metadata.
- Decide whether `react.stage` should be emitted over `appEvents` or removed; document that `/live reactStatus` is currently the active ReAct UI path.
- Wire or remove the unused `HoloStage` import/wrapper, `CognitiveEventBus` subscriber surface and `cognition/architectureMap.ts` server expectation. Keep preview harnesses clearly labeled as tooling.
- Add aggregate test coverage for API Hub, browser/screen vision, mobile, knowledge graph, spatial/vibe and notification/mic-gating suites; add CI jobs for Python sidecar and Android build when those targets are supported.

**Then (durability/operations):**

- Consolidate migration/backup/retention policy for settings, memories, chat history and cognition stores. Decide explicitly whether chat should be encrypted/synced or remain intentionally local-only.
- Add shutdown/reload tests for WebSockets, timers, event subscriptions, sidecar process, filesystem watchers, generated tools and plugin unload/reload.
- Enforce bounded screenshot/frame retention, transfer chunk size/concurrency and memory limits; measure heap and GPU behavior under a long-running session.
- Publish one generated route/tool/event manifest from the server/client definitions so the master inventory does not become stale.
- Separate source, user data and build products; verify installer manifests do not package local secrets, memories, logs or development outputs.

### 5.3 Naming and data-directory standardization

Adopt **JAYRA** for user-visible names, app/package IDs, docs, environment variables, storage keys and new modules. Preserve existing `MYRAA_*` names as documented compatibility aliases during migration, with precedence rules and one-time data migration. Establish one data-root resolver that provides named subdirectories (`settings`, `memory`, `cognition`, `models`, `permissions`, `plugins`, `logs`, `transfers`) and use it in Node, Electron and Python. Do not silently relocate existing user data; migrate atomically and retain a backup/rollback path.

### 5.4 Mobile and multi-device roadmap

The repository already has a phone bridge, LAN discovery, token/manual pairing, an Android app, accessibility actions, file transfer, audio routing and session handover. This is a foundation, not a complete cloud sync system. Recommended increments:

1. **Secure local pairing:** per-device identity and revocable scoped tokens; authenticated encrypted transport; explicit consent for accessibility, clipboard, audio and file operations; pairing expiration and rotation.
2. **Versioned protocol:** version capability negotiation and typed schemas for commands/events; define maximum message/frame/transfer sizes and resumable transfer semantics.
3. **Reliable session model:** reconnect/backoff, idempotency IDs, acknowledged task/confirmation state, offline queue policy and conflict handling for settings/memory.
4. **Minimal sync service (optional):** decide which data is eligible for end-to-end-encrypted sync, define key ownership, retention and deletion/export before adding a cloud service. Keep local-only mode fully supported.
5. **Cross-device UX/tests:** pairing recovery, device management/revocation, network-change behavior, Android lifecycle/accessibility permission states, transfer resume, and contract tests between Android and Node.

## 6. Quick reference: active interfaces and tool contracts

### Renderer-facing and external-client interfaces

| Interface | Owner | Key behavior |
|---|---|---|
| `GET/POST /api/app-settings` | `runtime/myraaRuntime.ts` | Canonical runtime settings get/patch. |
| `GET/POST /api/settings` | `server.ts` | Renderer settings/TTS compatibility adapter; distinct from app-settings. |
| `WS /live` | `server.ts` | Live chat/audio, tool function calls, transcripts, audio output, turn completion and ReAct status. |
| `WS /events` | `runtime/myraaRuntime.ts` via `server.ts` | Application event envelope and initial state snapshot. |
| `GET /api/gateway/events` | `server.ts` | SSE mirror of app events and pending-confirmation seed. |
| `WS /mobile-bridge` | `server.ts`, `mobile/phoneBridge.ts` | Authenticated Android/phone bridge channel. |
| `POST /execute` (sidecar) | `desktop_agent/main.py` | Internal tool dispatch from Node to registered Python tool. |
| Electron IPC (`window.myraa`) | `electron/preload.cjs`, `electron/main.cjs` | Allowlisted shell navigation, window/overlay, capture, and companion operations. |

### Declared REST route census

The following are distinct declared route templates in `server.ts` and `runtime/myraaRuntime.ts` (parameterized paths are shown with `:param`). This is a source inventory, not a promise that every route is exposed in every configuration. Service-internal FastAPI routes and dynamic per-tool routes are listed separately below.

| Method | Routes |
|---|---|
| **GET — server.ts** | `/health`; `/api/brain/plugins`; `/api/mobile/diagnostic`; `/api/mobile/connect-info`; `/api/mobile/bridge-status`; `/api/mobile/download/:filename`; `/api/mobile/files`; `/api/mobile/audio-routing`; `/api/mobile/clipboard`; `/api/mobile/session-handover`; `/api/shadow-execution/status`; `/api/shadow-execution/patterns`; `/api/spatial-proximity/status`; `/api/vibe-shifting/status`; `/api/knowledge-graph/summary`; `/api/kg/summary`; `/api/knowledge-graph/graph`; `/api/kg/graph`; `/api/settings/mic-gating-state`; `/api/notifications/active`; `/api/cognition/status`; `/api/api-hub/status`; `/api/api-hub/search`; `/api/api-hub/providers`; `/api/api-hub/adapters`; `/api/proactive/state`; `/api/goals`; `/api/skills`; `/api/memories`; `/api/settings`; `/api/network/status`; `/api/config`; `/api/keys/all`; `/api/keys/:provider/status`; `/api/agent-health`; `/api/desktop-agent/status`; `/api/weather-news`; `/api/cities/search`; `/api/logs/:file`; `/api/proxy`; `/api/web-proxy`; `/api/youtube-search`; `/api/assets/custom`; `/api/gateway/events` (SSE). |
| **POST — server.ts** | `/api/brain/plugins/install`; `/api/brain/plugins/sync`; `/api/brain/tools/refresh`; `/api/brain/tools/generate`; `/api/gateway/command`; `/api/mobile/pair`; `/api/mobile/remote-command`; `/api/mobile/upload`; `/api/mobile/audio-routing`; `/api/mobile/clipboard`; `/api/mobile/session-handover`; `/api/mobile/authorize-action`; `/api/mobile/authorize-response`; `/api/shadow-execution/trigger`; `/api/shadow-execution/toggle`; `/api/shadow-execution/clear-cache`; `/api/spatial-proximity/toggle`; `/api/spatial-proximity/configure`; `/api/spatial-proximity/telemetry`; `/api/vibe-shifting/toggle`; `/api/vibe-shifting/configure`; `/api/vibe-shifting/telemetry`; `/api/vibe-shifting/trigger`; `/api/knowledge-graph/generate`; `/api/kg/generate`; `/api/knowledge-graph/activity`; `/api/settings/mic-gating-mode`; `/api/settings/mic-gating-hotkey`; `/api/settings/mic-gating-vad`; `/api/settings/mic-gating-widget`; `/api/notifications/ingest`; `/api/notifications/dismiss`; `/api/whatsapp/generate-draft`; `/api/whatsapp/update-draft`; `/api/whatsapp/confirm-draft`; `/api/api-hub/sync`; `/api/api-hub/providers/:providerId/health`; `/api/api-hub/adapters/:adapterId/call`; `/api/cognition/pause`; `/api/cognition/resume`; `/api/cognition/confirm`; `/api/proactive/focus-mode`; `/api/proactive/settings`; `/api/cognition/simulate`; `/api/goals`; `/api/goals/:goalId/cancel`; `/api/goals/:goalId/plan`; `/api/skills`; `/api/skills/:skillId/outcome`; `/api/memories`; `/api/settings`; `/api/network/access`; `/api/tts/synthesize`; `/api/config/apikey`; `/api/keys/:provider`; `/api/keys/:provider/test`; `/api/keys/discover`; `/api/keys/register-discovered`; `/api/desktop-agent/start`; `/api/screen-vision`; `/api/assets/custom/import`; `/api/assets/import`; `/api/assets/universal/inspect`; `/api/assets/universal/save`. |
| **Other server.ts methods** | `DELETE /api/keys/:provider/:key`. |
| **GET — runtime/myraaRuntime.ts** | `/api/brain/status`; `/api/brain/tools`; `/api/models`; `/api/tasks`; `/api/tasks/recoverable`; `/api/tasks/:id`; `/api/confirmations`; `/api/permissions`; `/api/contacts`; `/api/companion/icons`; `/api/app-settings`; `/api/automations`; `/api/presence`; `/api/utilities`; `/api/audit`; `/api/downloads`; `/api/characters`; `/api/characters/:id`; `/api/poses`; `/api/workspace/briefing`; `/api/consciousness/alert`; `/api/workspace/files`; `/api/workspace/file`; `/api/debug/state`. |
| **POST — runtime/myraaRuntime.ts** | `/api/models/select`; `/api/models/switch-provider`; `/api/models/test`; `/api/models/refresh`; `/api/models/custom`; `/api/providers/:id/key`; `/api/tasks`; `/api/tasks/:id/:action`; `/api/autonomy/stop`; `/api/confirmations/:id`; `/api/permissions/authorize`; `/api/permissions/messaging`; `/api/permissions/trusted`; `/api/permissions/:capability`; `/api/contacts`; `/api/companion/command`; `/api/companion/icons/move`; `/api/app-settings`; `/api/automations`; `/api/automations/:id/run`; `/api/personas`; `/api/personas/suggest-title`; `/api/games/tic-tac-toe/move`; `/api/dnd`; `/api/utilities`; `/api/utilities/:id/dismiss`; `/api/utilities/:id/snooze`; `/api/characters/import`; `/api/characters/:id/tests`; `/api/poses`; `/api/workspace/briefing/trigger`; `/api/consciousness/probe`; `/api/workspace/files`; `/api/workspace/file`; `/api/workspace/files/create`; `/api/workspace/folders/create`; `/api/workspace/rename`; `/api/workspace/files/delete`; `/api/workspace/templates/scaffold`; `/api/workspace/execute`. |
| **PUT — runtime/myraaRuntime.ts** | `/api/automations/:id`; `/api/personas/:id`. |
| **PATCH — runtime/myraaRuntime.ts** | `/api/goals/:goalId/tasks/:taskId`; `/api/characters/:id`. |
| **DELETE — runtime/myraaRuntime.ts** | `/api/memories/:id`; `/api/contacts/:id`; `/api/automations/:id`; `/api/personas/:id`; `/api/utilities/:id`; `/api/characters/:id`; `/api/poses/:id`. |

The `server.ts` inventory is implemented around its route blocks for mobile/plugin, shadow/spatial/vibe, knowledge graph, microphone gating, notifications, gateway, cognition/API Hub, settings/keys, weather/vision and assets (roughly lines 1376–4310 and 6690–6804). Runtime routes are registered in `runtime/myraaRuntime.ts` (roughly lines 1017–1583). Express also has a `GET *` renderer fallback; it is not an API endpoint. `myraaRuntime.ts` registers a generated `/api/${sanitizedName.toLowerCase()}` path for configured integrations, so those concrete paths depend on runtime tool data and are not enumerable from the route template alone.

### FastAPI sidecar route census

These are route declarations in `desktop_agent/main.py` (paths are relative to the sidecar origin, generally port 8765):

| Method | Routes |
|---|---|
| **GET** | `/mobile`; `/manifest.webmanifest`; `/mobile-icon.svg`; `/mobile-sw.js`; `/health`; `/tools`; `/tools/custom`; `/consciousness/state`; `/proactive/state`; `/proactive/events`; `/gateway/status`; `/gateway/download`; `/gateway/stream`; `/gateway/connect-info`; `/observe`; `/telemetry`; `/proactive/reaction-memory`. |
| **POST** | `/tools/reload`; `/tools/sandbox`; `/tools/build`; `/consciousness/probe`; `/proactive/dnd`; `/proactive/settings`; `/proactive/activity`; `/proactive/memory`; `/gateway/command`; `/gateway/approval`; `/gateway/upload`; `/vision/inspect`; `/automation/mouse`; `/automation/keyboard`; `/automation/window`; `/browser/action`; `/proactive/chat-activity`; `/proactive/focus-mode`; `/execute`. |
| **DELETE** | `/tools/custom/{tool_name}`. |

`GET /proactive/state` is declared twice in `main.py` (at two locations); it is listed once here. The FastAPI route inventory is source-level and does not include dynamically registered tool names as HTTP paths; those execute through `/execute`.

### Integration limits reviewers should verify before changing

- `GET /api/tasks?limit=10` is used for initial Task HUD synchronization; task status changes arrive over `/events`.
- Confirmations are initially synchronized via `GET /api/confirmations`; ordinary IDs resolve through `/api/confirmations/:id`; cognition IDs are routed through `/api/cognition/confirm`.
- Memory dashboard calls `/api/memories`; daily summary calls `/api/kg/summary` and `/api/kg/generate`; chat history is localStorage-only.
- Code Studio uses `/api/workspace/*` and `/api/brain/tools*`/`/api/brain/plugins*`; workspace path/command constraints are backend-owned.
- Weather/news uses `/api/weather-news` and `/api/cities/search`; system telemetry arrives as `system.telemetry` over `/events`.
- Mobile discovery advertises `secure: false`; bridge auth is not equivalent to transport encryption.
- Sidecar tool execution continues through Central Brain permission/confirmation checks; a dynamic tool registration is not permission to execute it.

## 7. Source map for a reviewer starting cold

| Read first | What it explains |
|---|---|
| `README.md` | User-facing product, requirements, development/build procedure, plugin package outline and safety claims. |
| `package.json` | Main entry, scripts, dependencies and declared test targets. |
| `electron/main.cjs`, `electron/preload.cjs` | Shell lifecycle and renderer IPC boundary. |
| `server.ts`, `runtime/myraaRuntime.ts` | Backend composition, live channels, route registration and runtime state. |
| `runtime/centralBrain.ts`, `cognition/toolRegistry.ts`, `cognition/toolExecutor.ts` | Tool registry, execution and diagnostics. |
| `agent/loop.ts`, `agent/reactEngine.ts`, `agent/taskSession.ts` | The two action orchestration paths and task lifecycle. |
| `cognition/runtime.ts`, `cognition/structuredMemory.ts`, `permissions/engine.ts` | Cognition, durable memory and authorization policy. |
| `desktop_agent/main.py`, `desktop_agent/registry.py`, `desktop_agent.spec` | Python API, dynamic tool registry and frozen sidecar packaging. |
| `src/main.tsx`, `src/App.tsx`, `src/lib/appApi.ts`, `src/lib/useAppEvents.ts` | Renderer mount, view composition, API client and event subscriptions. |
| `settings/appSettings.ts`, `server_paths.ts`, `shared/jsonFile.ts` | Settings schema, data roots and persistence helpers. |
| `mobile/phoneBridge.ts`, `mobile/lanDiscovery.ts`, `android/` | Phone protocol, discovery and Android client. |
| `features.md`, `hud.md` | Existing feature/HUD interface inventories; useful supporting references but not a substitute for checking current handlers. |

---

This document records source wiring and architectural risks as reviewed; it is not a security certification, runtime SLA, external API compatibility guarantee, or substitute for exercising each feature on a packaged Windows installation and paired Android device.
