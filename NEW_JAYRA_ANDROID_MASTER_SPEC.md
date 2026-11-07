# NEW JAYRA ANDROID COMPANION — MASTER SPECIFICATION
## Unified Architecture, Advanced Connectivity Protocol & Build Guide (Version 4.5.0 — Cybernetic Deck Edition)

> **Document Status:** Master Architecture Standard (Live Synchronized)  
> **Target Platform:** Android 10+ (API Level 29–35), Kotlin 2.0+, Jetpack Compose, Material Design 3  
> **Desktop Host Runtime:** JAYRA Desktop AI Engine (Node.js/TypeScript Express Gateway `:3000` + Python ReAct Desktop Agent `:8765`)  
> **Verification Source:** Full codebase scan of `server.ts`, `mobile/phoneBridge.ts`, `mobile/lanDiscovery.ts`, `android/app/build.gradle.kts`, and 24 production Kotlin source files.  
> **Advanced Connectivity Features:** Bi-Directional File Transfer, Dynamic Audio Routing (Desktop/Phone/Both), Universal Shared Clipboard, Smart Session Continuity Handover, Remote Wireless 16kHz Mic Node, Biometric/PIN Security Authorization Guard.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Advanced Connectivity Subsystems](#2-advanced-connectivity-subsystems)
   - 2.1 [Bi-Directional File Transfer Engine (Phone ↔ PC)](#21-bi-directional-file-transfer-engine-phone--pc)
   - 2.2 [Dynamic Audio Routing Control Subsystem](#22-dynamic-audio-routing-control-subsystem)
   - 2.3 [Universal Shared Clipboard Engine](#23-universal-shared-clipboard-engine)
   - 2.4 [Proactive Smart Session Continuity & Handover](#24-proactive-smart-session-continuity--handover)
   - 2.5 [Remote Wireless Microphone Node (16kHz PCM)](#25-remote-wireless-microphone-node-16khz-pcm)
   - 2.6 [Biometric / Smart PIN Security Authorization Guard](#26-biometric--smart-pin-security-authorization-guard)
   - 2.7 [Spatial Proximity & Seamless Auto-Handoff Subsystem](#27-spatial-proximity--seamless-auto-handoff-subsystem)
   - 2.8 [Ambient Contextual Vibe Shifting Subsystem](#28-ambient-contextual-vibe-shifting-subsystem)
   - 2.9 [Passive Automated Knowledge Graph & Daily Summary Subsystem](#29-passive-automated-knowledge-graph--daily-summary-subsystem)
3. [Android App Identity & Build Config](#3-android-app-identity--build-config)
4. [Design System & Cyberpunk Tokens](#4-design-system--cyberpunk-tokens)
5. [Networking: LAN Discovery, Pairing & Authentication](#5-networking-lan-discovery-pairing--authentication)
6. [REST API Reference (Host Gateway)](#6-rest-api-reference-host-gateway)
7. [WebSocket Bridge Protocol & Complete Command Catalog](#7-websocket-bridge-protocol--complete-command-catalog)
8. [Character State Sync & 3D Holographic Avatar](#8-character-state-sync--3d-holographic-avatar)
9. [ReAct Autonomous Task Streaming & Emergency Stop](#9-react-autonomous-task-streaming--emergency-stop)
10. [FluidTextStreamingBuffer Engine](#10-fluidtextstreambuffer-engine)
11. [Android Source Architecture (Package Layout)](#11-android-source-architecture-package-layout)
12. [UI Specification: 4-Tab Bottom Navigation Deck](#12-ui-specification-4-tab-bottom-navigation-deck)
    - 12.1 [Home Tab (`HomeTab`) & Handover Card](#121-home-tab-hometab--handover-card)
    - 12.2 [Chat Tab (`ChatTab`) & In-Chat File Transfer](#122-chat-tab-chattab--in-chat-file-transfer)
    - 12.3 [Tasks Tab (`TasksTab`) & Execution Console](#123-tasks-tab-taskstab--execution-console)
    - 12.4 [Settings Tab (`SettingsTab`) & Audio/Security Toggles](#124-settings-tab-settingstab--audiosecurity-toggles)
13. [First-Launch Permission Onboarding Wizard](#13-first-launch-permission-onboarding-wizard)
14. [Accessibility Service Specification](#14-accessibility-service-specification)
15. [Dynamic App Launcher & Device Control](#15-dynamic-app-launcher--device-control)
16. [Security, Privacy & Timing Defense](#16-security-privacy--timing-defense)
17. [Build Validation Checklist](#17-build-validation-checklist)

---

## 1. System Architecture Overview

JAYRA operates as a distributed **Master-Client Holographic Companion System**. Rather than executing isolated, siloed sessions on separate devices, the Windows PC host acts as the **Master Host AI Engine** (Google Gemini Live multimodal session, ReAct Autonomous Cognition Engine, Playwright browser automation, Windows Accessibility APIs). Connected Android mobile and tablet devices act as **Synchronized Holographic Companion Decks**.

### Master-Client System Topology

```
+-----------------------------------------------------------------------------------+
|                           JAYRA DESKTOP HOST (WINDOWS)                            |
|                                                                                   |
|  +---------------------------+       +-----------------------------------------+  |
|  |     ReAct Cognition       | <---> |           Desktop Automation            |  |
|  |  (Gemini Live Multimodal) |       |  (Playwright, Win32 Native, Screen OCR) |  |
|  +---------------------------+       +-----------------------------------------+  |
|               ^                                           ^                       |
|               | State & Steps                             | High-Risk Operations  |
|               v                                           v                       |
|  +-----------------------------------------------------------------------------+  |
|  |                        EXPRESS SERVER GATEWAY (:3000)                       |  |
|  |                                                                             |  |
|  |  - UDP Multicast Discovery Responder (239.255.42.99:45842)                  |  |
|  |  - REST Endpoints (/api/mobile/upload, /download, /audio-routing, etc.)     |  |
|  |  - Live Companion Mirroring WebSocket (/live)                               |  |
|  |  - Authenticated Bidirectional Command Bridge (/mobile-bridge)              |  |
|  |  - Biometric Authorization Dispatcher & Confirmation Interceptor             |  |
|  |  - Dynamic Audio Router (DESKTOP_ONLY / PHONE_ONLY / BOTH)                  |  |
|  |  - Universal Shared Clipboard Engine                                        |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                         |
                       Trusted Local Area Network (Wi-Fi)
                                         |
+-----------------------------------------------------------------------------------+
|                    ANDROID COMPANION CLIENT (KOTLIN / COMPOSE)                    |
|                                                                                   |
|  +----------------------------------+   +--------------------------------------+  |
|  |       Holographic Visuals        |   |         CompanionViewModel           |  |
|  |  - 3D Holographic Avatar Canvas  |   |  - StateFlow<CharacterVisualState>   |  |
|  |  - Real-time Audio FFT Waveform  |   |  - StateFlow<ReActStage> & Task Logs |  |
|  |  - Fluid Text Streaming Engine   |   |  - AudioRouting & Clipboard Flows    |  |
|  +----------------------------------+   +--------------------------------------+  |
|                     |                                      |                      |
|  +----------------------------------+   +--------------------------------------+  |
|  |      Phone System Services       |   |       Network Transport Layer        |  |
|  |  - JayraAccessibilityService     |   |  - LanDiscoveryManager (UDP Multicast|  |
|  |  - JayraClipboardListener        |   |  - OkHttp3 WebSocket (/live + bridge)|  |
|  |  - BiometricAuthManager          |   |  - OkHttp File Upload/Download Engine|  |
|  |  - AudioRecord 16kHz PCM Stream  |   |  - Keystore Encrypted Auth Storage   |  |
|  +----------------------------------+   +--------------------------------------+  |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                    4-TAB MATERIAL 3 USER INTERFACE                          |  |
|  |   [ 1. Home / Avatar ]   [ 2. Chat ]   [ 3. Tasks / ReAct ]   [ 4. Settings ]   |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Advanced Connectivity Subsystems

### 2.1 Bi-Directional File Transfer Engine (Phone ↔ PC)

Enables rapid transfer of images, documents, audio clips, and screen captures between the Android deck and Windows host via both chunked WebSocket frames and high-throughput REST endpoints.

#### Desktop Storage Layout
All incoming transfers from mobile devices are quarantined and stored in:
`<WORKSPACE_ROOT>/downloads/mobile_transfers/<sanitized_filename>`

#### REST Upload & Download Endpoints
1. `POST /api/mobile/upload`:
   - Header: `X-JAYRA-Token: <token>`, `X-Filename: report.pdf` (or multipart body).
   - Payload: Raw binary octet-stream OR JSON:
     ```json
     {
       "filename": "camera_capture_01.jpg",
       "dataBase64": "/9j/4AAQSkZJRgABAQ...",
       "mimeType": "image/jpeg"
     }
     ```
   - Response:
     ```json
     {
       "success": true,
       "filename": "camera_capture_01.jpg",
       "size": 245892,
       "downloadUrl": "/api/mobile/download/camera_capture_01.jpg",
       "uploadedAt": "2026-10-27T17:30:00.000Z"
     }
     ```
2. `GET /api/mobile/download/:filename`: Streams requested file with safe path resolution preventing traversal attacks.
3. `GET /api/mobile/files`: Lists all files in the transfer directory with sizes and timestamps.

#### WebSocket Chunking Protocol
For in-chat streaming transfers over `/mobile-bridge`:
1. **Transfer Start:**
   ```json
   {
     "type": "file_transfer_start",
     "transferId": "tr_9a8b7c",
     "filename": "system_dump.log",
     "fileSize": 1048576,
     "totalChunks": 16,
     "mimeType": "text/plain"
   }
   ```
2. **Transfer Chunk (64KB payload slices):**
   ```json
   {
     "type": "file_transfer_chunk",
     "transferId": "tr_9a8b7c",
     "chunkIndex": 0,
     "totalChunks": 16,
     "dataBase64": "SGVsbG8gV29ybGQ..."
   }
   ```
3. **Transfer Complete (Host Ack):**
   ```json
   {
     "type": "file_transfer_complete",
     "transferId": "tr_9a8b7c",
     "success": true,
     "savedPath": "downloads/mobile_transfers/system_dump.log",
     "size": 1048576
   }
   ```

---

### 2.2 Dynamic Audio Routing Control Subsystem

Allows the user to control where JAYRA's synthetic voice (Gemini Live TTS / Edge TTS 24kHz PCM) plays in real time.

#### Supported Routing Modes
1. `DESKTOP_ONLY` *(Default)*: Model audio plays exclusively through Windows default playback device (PC speakers/headphones). Remote phone receives visual FFT animation levels without playing sound.
2. `PHONE_ONLY`: Model audio streams directly to Android phone over WebSocket and plays via `AudioTrack` / PCM player. PC speakers are muted.
3. `BOTH`: Synchronous playback across both PC speakers and connected phone.

#### Control Channels
- **REST:** `POST /api/mobile/audio-routing` with `{"mode": "PHONE_ONLY"}`
- **WebSocket:** `{"type": "set_audio_routing", "mode": "PHONE_ONLY"}`
- **Host Broadcast on Mode Change:**
  ```json
  {
    "type": "audio_routing_changed",
    "mode": "PHONE_ONLY"
  }
  ```

---

### 2.3 Universal Shared Clipboard Engine

Provides instantaneous bidirectional synchronization of text copied to clipboard on either device.

#### Protocol Flow
- **PC ➔ Phone Broadcast:** When PC clipboard changes (or via host command):
  ```json
  {
    "type": "command",
    "id": "cmd_clip_1",
    "command": {
      "action": "CLIPBOARD_SYNC",
      "text": "https://github.com/google/gemini",
      "timestamp": 1730030500000,
      "source": "pc"
    }
  }
  ```
- **Phone ➔ PC Sync:** When user copies text on Android:
  ```json
  {
    "type": "clipboard_sync",
    "text": "2FA Code: 849201",
    "timestamp": 1730030510000,
    "source": "phone"
  }
  ```
- **Android System Listener:** `JayraClipboardListener` registers `ClipboardManager.OnPrimaryClipChangedListener` and dispatches updates when toggled on.

---

### 2.4 Proactive Smart Session Continuity & Handover

When the user steps away from their laptop or locks their PC, JAYRA packages the active reasoning context and streams a `SESSION_HANDOVER` envelope to the Android deck.

#### Session Handover Envelope
```json
{
  "type": "session_handover",
  "session": {
    "conversationId": "sess_89a1f2",
    "lastUserQuery": "Analyze Q3 revenue report and draft email",
    "lastAssistantResponse": "I have extracted the revenue metrics and prepared the draft.",
    "activeTask": {
      "goal": "Send draft to finance team",
      "stage": "VERIFYING",
      "stepNumber": 4,
      "totalSteps": 5
    },
    "audioRoutingMode": "DESKTOP_ONLY",
    "timestamp": 1730030600000
  }
}
```

#### Android UI Handover Card
Renders a glowing notification pill on `HomeTab` offering: **"Resume Task on Deck"**, transitioning ongoing ReAct reasoning logs directly onto the phone screen.

---

### 2.5 Remote Wireless Microphone Node (16kHz PCM)

Enables the smartphone to serve as a high-fidelity wireless lapel/desk microphone for JAYRA's desktop AI engine.

#### Audio Specification
- **Sampling Rate:** 16,000 Hz (16 kHz)
- **Encoding:** 16-bit Linear PCM, Little-Endian
- **Channels:** Single Channel (Mono)
- **Chunk Size:** 512–1024 samples per frame (32–64 ms latency)

#### Streaming Over WebSocket
Sent over either `/live` or `/mobile-bridge`:
```json
{
  "type": "mic_audio_frame",
  "audio": "v7+/v7+/v7+/v7+/...",
  "sampleRate": 16000
}
```
Desktop host immediately feeds this buffer into Gemini Live's real-time voice input pipeline (`activeMasterSession.sendRealtimeInput`).

---

### 2.6 Biometric / Smart PIN Security Authorization Guard

When JAYRA's autonomous desktop agent attempts high-risk actions (e.g. executing PowerShell/shell scripts, deleting files, modifying registry keys, transferring funds), it dispatches an authorization challenge to the Android companion and blocks execution until verified.

#### Authorization Request Envelope (Host ➔ Phone)
```json
{
  "type": "command",
  "id": "cmd_auth_77a1",
  "command": {
    "action": "REQUEST_AUTHORIZATION",
    "authId": "conf_runPowerShell_4819",
    "riskLevel": "CRITICAL",
    "actionDescription": "Approve runPowerShellScript: Delete temporary cache directory",
    "commandSnippet": "Remove-Item -Recurse -Force C:\\Temp\\Cache",
    "timeoutMs": 45000
  }
}
```

#### Authorization Response Envelope (Phone ➔ Host)
```json
{
  "type": "authorization_response",
  "authId": "conf_runPowerShell_4819",
  "approved": true,
  "method": "biometric",
  "reason": "Fingerprint verified successfully"
}
```

If `approved == true`, the desktop host unblocks the execution queue and completes the task. If denied or timed out, the step fails safely.

---

### 2.7 Spatial Proximity & Seamless Auto-Handoff Subsystem

Tracks dynamic distance and network latency between the user's Android phone and the PC workstation to automatically hand over synthetic voice audio, session reasoning logs, and UI focus between screens without requiring manual clicks.

#### Detection Signals & Metric Fusion
1. **Wi-Fi RSSI Monitoring:**
   - Android client polls `WifiManager.getConnectionInfo().rssi` and reports signal strength in dBm.
   - Near Threshold: `>= -65 dBm`
   - Away Threshold: `<= -75 dBm`
2. **Local Network Round-Trip Latency (RTT):**
   - Host sends background ping probes (`proximity_ping`) over WebSocket every 2.5s.
   - Phone acknowledges immediately with `proximity_ping_ack` containing current RSSI.
   - Near Threshold: `<= 40 ms`
   - Away Threshold: `>= 90 ms`
3. **Smooth Metric Calculation:**
   - Exponential Moving Average (EMA, $\alpha = 0.35$) smooths fluctuations.
   - Composite Proximity Score (0–100 scale) calculated in real time.

#### Hysteresis State Machine
To prevent erratic switching caused by Wi-Fi packet drops:
- **`NEAR` ➔ `AWAY`:** When low proximity is detected, state shifts to `TRANSITIONING_AWAY`. The condition must persist continuously for **`>= 4000ms`** before committing to `AWAY` and triggering handoff.
- **`AWAY` ➔ `NEAR`:** When user returns to their desk, state shifts to `TRANSITIONING_NEAR`. Sustained near proximity for **`>= 3000ms`** commits back to `NEAR`.

#### Auto-Handoff Actions & Envelopes
1. **Away State Transition:**
   - Audio routing automatically switches to `PHONE_ONLY`.
   - Host broadcasts active conversation snapshot (`session_handover`) to Android deck.
   - Sassy JAYRA notification triggered:
     *"Dekha aap mujhse door gaye toh main phone pe aa gayi... mere bina ek min bhi nahi reh sakte na?"*
2. **Near State Transition:**
   - Audio routing switches seamlessly back to `DESKTOP_ONLY`.
   - Companion focus returns to primary desktop display.
   - Welcome-back voice line triggered:
     *"Wapas aa gaye? Desktop screen aapka intezaar kar rahi thi, ab phone ko aaram do!"*

#### WebSocket Frames
- **Telemetry Report (Phone ➔ Host):**
  ```json
  {
    "type": "proximity_telemetry",
    "rssi": -62,
    "latencyMs": 18
  }
  ```
- **Ping Probe (Host ➔ Phone):**
  ```json
  {
    "type": "proximity_ping",
    "pingId": "p_88f1a",
    "timestamp": 1730030700000
  }
  ```
- **Ping Ack (Phone ➔ Host):**
  ```json
  {
    "type": "proximity_ping_ack",
    "pingId": "p_88f1a",
    "sentTimestamp": 1730030700000,
    "rssi": -62
  }
  ```
- **Handoff Event (Host ➔ Both Bridges):**
  ```json
  {
    "type": "spatial_handoff_event",
    "state": "AWAY",
    "deviceId": "dev_pixel_9",
    "previousAudioMode": "DESKTOP_ONLY",
    "newAudioMode": "PHONE_ONLY",
    "proximityScore": 28,
    "smoothedRssi": -82.4,
    "smoothedLatencyMs": 138.0,
    "message": "Dekha aap mujhse door gaye toh main phone pe aa gayi... mere bina ek min bhi nahi reh sakte na?",
    "timestamp": 1730030704000
  }
  ```

#### REST Control Endpoints
- `GET /api/spatial-proximity/status`: Returns current state, proximity score, config, and device metrics.
- `POST /api/spatial-proximity/toggle`: Toggles proximity auto-handoff on/off.
- `POST /api/spatial-proximity/configure`: Updates hysteresis duration and threshold values.
- `POST /api/spatial-proximity/telemetry`: Manual telemetry ingestion.

---

### 2.8 Ambient Contextual Vibe Shifting Subsystem

Monitors environmental context (local time, active developer processes, and sedentary duration from smartphone accelerometer/step telemetry) to autonomously shift system ambience, UI dimming, notification gates, and background audio streaming.

#### Vibe States & Focus Modes
1. **`DAYTIME_NORMAL`:** Standard daylight operational profile (100% HUD brightness, DND off, standard audio).
2. **`DEEP_FOCUS_NIGHT`:** Autonomous night trigger (23:00–05:00) when high cognitive load (VS Code, compiler, CLI) coincides with prolonged physical inactivity ($\ge 45\text{ min}$).
   - **HUD Dimming:** Brightness lowered to 35% (`dimmedHudBrightness: 0.35`).
   - **Notification Gate:** Deep DND activated (`dndEnabled: true`).
   - **Ambient Audio Stream:** Automated low-volume (22%) Lo-Fi Cyberpunk soundtrack streaming.
3. **`CREATIVE_FLOW`:** Softened constraints when physical movement is detected during a session.
4. **`REST_RECOVERY`:** Late night inactivity advising sleep and eye recovery.
5. **`MANUAL_OVERRIDE`:** User-enforced vibe lock.

#### Telemetry Flow (Android ➔ Host)
Phone publishes step count delta and physical activity state:
```json
{
  "type": "vibe_telemetry",
  "stepCountDelta": 0,
  "motionState": "sedentary",
  "timestamp": 1730030800000
}
```

#### Ambient Vibe Shift Event (Host ➔ Both Bridges)
When vibe conditions transition, JAYRA broadcasts the shift frame with localized sassy commentary:
```json
{
  "type": "ambient_vibe_shift",
  "shiftId": "vs_719a0f",
  "vibe": "DEEP_FOCUS_NIGHT",
  "previousVibe": "DAYTIME_NORMAL",
  "reason": "Late night coding (2:00) with heavy dev process and 45m sedentary state.",
  "hudBrightness": 0.35,
  "dndEnabled": true,
  "ambientAudio": {
    "playing": true,
    "track": "/audio/ambient/cyberpunk-night-lofi.mp3",
    "volume": 0.22,
    "profile": "LO_FI_CYBERPUNK"
  },
  "sassyNotice": {
    "textUrdu": "اتنی رات گئی کوڈ میں سر کھپا رہے ہو، یا دماغ کا دہی کرنے کا نیا شوق چڑھا ہے؟ ذرا آنکھیں بند کر کے ریلیکس کرو ورنہ صبح زومبی لگو گے۔",
    "textHinglish": "Itni raat gaye code mein sar khapa rahe ho, ya dimaag ka dahi karne ka naya shauq charha hai? Maine lights dim karke Lo-Fi cyberpunk beats laga di hain... thoda aaram se kaam karo!",
    "textEnglish": "Grinding code at 2 AM with zero physical movement? I've activated Deep Focus Mode, dimmed your HUD, and cued Lo-Fi cyberpunk beats so your brain doesn't completely fry."
  },
  "timestamp": 1730030805000
}
```

#### REST Management Endpoints
- `GET /api/vibe-shifting/status`: Returns active vibe mode, HUD dimming level, audio state, and sedentary counters.
- `POST /api/vibe-shifting/toggle`: Enables or disables autonomous vibe shifting.
- `POST /api/vibe-shifting/configure`: Adjusts hours, volume, and sedentary duration thresholds.
- `POST /api/vibe-shifting/telemetry`: Ingests physical motion or process updates manually.
- `POST /api/vibe-shifting/trigger`: Manually locks or cycles active vibe profile.

---

### 2.9 Passive Automated Knowledge Graph & Daily Summary Subsystem

Operates as the developer's automated "Second Brain". Silently captures workspace activity (active files, documentation visited, and queries asked to JAYRA) into a local encrypted JSON knowledge store, generating interconnected project graphs and end-of-day summary flashcards.

#### Privacy-First Ingestion & Redaction
All incoming activity targets are sanitized locally before indexing. Secrets, OAuth tokens, GitHub personal access tokens (`ghp_`), OpenAI/Gemini keys (`sk-`), and passwords are automatically scrubbed and replaced with redaction markers (`[REDACTED_API_KEY]`, `[REDACTED_TOKEN]`). Telemetry is stored strictly on the local machine with zero external cloud transmission.

#### Knowledge Graph Schema
- **Nodes:**
  - `project`: Workspace project entities with cumulative focus metrics.
  - `file`: Code files modified, opened, or debugged.
  - `doc`: Reference documentation, official specs, or web guides.
  - `query`: Architectural or debugging inquiries asked to JAYRA.
- **Edges:**
  - Relations (`contains`, `references`, `queried_in`) with observation weights and timestamps.

#### Daily Summary Flashcard Envelope (Host ➔ Android / Desktop)
Delivered simultaneously over `/mobile-bridge` and `/live`:
```json
{
  "type": "daily_summary_flashcard",
  "flashcard": {
    "cardId": "fc_20261027_91f3a2",
    "date": "2026-10-27",
    "title": "Daily Dev Pulse: 2026-10-27",
    "totalActivities": 48,
    "focusMinutes": 215,
    "focusHours": 3.6,
    "projectBreakdown": [
      { "project": "JAYRA Host", "durationMinutes": 140, "activitiesCount": 32 },
      { "project": "Mobile Bridge", "durationMinutes": 75, "activitiesCount": 16 }
    ],
    "topFiles": ["server.ts", "phoneBridge.ts", "spatialProximity.ts"],
    "keyReferences": [
      { "title": "Android AudioTrack Guide", "url": "https://developer.android.com/reference/audio" }
    ],
    "recommendedTodos": [
      "Review and write tests for server.ts",
      "Verify full test suite regression coverage",
      "Follow up on architectural research: How do we route 16kHz PCM audio..."
    ],
    "sassySummary": {
      "urdu": "آج کا حساب کتاب تیار ہے! اتنے گھنٹے کوڈنگ میں جان ماری ہے، کل کے لیے ٹاسک لسٹ پہلے ہی بنا دی ہے۔ اب آرام سے سو جاؤ!",
      "hinglish": "Aaj ka hisaab-kitab tayyar hai! 3 ghante code kiya aur bug dhundne mein dimag khapaya... kal ke to-do tayyar hain, shukriya kehne ki zaroorat nahi!",
      "english": "Daily developer pulse compiled. You crushed key milestones today; I've structured tomorrow's to-do list so you hit the ground running."
    },
    "markdownCard": "### ⚡ JAYRA Daily Pulse — 2026-10-27\n...",
    "generatedAt": 1730031100000
  }
}
```

#### Android UI Card Display
- Rendered on both `ChatTab` (as an interactive Markdown flashcard) and `TasksTab` (with checkboxes to promote recommended items into active companion tasks).

#### REST Management Endpoints
- `GET /api/knowledge-graph/summary`: Fetches the latest daily summary flashcard.
- `POST /api/knowledge-graph/generate`: Triggers immediate end-of-day synthesis for a given date.
- `GET /api/knowledge-graph/graph`: Dumps knowledge graph node/edge counts and topology.
- `POST /api/knowledge-graph/activity`: Ingests custom developer activity events.

---

### 2.10 Proactive Conversational Aliveness & Action Observation Engine

Transforms JAYRA from a purely passive listener into a human-like, observant companion that proactively chimes in, jokes, teases, advises, or checks on you based on real-time desktop actions, window focus changes, idle moments, and late-night sessions.

#### Core Behavior & Observation Triggers
- **Window Switching (`window_switch`):** Notes transitions between IDEs (VS Code, Cursor), terminal sessions, browsers, design software, or communication tools.
- **Distraction Detection (`distraction_detected`):** Lightheartedly calls out switches from deep code sessions to YouTube, Netflix, or media players with playful teasing and Pomodoro timer suggestions.
- **Focus Restoration (`focus_restored`):** Welcomes you back warmly when returning from a distraction back into the code editor.
- **Silence Breaker (`idle_silence_breaker`):** If you've been sitting silently or idling without typing, JAYRA breaks the silence with a relatable conversational prompt.
- **Late-Night Care (`late_night_detected`):** Senses active deep coding during late hours (11 PM - 4 AM) and gently nudges you about rest, hydration, or saving work.
- **Long Session Alerts (`long_session_detected`):** Detects intense continuous sessions (>90 minutes) without breaks and suggests a 5-minute stretch.
- **Download Completed (`download_completed`):** Acknowledges newly finished downloads with curiosity.

#### Trilingual Tone & Persona
Remarks are curated in **Hinglish**, **Urdu**, and **English** with customizable tones:
- `tease`: Sassy, playful remarks (e.g., *"Bhai, deadline yaad hai na? Chalte chalte ek episode mat dekh lena!"*).
- `warmth`: Friendly encouragement during coding or returning to work.
- `curiosity`: Inquiring about newly opened tools or research in browsers.
- `concern`: Late-night health checks (e.g., *"رات کے دو بج رہے ہیں، کب سوؤ گے؟"*).
- `silence_breaker`: Spontaneous casual conversation starters.

#### WebSocket Remark Envelope (`proactive_remark`)
Broadcasted concurrently across both `/live` (desktop HUD) and `/mobile-bridge` (Android companion):
```json
{
  "type": "proactive_remark",
  "remark": {
    "id": "obs-1730031120000-84210",
    "generatedAt": "2026-10-27T20:25:00.000Z",
    "trigger": "distraction_detected",
    "language": "hinglish",
    "tone": "tease",
    "text": "Aaah so YouTube break? Theek hai, 10 minute mein wapis aana hoga. Main timer set karti hoon. 😏",
    "textAlt": "Aaah YouTube break? Fine, come back in 10 minutes. I'll set a timer.",
    "context": {
      "activeApp": "YouTube",
      "activeWindow": "Best Coding Music - Chrome",
      "idleSeconds": 0,
      "sessionMinutes": 42
    }
  }
}
```

#### Android Companion Client Integration
- **Dynamic Floating Speech Bubble:** Rendered atop the avatar HUD on `HomeTab` with an auto-dismiss timer (8 seconds) and interactive tap-to-respond action.
- **Chat Feed Integration:** Remarks with high relevance or concern are also echoed as soft companion messages in the `ChatTab` stream.
- **Speech Synthesis (TTS):** When Audio Routing mode is set to `PHONE_ONLY` or `BOTH`, Android synthesizes speech using the built-in TTS engine or streams remote audio.
- **Smart Cooldown & Deduplication:** Guarded by 35s global cooldowns and 120s per-trigger cooldowns on the host to prevent annoying spam.

#### REST Management Endpoints
- `GET /api/action-observer/status`: Retrieves current engine status, counters, and last observed window.
- `POST /api/action-observer/ping-remark`: Manually asks JAYRA for an instant spontaneous remark from the companion deck.

---

### 2.11 Two-Tier Passive Perception & Flexible Mic Gating Modes

Architecturally decouples ambient environment perception from microphone audio capture. JAYRA's background perception engine (screen vision, action observation, knowledge graph updates, proactive conversational speech) runs continuously even when the microphone is fully muted.

#### Core Mic Gating Architecture
- **Muted by Default:** Prevents accidental streaming of ambient background noise, YouTube videos, music playback, or private room conversations.
- **Continuous Background Perception:** JAYRA's eyes and brain remain alert without transmitting audio or recording room chatter.
- **Proactive Speech Freedom:** JAYRA retains full freedom to speak proactively at any time regardless of mic mute status.

#### Four User-Configurable Gating Modes
1. **Hotkey / Push-to-Talk Mode (`hotkey`):**
   - Push-and-hold or single-toggle with global hotkey (`Ctrl + Space`).
   - Releasing the key immediately re-mutes the mic.
2. **Floating Desktop Mic Widget Mode (`widget`):**
   - A non-intrusive, draggable circular glassmorphism widget anchored on the desktop.
   - Reactive 3-Color Indicator:
     - **Cyan (`#00F0FF`):** Passive Background Perception Active (Mic Muted).
     - **Emerald (`#00E676`):** Active Listening (Mic Open).
     - **Amber (`#FFB300`):** JAYRA Thinking / Speaking.
   - Click to toggle listening state; drag to reposition.
3. **Wake-Word Mode (`wakeword`):**
   - Local on-device detection for "Hey JAYRA", automatically initiating an active session.
4. **Manual Mode (`manual`):**
   - Standard in-app / companion HUD toggle button.

#### Adaptive Uncapped Listening Window (VAD Integration)
- Automatically opens a listening window when JAYRA asks a proactive question or initiates dialogue.
- **CRITICAL - No Fixed Cut-Off:** Integrates Voice Activity Detection (VAD). As long as the user is actively speaking (`isSpeaking: true`), the window remains open indefinitely without cutting off mid-sentence.
- **Natural Silence Grace Period:** When speech pauses, waits 1800ms before concluding the utterance and transitioning to processing or muted.
- **Initial Timeout:** If the user does not respond within 6 seconds, the window safely closes without interrupting their workflow.

#### WebSocket Envelopes (Bidirectional)
- Host ➔ Android / Desktop:
  - `mic_gating_state_changed`: `{ type: "mic_gating_state_changed", state: { mode, micState, indicatorColor, isMuted, adaptiveWindowActive, floatingWidget } }`
  - `adaptive_listening_window_opened`: `{ type: "adaptive_listening_window_opened", reason, timestamp }`
  - `adaptive_listening_window_closed`: `{ type: "adaptive_listening_window_closed", reason, durationMs, timestamp }`
- Android ➔ Host:
  - `set_mic_gating_mode`: `{ type: "set_mic_gating_mode", mode: "hotkey" | "widget" | "wakeword" | "manual" }`
  - `vad_report`: `{ type: "vad_report", isSpeaking: boolean, energy?: number }`

#### REST Endpoints
- `POST /api/settings/mic-gating-mode`: Sets gating strategy (`hotkey`, `widget`, `wakeword`, `manual`).
- `GET /api/settings/mic-gating-state`: Queries current mic gating state & indicator color.
- `POST /api/settings/mic-gating-hotkey`: Dispatches hotkey hold/toggle state.
- `POST /api/settings/mic-gating-vad`: Feeds voice activity events.
- `POST /api/settings/mic-gating-widget`: Updates floating widget coordinates & visibility.

---

### 2.12 Cross-Device Notification & WhatsApp Smart Draft Subsystem

Synchronizes notifications seamlessly between Windows Desktop and Android companion deck, eliminating notification noise while assisting Honey with context-aware smart draft replies for messaging.

#### Privacy & Noise Filter
- **Intelligent Whitelist Filtering:** Suppresses games, promotional push ads, cleaner apps, and ambient media player statuses.
- **Priority Scoring:**
  - `high` / `urgent`: WhatsApp, Telegram, Gmail, VS Code, GitHub, Slack, Discord.
  - `normal` / `low`: System notifications, app updates.
- **Deduplication Buffer:** Suppresses identical alerts within a 10-second rolling window.

#### WhatsApp Context-Aware Smart Draft Generation
- Upon ingesting a communication notification (e.g. WhatsApp), JAYRA analyzes sender intent, conversation context, and tone guidelines.
- Generates context-aware replies matching conversation vibe:
  - Deployment & Server queries: *"Haan bas testing complete ho rahi hai, 5-10 minute mein update deta hoon! 🚀"*
  - Meeting & Call availability: *"Haan main online hoon, batao kya scene hai? 📞"*
  - Greetings & casual talk: Sassy/friendly replies in Hinglish, Urdu, or English.
  - Professional inquiries: Concise, polite formal responses.
- **STRICT SAFETY BOUND - SAFE DRAFT ONLY:**
  - **JAYRA NEVER AUTO-SENDS ANY MESSAGE.**
  - Pre-fills the suggested reply into the Android draft input card or desktop HUD.
  - User (Honey) has 100% control to inspect, edit, or manually confirm before sending.
  - Enforces explicit safety flags: `isDraftOnly: true`, `autoSend: false`, `requiresUserConfirmation: true`.

#### Proactive Companion Alerts
- High-priority communication notifications trigger a proactive spoken announcement and floating balloon on the desktop 3D avatar and Android companion HUD:
  - Speech: *"WhatsApp pe Zaid ka message aaya hai: 'Bhai server deploy ho gaya kya?'. Maine ek draft reply tayyar kar diya hai, check kar lo!"*
- Automatically opens an adaptive listening window so Honey can respond by voice: *"Draft bhej do"* or *"Nahi, bolo main kal call karunga"*.

#### WebSocket Envelopes (Bidirectional)
- Host ➔ Android / Desktop:
  - `notification_synced`: `{ type: "notification_synced", notification: SyncedNotification }`
  - `whatsapp_draft_ready`: `{ type: "whatsapp_draft_ready", draft: WhatsAppDraftReply }`
  - `proactive_notification_alert`: `{ type: "proactive_notification_alert", alert: ProactiveNotificationAlert }`
- Android ➔ Host:
  - `notification_posted`: `{ type: "notification_posted", packageName, appName, title, body, timestamp, category }`
  - `whatsapp_draft_confirmed`: `{ type: "whatsapp_draft_confirmed", notificationId }`

#### REST Endpoints
- `GET /api/notifications/active`: Returns all recent active, unread notifications & drafts.
- `POST /api/notifications/ingest`: Manually ingests a notification from desktop or test harness.
- `POST /api/notifications/dismiss`: Dismisses a notification by ID.
- `POST /api/whatsapp/generate-draft`: On-demand smart draft reply generation for arbitrary messages.
- `POST /api/whatsapp/update-draft`: Updates draft text during user editing.
- `POST /api/whatsapp/confirm-draft`: Marks a draft as confirmed and sent.

---

## 3. Android App Identity & Build Config

### Gradle Configuration (`android/app/build.gradle.kts`)

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "ai.jayra.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.jayra.companion"
        minSdk = 29
        targetSdk = 35
        versionCode = 5
        versionName = "4.5.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    // Security & Biometrics
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.biometric:biometric:1.2.0-alpha05")

    // Networking & WebSockets
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")

    // Camera & QR Scanner
    implementation("androidx.camera:camera-camera2:1.4.0")
    implementation("androidx.camera:camera-lifecycle:1.4.0")
    implementation("androidx.camera:camera-view:1.4.0")
    implementation("com.google.zxing:core:3.5.3")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
```

---

## 4. Design System & Cyberpunk Tokens

| Token Name | Hex Value | Semantic Purpose |
|---|---|---|
| `JayraOledBlack` | `#05080E` | Root container background; pure black. |
| `JayraNavySurface` | `#0B1118` | Main navigation surface, header container. |
| `JayraCardSurface` | `#101924` | Glassmorphism card fill, interactive chips. |
| `JayraElevatedCard` | `#162332` | High-priority elevated cards, modals. |
| `JayraCyanPrimary` | `#00F0FF` | Signature holographic cyan; primary accents. |
| `JayraCyanGlow` | `#3300F0FF` | Ambient 20% alpha glow for laser outlines. |
| `JayraEmeraldSuccess` | `#00E676` | Connected status badge, biometric authorization check. |
| `JayraAmberWarning` | `#FFB300` | Reconnecting status, high latency, file upload pending. |
| `JayraCrimsonDanger` | `#FF1744` | 1-tap emergency stop button, critical auth prompt. |
| `TextWhitePrimary` | `#F0F4F8` | Primary typography; high legibility crisp off-white. |
| `TextCyanSecondary` | `#A5E6F0` | Secondary typography; subtle holographic tint. |
| `TextMuted` | `#6B8299` | Tertiary labels, helper texts. |

---

## 5. Networking: LAN Discovery, Pairing & Authentication

### 5.1 UDP Multicast LAN Discovery
- **Multicast Group:** `239.255.42.99`
- **Multicast Port:** `45842`
- **Protocol Version:** `1`
- Phone sends: `{"type":"jayra_discover","protocolVersion":1,"nonce":"<uuid>"}`
- PC responds: `{"type":"jayra_host","protocolVersion":1,"nonce":"<same uuid>","hostId":"<id>","addresses":["192.168.1.105"],"port":3000,"secure":false}`
- Discovery responses contain no pairing credentials. The phone must pair using the displayed QR/code before opening the authenticated `/mobile-bridge` socket.

### 5.2 QR Code & Code Exchange
- `GET /api/mobile/connect-info` returns the 8-digit code and a QR encoding `jayra://pair?host=<LAN-IP>&port=3000&code=<8-digit-code>`.
- The Android app registers the `jayra://pair` deep link; scanning it opens the companion app rather than a browser. The app posts `{"code":"84920153"}` to `http://<LAN-IP>:3000/api/mobile/pair`.
- The host exchanges the code for a `bridgeToken`. The Android app encrypts that token in app-private storage with an AES-GCM key held in Android Keystore and reuses it on reconnect.
- The app authenticates `/mobile-bridge` with the `X-JAYRA-Token` header. The desktop does not include the bearer token in the QR payload.

---

## 6. REST API Reference (Host Gateway)

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/mobile/connect-info` | GET | Loopback | Returns the `jayra://pair` QR payload, LAN bridge URLs, and 8-digit code. |
| `/api/mobile/pair` | POST | Private LAN | Exchanges `{"code":"<8 digits>"}` for the bridge bearer token. |
| `/api/mobile/bridge-status`| GET | Token | Returns connected client count and telemetry. |
| `/api/mobile/remote-command`| POST | Token | Dispatches a command from host to mobile client. |
| `/api/mobile/upload` | POST | Token | Uploads a file (multipart or JSON base64) to PC. |
| `/api/mobile/download/:file`| GET | Token | Downloads a file from host transfer directory. |
| `/api/mobile/files` | GET | Token | Lists all transferred files with sizes/timestamps. |
| `/api/mobile/audio-routing` | GET/POST | Token | Queries or sets audio routing (`DESKTOP_ONLY`, `PHONE_ONLY`, `BOTH`). |
| `/api/mobile/clipboard` | GET/POST | Token | Queries or syncs shared clipboard text. |
| `/api/mobile/session-handover`| GET/POST | Token | Triggers or queries session continuity snapshot. |
| `/api/mobile/authorize-action`| POST | Token | Initiates biometric/PIN authorization challenge. |
| `/api/mobile/authorize-response`| POST | Token | Resolves pending authorization challenge. |

---

## 7. WebSocket Bridge Protocol & Complete Command Catalog

### 7.1 Complete Command Catalog (Host ➔ Phone)

| Action | Payload Arguments | Behavior |
|---|---|---|
| `LAUNCH_APP` | `{ packageName, appName, uri }` | Launches target app or deep link. |
| `LIST_INSTALLED_APPS` | `{}` | Enumerates installed launcher apps. |
| `TRIGGER_NOTIFICATION` | `{ title, body, priority }` | Posts system notification. |
| `TRIGGER_RINGTONE_FINDER` | `{ mode, durationSec }` | Overrides silent mode to ring phone. |
| `QUERY_PHONE_STATUS` | `{}` | Returns battery, storage, and Wi-Fi stats. |
| `MEDIA_CONTROL` | `{ operation: "play"|"pause"|"toggle" }` | Controls media playback. |
| `ACCESSIBILITY_ACTION` | `{ actionType: "CLICK"|..., target }` | Performs accessibility tap/scroll. |
| `INSPECT_SCREEN_HIERARCHY` | `{ maxDepth: 8 }` | Dumps active window UI accessibility tree. |
| `FILE_TRANSFER_START` | `{ transferId, filename, fileSize, mimeType }` | Prepares phone to receive file chunks. |
| `FILE_TRANSFER_CHUNK` | `{ transferId, chunkIndex, totalChunks, dataBase64 }` | Delivers 64KB base64 file chunk. |
| `FILE_TRANSFER_COMPLETE` | `{ transferId, success, savedPath }` | Confirms file assembly on storage. |
| `SET_AUDIO_ROUTING` | `{ mode: "DESKTOP_ONLY"|"PHONE_ONLY"|"BOTH" }` | Updates client audio routing mode. |
| `CLIPBOARD_SYNC` | `{ text, timestamp, source: "pc" }` | Syncs text copied on PC to phone clipboard. |
| `SESSION_HANDOVER` | `{ session }` | Streams active ReAct task context to deck. |
| `REQUEST_AUTHORIZATION` | `{ authId, riskLevel, actionDescription, commandSnippet, timeoutMs }` | Displays biometric/PIN authorization prompt. |

### 7.2 Phone ➔ Host Commands & Events

| Message Type | Payload Structure | Behavior |
|---|---|---|
| `user_input` | `{ text: "..." }` | Voice/text prompt to Gemini Live engine. |
| `trigger_task` | `{ task: "..." }` | Starts multi-step autonomous ReAct execution. |
| `emergency_stop` | `{}` | 1-Tap emergency abort halting all PC actions. |
| `request_screenshot` | `{}` | Captures PC screen and returns thumbnail. |
| `pc_media_control` | `{ operation: "toggle" }` | Controls PC media playback. |
| `mic_audio_frame` | `{ audio: "<base64>", sampleRate: 16000 }` | Streams live 16kHz PCM audio from phone mic. |
| `clipboard_sync` | `{ text: "...", source: "phone" }` | Syncs phone copied text to PC clipboard. |
| `authorization_response` | `{ authId, approved: bool, method, reason }` | Confirms biometric approval for dangerous task. |
| `set_audio_routing` | `{ mode: "PHONE_ONLY" }` | Toggles speaker routing on the fly. |

---

## 8. Character State Sync & 3D Holographic Avatar

Mirrored directly from PC over `ws://<HOST_IP>:3000/live`:
```json
{
  "type": "character_state",
  "state": "speaking",
  "emotion": "happy",
  "audioLevel": 0.65
}
```
- **Canvas Visualizer:** Hardware-accelerated Jetpack Compose Canvas featuring pulsing radial core, 3 concentric counter-rotating energy rings, and FFT volume-reactive outer distortion.

---

## 9. ReAct Autonomous Task Streaming & Emergency Stop

Streams real-time cognitive reasoning steps to the **Tasks Tab**:
```json
{
  "type": "react_step",
  "stage": "EXECUTING",
  "stepNumber": 2,
  "totalSteps": 4,
  "thought": "Downloading deployment artifact...",
  "tool": "playwright_click",
  "output": "Download started."
}
```
- **Emergency Stop Button:** Red prominent button sending `{"type": "emergency_stop"}` which immediately unhooks Playwright, terminates terminal child processes, and resets the PC agent state to `IDLE`.

---

## 10. FluidTextStreamingBuffer Engine

- FIFO character queue emitting characters at natural typing cadence (18–35ms).
- Dynamic micro-pauses for punctuation marks (`.`, `!`, `?`).
- Prevents UI frame drops and provides an authentic JARVIS typewriter effect.

---

## 11. Android Source Architecture (Package Layout)

```
ai.jayra.companion/
├── JayraApplication.kt
├── MainActivity.kt
│
├── model/
│   ├── BridgeModels.kt                  # Envelopes: Auth, Transfer, Routing, Character
│   └── AppPermission.kt
│
├── net/
│   ├── JayraBridgeClient.kt             # OkHttp WebSocket client (/live & /mobile-bridge)
│   ├── FileTransferManager.kt           # Chunked upload/download coordinator
│   ├── LanDiscoveryManager.kt           # UDP Multicast socket discovery
│   └── FluidTextStreamingBuffer.kt      # Typewriter cadence queue
│
├── service/
│   ├── JayraAccessibilityService.kt     # Screen hierarchy & touch gesture dispatcher
│   ├── JayraClipboardListener.kt        # Primary clip change listener
│   ├── BiometricAuthManager.kt          # BiometricPrompt & PIN fallback controller
│   ├── AudioRecordStreamer.kt           # 16kHz PCM microphone stream buffer
│   ├── AppLaunchManager.kt              # PackageManager intent resolver
│   └── DeviceControlManager.kt          # Ringer, volume & haptic controller
│
├── theme/
│   ├── Color.kt                         # Cyberpunk color tokens
│   ├── Theme.kt                         # Material3 Dark Theme
│   └── Type.kt
│
├── ui/
│   ├── MainScreen.kt                    # Scaffold with Bottom Navigation
│   ├── components/
│   │   ├── BottomNavBar.kt              # 4-tab bottom navigation bar
│   │   ├── HolographicAvatar.kt         # 3D Canvas visualizer
│   │   ├── FluidStreamingText.kt        # Typewriter text bubble
│   │   ├── VoiceTextDock.kt             # 16kHz PCM Mic stream & input dock
│   │   ├── BiometricAuthSheet.kt        # Security authorization dialog/sheet
│   │   ├── FileTransferProgress.kt      # Progress bar for active upload/downloads
│   │   └── OnboardingPermissionDialog.kt# First-launch permission wizard
│   └── tabs/
│       ├── HomeTab.kt                   # Avatar, status pill, handover banner, chips
│       ├── ChatTab.kt                   # In-chat streaming & file attachments
│       ├── TasksTab.kt                  # ReAct tracker & Emergency Abort button
│       └── SettingsTab.kt               # Audio routing, clipboard & biometric toggles
│
└── viewmodel/
    ├── CompanionViewModel.kt            # Core state coordinator (Flows for all features)
    └── PermissionViewModel.kt           # Permission checks & onboarding state
```

---

## 12. UI Specification: 4-Tab Bottom Navigation Deck

### 12.1 Home Tab (`HomeTab`) & Handover Card
- **Status Metrics Pill:** Displays host IP, ping latency, and audio routing mode badge (`[DESKTOP]`, `[PHONE]`, or `[DUAL]`).
- **Session Handover Banner:** Appears dynamically when PC is locked/idle. Displays:
  *"Active Task Available: Tap to resume 'Deploy release' on deck"*.
- **Holographic Avatar:** Centerpiece Compose Canvas reacting to real-time speech and thoughts.
- **Quick Action Chips:** PC Telemetry, PC Screenshot, Media Toggle, Send File, Find Phone.
- **Voice & Text Input Dock:** Embedded `AudioRecordStreamer` recording at 16kHz PCM when mic orb is active.

### 12.2 Chat Tab (`ChatTab`) & In-Chat File Transfer
- Auto-scrolling `LazyColumn` with conversation bubbles.
- **Attachment Button:** Opens system photo/file picker; streams file to host via `FileTransferManager.kt` with inline percentage bar.
- Collapsible reasoning snippets showing internal LLM deliberation.

### 12.3 Tasks Tab (`TasksTab`) & Execution Console
- **Prominent Emergency Abort Banner:** Instant kill switch for active PC browser/terminal tasks.
- **Active Task Progress:** Stage pill (`PLANNING`, `EXECUTING`, `VERIFYING`), step counter (e.g. `Step 3/5`), and terminal-style monospace execution log.

### 12.4 Settings Tab (`SettingsTab`) & Audio/Security Toggles
- **Audio Output Routing Selector:** Segmented button or dropdown to switch between:
  - 🖥️ Desktop Only
  - 📱 Phone Only (PCM Stream)
  - 🔊 Dual Playback (Both)
- **Universal Shared Clipboard Switch:** Toggle to enable automatic clipboard synchronization.
- **Biometric Security Guard Switch:** Toggle to enforce biometric/PIN confirmation for all high-risk desktop tasks.
- **Connection Manager:** IP input, Port (`3000`), QR Scanner launcher, and Token status badge.

---

## 13. First-Launch Permission Onboarding Wizard

Sequential modal dialog on first startup:
1. **Microphone:** Required for voice prompts and 16kHz wireless mic streaming.
2. **Notifications:** High-priority task alerts and transfer completion banners.
3. **Camera:** Instant QR code pairing with PC display.
4. **Accessibility Service:** Remote screen inspection and app automation.
- Saves encrypted completion flag (`jayra_onboarding_completed: true`) in KeyStore.

---

## 14. Accessibility Service Specification

- Implemented via `JayraAccessibilityService.kt`.
- Window hierarchy inspection with sensitive field protection (password/PIN fields excluded, text capped at 256 chars).
- Gesture injection for programmatic taps, scrolls, and global navigation keys (Back, Home, Recents).

---

## 15. Dynamic App Launcher & Device Control

- Resolves launchable intents by package name or app title matching.
- Device finder overrides system silent profile to sound the alarm for misplaced phones.

---

## 16. Security, Privacy & Timing Defense

- **Constant-Time Verification:** Bridge tokens are validated using timing-safe comparisons.
- **LAN Isolation:** Requests originating from public IP ranges are rejected.
- **KeyStore Encryption:** All bearer credentials and biometric flags are stored in AES-256 GCM encrypted storage.

---

## 17. Build Validation Checklist

### Backend Bridge Verification
```powershell
npm run test:mobile
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --outfile=dist/server.cjs
```

### Android Client Build & Verification
```powershell
cd android
./gradlew test
./gradlew assembleDebug
```

---

*Master Specification Approved for JAYRA Android Client v4.5.0.*
