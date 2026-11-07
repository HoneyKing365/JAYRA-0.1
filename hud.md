# JAYRA 2D HUD: UI, Events, and API Inventory

This inventory documents the current renderer/HUD behavior and the backend
interfaces it uses. Paths are relative to the project root. UI navigation and
local presentation state are distinguished from calls that cross into the
backend.

## 1. Main Screen & Visualizer Elements

### Central stage modes

`src/App.tsx` selects one of three central-stage renderers from the persisted
`hud.visualMode` setting:

| Mode | Component | Inputs and behavior |
|---|---|---|
| 3D Companion | `src/components/Companion3DStage.tsx` | Receives the active audio session, live state, theme, emotion, character state/ID, reflection strength, and cursor-gaze option. |
| Hologram Face | `src/components/HologramFace.tsx` | Receives settings, character state, audio session, and theme. |
| Jarvis Orb | `src/components/JarvisOrb.tsx` | Receives settings/state/audio/theme plus quality, particle density, bloom, spin speed, and floor reflection. |

Settings → HUD → Active Display Mode patches `hud.visualMode` through
`POST /api/app-settings`. When no explicit mode is stored, the app defaults to
the orb for active `hologram_core`/`custom` models and otherwise to the
character stage. The Sidebar's “3D Avatar Stage” destination focuses/raises
the stage; it does not itself select a visualizer mode. See
`src/App.tsx:788-815,1266-1318` and
`src/components/SettingsPanel.tsx:1518-1550`.

The stages are driven by App/audio-session state rather than a dedicated stage
REST endpoint. The active conversation uses `/live` for audio, transcript,
turn-completion, and ReAct status updates (see
[Live conversation WebSocket](#live-conversation-websocket)).

### Mark LV HUD overlay

`src/components/MarkLvHud.tsx` is an overlay on the main screen, not a fourth
central-stage mode. `src/App.tsx` renders it with the current settings,
uppercase character state, and audio session. It samples input/output audio
analyser data for five audio bars. HUD settings control theme, ring opacity,
scanlines, particle field, sound effects, subtitles, and diagnostic gauges.
Hardware/system telemetry is displayed by `SystemTelemetryWidget`, not by
these analyser bars.

Relevant settings patches include `hud.theme`, `hud.ringOpacity`,
`hud.soundEffects`, `hud.diagnosticGauges`, `hud.showSubtitles`,
`hud.scanlines`, `hud.particleField`, and `hud.visualMode`. See
`src/components/MarkLvHud.tsx:24-86,100-145` and
`src/components/SettingsPanel.tsx:1550,1605-1617,1690-1727`.

### Live conversation WebSocket

The renderer connects to the server's `/live` WebSocket for live chat/voice and
conversation visual feedback. It is not a dedicated visualizer API.

| Trigger/direction | Message/event |
|---|---|
| Sending dock text | Client sends `{ "type": "text", "text": string }`. Saved-chat context is included in the text prompt. |
| Voice input / controls | The live client sends audio and control messages; the server's mirrored-client handler accepts text, `remote_action`/`args`, audio, and control messages. |
| Audio to renderer | `{ "type": "audio", "audio": ... }` |
| Transcript to renderer | `{ "type": "transcription", "role": string, "text": string }` |
| Turn completion | `{ "type": "turnComplete" }` |
| ReAct/task visualization | `reactStatus` object with `stage`, `iteration`, `maxIterations`, and action/status details. |
| Memory refresh | `{ "type": "memory_sync", "memories": ... }` |

Backend: `server.ts` creates the `/live` WebSocket at `server.ts:4405-4409`,
handles client messages at `server.ts:4504-4578`, and emits the above live
updates in its live pipeline (`server.ts:4640-4651,5664-5675,5716-5723,5806`).
The shared `react.stage` event exists, but the inspected backend did not show a
publisher for it; the live `reactStatus` message is what the HUD currently
consumes.

## 2. Side Panels & Navigation Options

### Sidebar destinations

`src/components/Sidebar.tsx` currently offers:

| Destination | Frontend behavior and associated calls |
|---|---|
| Live Assistant | Opens/focuses the live chat dock; text and voice use `/live`. |
| Chat History | Opens the chat dock's history mode. Sessions are persisted locally in `localStorage` key `jayra.chat-sessions.v1`; no history-specific API/IPC call. Sending a message still uses `/live`. |
| Tasks HUD | Opens/focuses the task panel; task list is initially synchronized from `GET /api/tasks?limit=10`, then receives `/events` updates. |
| 3D Avatar Stage | Raises/focuses the stage; mode selection remains in HUD settings. |
| Code Studio | Opens `CodeStudio`; workspace, tool, plugin and task calls are listed below. |
| Memory & Recalls | Opens `MemoryDashboard`; uses `/api/memories` and may receive `memory_sync` on `/live`. |
| Daily Pulse & Flashcards | Opens `DailySummaryCard`; uses `/api/kg/summary` and `/api/kg/generate`. |
| Mobile Connect | Opens the pairing dialog; calls `GET /api/mobile/connect-info`. |
| PC Permissions | Opens Settings at its Agent/permissions section; uses `/api/permissions` routes. |
| Settings | Opens Settings; controls are local UI until saved through `/api/settings` or `/api/app-settings`, depending on the setting family. |

Sidebar view changes themselves are renderer navigation state, not backend
requests. Main navigation is handled in `src/App.tsx:788-815` and
`src/components/Sidebar.tsx:12-16,36-46,92`.

### Settings panel controls

Settings uses two persistence surfaces:

* **Runtime/app settings:** `handleAppSettingsChange` optimistically merges a
  nested patch and sends `POST /api/app-settings`. The response is the updated
  runtime settings object; `GET /api/app-settings` returns the current object.
* **Renderer settings:** `handleSettingsChange`/`saveSettings` persists
  renderer preferences to localStorage (`myraa.settings.v2`) and sends
  `POST /api/settings`. `GET /api/settings` returns renderer settings plus
  `ttsProvider`. Direct `networkAccessEnabled` changes are rejected; startup
  permission changes are authorized by the backend.

Relevant control groups and patch keys:

| Settings group | Example controls/patches |
|---|---|
| Task panel | `autonomy.showTaskHud` |
| Telemetry widget | `systemMonitor.enabled`, `systemMonitor.updateIntervalSeconds`, `systemMonitor.corner` |
| Visualizer | `hud.visualMode`; `orbVisualizer.quality`, `particleDensity`, `style`, `spinSpeed`, `bloomEffect`, `floorReflection` |
| Mark LV/HUD | `hud.theme`, `ringOpacity`, `soundEffects`, `diagnosticGauges`, `showSubtitles`, `scanlines`, `particleField` |
| Weather/news | `weatherNews.city`, `country`, `countryCode`, `latitude`, `longitude`, `temperatureUnit`, `newsCategory` |
| Code editor | `codeEditor.enabled`, `theme`, `fontSize`, `aiAssistance`, `autoComplete`, `defaultWorkspace` |
| Voice | Runtime patches include `voice.ttsProvider`, `voice.voiceName`, `voice.style`, `voice.pitch`, `voice.speakTaskUpdates`, `voice.showSubtitles`. Renderer preferences include wake-word/mic selection and `ttsVoice`, `speechRate`, `speechPitch`, `speechVolume`. |

Microphone device enumeration uses the browser's
`navigator.mediaDevices.enumerateDevices()` API; voice previews use browser
speech/TTS helpers. These do not call a dedicated HUD endpoint. The widget
reads `weatherNews.autoRefreshMinutes`; no matching control was found in the
scanned Settings UI.

Backend routes: `server.ts:3261-3305` handles `/api/settings`;
`runtime/myraaRuntime.ts:1197-1198` handles `/api/app-settings`.

### Chat dock

`FloatingChatDock` appears in windowed mode or after Live/Chat navigation.
Text submission invokes the App send handler and sends `{type:"text",text}`
over `/live`. Chat history is local-only in
`localStorage["jayra.chat-sessions.v1"]`; saved turns/context are composed into
the outgoing prompt. Browser SpeechRecognition can provide text preview.
The dock passes attachment text along with the prompt; it does not make a
separate attachment endpoint call.

See `src/components/FloatingChatDock.tsx:41-42,146-170,225-247`,
`src/App.tsx:1094-1149,1581-1592`, and `src/lib/audio.ts:501-528,660`.

### Task HUD and task controls

`TaskHud` is opened from Sidebar or controlled by `autonomy.showTaskHud`.
`FloatingTaskHud` is also rendered independently and hides when no task is
active.

* On event connection the frontend resynchronizes using `GET /api/tasks?limit=10`.
* `/events` messages with `task.updated` and `task.finished` update task state;
  `task.step` is a shared event type and may carry step updates.
* Task actions call `POST /api/tasks/:id/:action` with `{}` for pause, resume,
  stop, takeover, and return; answer uses `{text}`. Create uses
  `POST /api/tasks` with `{goal, origin?}` (the frontend task helper uses
  `{goal, origin:"text"}`).
* `GET /api/tasks`, `/api/tasks/recoverable`, and `/api/tasks/:id` support task
  listing/recovery/details.

Backend implementation: `runtime/myraaRuntime.ts:1085-1108`; frontend:
`src/components/FloatingTaskHud.tsx:66-78`,
`src/lib/appApi.ts:389,391-392`.

Electron's separate task overlay has IPC as well as HTTP integration:

| IPC | Payload/behavior |
|---|---|
| `task:action` | Carries task ID/action; main process forwards to the REST task action route and returns `{ok:true}` after dispatch. |
| `task:telemetry` subscription | Delivers `{task}` updates to the overlay renderer. |
| `task:close`, `task:minimize` | Overlay lifecycle actions. |

See `electron/main.cjs:944-990,1078-1101` and
`electron/taskPreload.cjs:5-12`.

### Confirmation overlays

`FloatingConfirmationOverlay` listens to confirmation state from `/events`,
shows the first pending request's capability/title/description/details, and
sends Deny or Authorize:

* Initial sync: `GET /api/confirmations`.
* Normal confirmation: `POST /api/confirmations/:id` with
  `{approved: boolean, remember:"once"}`; returns `{ok:boolean}`.
* Cognition confirmation IDs prefixed `cognition:` use
  `POST /api/cognition/confirm` with
  `{confirmationId: string, approved: boolean}`.
* Event types include `confirmation.requested` and
  `confirmation.resolved`.

The Electron overlay's `resolve(id, approved)` IPC forwards
`{approved, remember:"once"}` to the backend confirmation route.
See `src/components/FloatingConfirmationOverlay.tsx:11-32`,
`src/lib/appApi.ts:396-400`, `runtime/myraaRuntime.ts:1113-1115`,
`server.ts:2978-3001`, `electron/overlayPreload.cjs:5-11`, and
`electron/main.cjs:1043-1068`.

### System Telemetry widget

The Settings controls configure `systemMonitor.enabled`,
`systemMonitor.updateIntervalSeconds`, and `systemMonitor.corner`.
`SystemTelemetryWidget` opens/closes its drawer and consumes the
`system.telemetry` event from `/events`; it does not issue a telemetry fetch.
It displays CPU, memory, GPU, disk, and network metrics.

Events use the common `{type, at, payload}` envelope. The runtime sends the
latest snapshot when an `/events` client connects and forwards subsequent
updates. The precise snapshot schema is `SystemTelemetrySnapshot` in
`services/systemMonitor.ts`; publishing/forwarding is in
`runtime/myraaRuntime.ts:960-975,391-408`. Frontend use:
`src/components/SystemTelemetryWidget.tsx:85-110,218` and
`src/lib/useAppEvents.ts:160-178`.

### Weather & News widget

Opening the header widget opens its drawer. Initial load, city changes, and
refresh timer call:

* `GET /api/weather-news?city=…&country=…&lat=…&lon=…&unit=…&category=…`
  (settings provide defaults for omitted values). Response is the weather/news
  service result; its exact shape is service-defined.
* City search: `GET /api/cities/search?q=…`, returning `{results}`.
* City/unit/category selections persist through the
  `weatherNews` app-settings patch.

Backend route implementation is in `server.ts:3986-4042`;
frontend calls are in `src/components/WeatherNewsWidget.tsx:118-174,184-198,229-257,272`.

### Code Studio

Sidebar Code Studio opens `CodeStudio`; its AI task action creates a task
through `POST /api/tasks` with `{goal, origin:"text"}`.

Workspace calls from `src/components/CodeStudio.tsx`:

| Action | Request |
|---|---|
| List files | `GET /api/workspace/files?dir=…` |
| Read file | `GET /api/workspace/file?path=…` |
| Write file | `POST /api/workspace/file` `{path, content}` |
| Create empty file | `POST /api/workspace/files/create` `{path, content}` |
| Create folder | `POST /api/workspace/folders/create` `{path}` |
| Scaffold template | `POST /api/workspace/templates/scaffold` `{templateId?, name?, targetDir?}` |
| Rename / delete | `POST /api/workspace/rename` `{oldPath,newPath}`; `POST /api/workspace/files/delete` `{path}` |
| Execute | `POST /api/workspace/execute` `{command}` |

Workspace success responses are JSON: files listing `{root,items}` with each
item `{name,isDir,path}`, file read `{path,content}`, and mutations typically
`{ok:true,...}`. Scaffold returns `{ok:true,path,filename}`. Execution returns
the workspace command runner's result. Paths are constrained to the configured
workspace; commands are length-checked, screened, and subject to capability
checks. Workspace errors are returned as `{error}`.

Backend routes: `runtime/myraaRuntime.ts:1328-1580`; frontend callsites:
`src/components/CodeStudio.tsx:271-272,341,410-413,561-585,607-610,641-644,670-673`.

Tool/plugin integration:

* `GET /api/brain/tools` lists registered tools.
* `POST /api/brain/tools/refresh` refreshes desktop-agent tools.
* `GET /api/brain/plugins` returns plugin status.
* `POST /api/brain/plugins/sync` requests remote plugin sync.
* `POST /api/brain/tools/generate` accepts
  `{spec:{name,description,arguments_schema,code}}`; malformed requests return
  HTTP 400, successful or confirmation-required executions return HTTP 200,
  and other unsuccessful outcomes return HTTP 403. The result is the Central
  Brain tool execution outcome.

The tool-generation route validates input and invokes
`generate_and_register_tool` (`server.ts:1910-1952`). Corresponding UI calls:
`src/components/CodeStudio.tsx:175-195,227-238`.

### Mini-games hub

Settings → Companion → Mini-games → Play opens `MiniGamesHub`. Tic-Tac-Toe
square selection sends `POST /api/games/tic-tac-toe/move` with
`{board: string[]}` (nine cells); response contains the AI move/game result.
Starting a new round resets the board locally. Backend handler:
`runtime/myraaRuntime.ts:1270`; frontend:
`src/components/MiniGamesHub.tsx:19-55` and
`src/components/SettingsPanel.tsx:2268-2270,2308`.

### Other Sidebar data calls

* **Memory & Recalls:** `GET /api/memories` returns the memories array; add
  with `POST /api/memories` `{category,text}` returns a created record with
  `id`, `category`, `text`, `createdAt`, and `updatedAt` (HTTP 201); delete
  with `DELETE /api/memories/:id` returns `{success:true}`. Active sessions may receive `/live`
  `{type:"memory_sync",memories}`. UI: `src/components/MemoryDashboard.tsx`;
  App wiring: `src/App.tsx:803-805,821-854,1040-1044`.
* **Daily Pulse & Flashcards:** `GET /api/kg/summary?date=…`; generate with
  `POST /api/kg/generate` `{date}`. Date navigation refetches; todo/card
  interactions are local, and copy uses `navigator.clipboard`.
  UI: `src/components/DailySummaryCard.tsx:57-58,69-103,114-132`;
  API helper: `src/lib/appApi.ts:482-485`.
* **Mobile Connect:** `GET /api/mobile/connect-info` (no body/query in the UI);
  consumes `{urls, qrCode, pairingCode}`.
  UI: `src/App.tsx:770-785,797,1757-1780`.
* **PC Permissions:** `GET /api/permissions`; update one capability with
  `POST /api/permissions/:capability` `{decision}`; update messaging policy
  with `POST /api/permissions/messaging` `{mode}`.
  UI: `src/components/SettingsPanel.tsx:1069-1075,1136`;
  helper: `src/lib/appApi.ts:401-403`.

### Shared `/events` WebSocket envelope

The runtime's `/events` WebSocket forwards application events as
`{type:string, at:string, payload:object}`. On connection it seeds presence,
conversation, social, model, DND, latest telemetry, active tasks, and pending
confirmations, then forwards published events. HUD-relevant types include
`task.updated`, `task.step`, `task.finished`, `question.asked`,
`confirmation.requested`, `confirmation.resolved`, and `system.telemetry`.
Additional declared types include `react.stage`, but a matching publisher
was not found during this scan.

Frontend connection/subscriptions: `src/lib/useAppEvents.ts:82-85,106-124,160-178`.
Server delegation: `server.ts:4408-4409,4455`;
runtime stream: `runtime/myraaRuntime.ts:960-1004`;
event type/envelope definition: `shared/appEvents.ts:9-54`.

An SSE alternative, `GET /api/gateway/events`, streams the same envelope and
seeds pending confirmations (`server.ts:2722-2755`).

### Electron shell IPC and navigation

The Electron preload exposes callbacks for opening Settings, Studio, Chat,
Daily Summary, and setting view mode (`electron/preload.cjs:43-66`).
`app:set-view-mode` is handled in `electron/main.cjs:1119`. These IPC calls
control the desktop shell/navigation; the listed HUD data continues to use
the HTTP/WebSocket routes above. Task/confirmation overlay IPC is detailed in
their respective sections.

## 3. Endpoint, API, and Event Index

| Interface | Frontend trigger | Request/event payload | Backend behavior / response |
|---|---|---|---|
| `WS /live` | Chat text, voice, audio-session updates | Client `{type:"text",text}`; live audio/control messages | Audio `{type:"audio",audio}`, transcript `{type:"transcription",role,text}`, `{type:"turnComplete"}`, `reactStatus`, `memory_sync`; `server.ts:4405+`. |
| `WS /events` | HUD event hook connects | Server event `{type,at,payload}` | Initial status/task/confirmation snapshots and streamed app events; `runtime/myraaRuntime.ts:960-1004`. |
| `GET /api/app-settings` | App settings initialization | None | Current runtime settings object; `runtime/myraaRuntime.ts:1197-1198`. |
| `POST /api/app-settings` | Runtime settings control changes | Nested settings patch | Updated settings object; used for HUD, task, weather, orb, voice, and editor controls. |
| `GET /api/settings` | Renderer settings initialization | None | Renderer settings plus `ttsProvider`; `server.ts:3261-3305`. |
| `POST /api/settings` | Renderer settings change | Settings patch object | Updated renderer settings; protects `networkAccessEnabled` and startup permission changes. |
| `GET /api/tasks` | Initial Task HUD sync | `?limit=10` in HUD | Current task list. |
| `GET /api/tasks/recoverable` | Task recovery | None | Recoverable public task views. |
| `GET /api/tasks/:id` | Task details | ID in path | One public task view. |
| `POST /api/tasks` | Create/start task | `{goal,origin?}` | Created public task view; `origin` is voice only when exactly `"voice"`; HUD helper uses `"text"`. |
| `POST /api/tasks/:id/:action` | Task controls | `{}` or answer `{text}` | Supports stop/pause/resume/takeover/return/answer/continue; usually `{ok:boolean}`, `continue` returns a public task view; `runtime/myraaRuntime.ts:1085-1108`. |
| `GET /api/confirmations` | HUD initial sync | None | Pending confirmations. |
| `POST /api/confirmations/:id` | Authorize/deny | `{approved,remember?}` | `{ok:boolean}`. |
| `POST /api/cognition/confirm` | Resolve `cognition:` confirmation | `{confirmationId,approved}` | Resolves cognition approval. |
| `GET /api/weather-news` | Open/refresh weather drawer | Query city/coords/unit/category | Weather/news service result. |
| `GET /api/cities/search` | Search city in widget/settings | `?q=…` | `{results}`. |
| `POST /api/screen-vision` | Screen vision request (when surfaced) | `{max_dim?,keep_file?}` | `{ok,width,height,active_window,image_base64,image_mime,source}` or `{error}`; `server.ts:3898-3978`. |
| `GET /api/memories` | Memory dashboard initial load | None | Memories array. |
| `POST /api/memories` | Add a memory | `{category,text}` | HTTP 201 and record `{id,category,text,createdAt,updatedAt}`. |
| `DELETE /api/memories/:id` | Delete a memory | ID in path | `{success:true}`. |
| `GET /api/kg/summary` | Daily summary open/date change | `?date=…` | Summary for requested date. |
| `POST /api/kg/generate` | Generate missing/forced summary | `{date}` | Generated summary result. |
| `GET /api/mobile/connect-info` | Mobile Connect open | None | `{urls,qrCode,pairingCode}`. |
| `GET /api/permissions` | Open PC Permissions | None | Current permission state. |
| `POST /api/permissions/:capability` | Change capability choice | `{decision}` | Updated permission state. |
| `POST /api/permissions/messaging` | Change message policy | `{mode}` | Updated policy. |
| `GET /api/workspace/files`, `GET /api/workspace/file` | Code Studio browse/read | `dir` or `path` query | `{root,items}` or `{path,content}`. |
| `POST /api/workspace/file`, `POST /api/workspace/files/create`, `POST /api/workspace/folders/create`, `POST /api/workspace/rename`, `POST /api/workspace/files/delete` | Code Studio mutations | `{path,content}`, `{oldPath,newPath}`, or `{path}` | `{ok:true,...}` operation result. |
| `POST /api/workspace/templates/scaffold` | Code Studio template | `{templateId?,name?,targetDir?}` | `{ok:true,path,filename}`. |
| `POST /api/workspace/execute` | Code Studio run command | `{command}` | Workspace command result; screened, capability-checked. |
| `/api/brain/tools` and `/api/brain/plugins` | Code Studio inspect tools/plugins | GET, plus refresh/sync POST | Registry/plugin status; generation route accepts `{spec:{name,description,arguments_schema,code}}`. |
| `POST /api/games/tic-tac-toe/move` | Tic-Tac-Toe cell click | `{board:string[]}` | AI move/game result. |
| `GET /api/gateway/events` | SSE client (alternative to `/events`) | Event stream | `{type,at,payload}` records. |
| Electron IPC | Desktop shell/overlay actions | Topics and payloads listed above | Renderer navigation, task overlay forwarding, confirmation forwarding. |

The response schemas explicitly marked service-defined or summarized above
should be treated as implementation-facing payloads rather than a promise of
stable public API versioning; verify route handlers before introducing a
replacement client.

## 4. Future Cyberpunk / Sci-Fi Theming Notes

> **Placeholder for the upcoming 3D HUD replacement.**
>
> The immersive cyberpunk/holographic interface may replace the current visual
> presentation, stage composition, panels, and animations. It must retain
> **100% compatibility with the exact existing endpoints, WebSocket paths,
> event types/envelopes, IPC topics, and request/response payloads documented
> above**. Theme and layout upgrades must not silently rename, remove, or
> change these integration contracts. Any future API evolution must be
> versioned and migrated deliberately, with compatibility coverage for all
> existing HUD actions.
