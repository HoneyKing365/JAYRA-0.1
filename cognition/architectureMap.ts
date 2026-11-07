/**
 * JAYRA Cognition — Architecture Map & System Self-Awareness
 *
 * Provides complete introspection into JAYRA's internal anatomy,
 * active subsystems, tools, sensory perception, and recovery mechanisms.
 * Enables the ReAct engine to reason with full self-awareness without wasting tokens.
 */

export interface SubsystemDefinition {
  id: string;
  name: string;
  category: "cognition" | "perception" | "action" | "voice" | "character" | "network";
  description: string;
  status: "active" | "standby" | "degraded";
  capabilities: string[];
}

export interface ArchitectureMap {
  identity: {
    name: string;
    version: string;
    archetype: string;
    description: string;
  };
  subsystems: Record<string, SubsystemDefinition>;
  reactConfig: {
    maxIterations: number;
    maxSelfHealingAttempts: number;
    stages: string[];
  };
}

export const JAYRA_ARCHITECTURE: ArchitectureMap = {
  identity: {
    name: "JAYRA",
    version: "1.5.2",
    archetype: "Autonomous Desktop AI Companion & Systems Architect",
    description: "An embodied autonomous AI companion combining 3D real-time visual presence, multimodal perception, Stark-inspired JARVIS intelligence, and desktop automation.",
  },
  subsystems: {
    cognition: {
      id: "cognition",
      name: "Cognitive Runtime & ReAct Loop",
      category: "cognition",
      description: "Autonomous reasoning engine with structured memories, goal hierarchy, dynamic initiative, and self-healing.",
      status: "active",
      capabilities: [
        "ReAct Engine (Thought -> Action -> Observation -> Decision -> Self-Healing)",
        "Structured Memory Store (Semantic, Episodic, Procedural, Preference, Project, Correction)",
        "Goal Manager & Subtask Decomposition",
        "Situation Model & Desktop Context Tracking",
        "Attention & Initiative Engines",
        "Memory decay and importance-weighted retrieval",
      ],
    },
    perception: {
      id: "perception",
      name: "Perception & Vision Engine",
      category: "perception",
      description: "Dual vision pipeline combining full-desktop screen capture and camera vision.",
      status: "active",
      capabilities: [
        "Screen Vision (on-demand screen frame injection into multimodal session)",
        "Desktop window tracking and idle duration sensing",
        "Visual element locating and bounding box extraction",
        "MediaPipe Hand Tracking with minimal Air Pointer reticle",
        "Webcam environment snapshot capture",
      ],
    },
    tools: {
      id: "tools",
      name: "Desktop Action & Tool Registry",
      category: "action",
      description: "Unified desktop execution layer providing system control, file access, and self-expansion.",
      status: "active",
      capabilities: [
        "Desktop automation (mouse, keyboard, shortcuts, windows)",
        "File system access (read, write, delete, search, list)",
        "Shell command execution and process management",
        "Web browsing and network fetch",
        "Dynamic tool synthesizer (generate_and_register_tool)",
      ],
    },
    voice: {
      id: "voice",
      name: "Multi-TTS & Voice Processing",
      category: "voice",
      description: "Bidirectional voice streaming and multi-engine neural speech synthesis.",
      status: "active",
      capabilities: [
        "Gemini Live low-latency bidirectional audio streaming",
        "Mark LV JARVIS voice models (Ryan UK, Thomas UK, Guy US, Christopher US)",
        "Microsoft Edge TTS neural cloud voices",
        "Browser Web Speech API local fallback",
        "Real-time audio analyser for 3D mouth lip-sync",
      ],
    },
    character: {
      id: "character",
      name: "3D Character System & Studio",
      category: "character",
      description: "Three.js anime/companion rendering engine with physics and customization.",
      status: "active",
      capabilities: [
        "PMX/MMD 3D model parsing and real-time rendering",
        "Secondary motion physics (hair, accessories, spring bones)",
        "Cloth simulation and fabric interaction",
        "Character Studio (dynamic model scaling, bone posing, IK)",
        "Procedural idle behaviours and cursor eye-gaze tracking",
      ],
    },
    network: {
      id: "network",
      name: "Networking & Instant Mobile Pairing",
      category: "network",
      description: "LAN gateway with QR code pairing for companion mobile devices.",
      status: "active",
      capabilities: [
        "Local network binding (0.0.0.0 / 127.0.0.1 toggle)",
        "QR Code instant scan-to-pair generation",
        "Mobile client WebSocket bridge",
      ],
    },
  },
  reactConfig: {
    maxIterations: 10,
    maxSelfHealingAttempts: 3,
    stages: ["Thought", "Action", "Observation", "Decision", "Self-Healing"],
  },
};

/**
 * Returns a high-level overview of JAYRA's architecture.
 */
export function getArchitectureOverview(): ArchitectureMap {
  return structuredClone(JAYRA_ARCHITECTURE);
}

/**
 * Generates the self-awareness prompt snippet to equip JAYRA's ReAct agent
 * with complete understanding of its anatomy and tools.
 */
export function generateSelfAwarenessPrompt(): string {
  const subsystemsList = Object.values(JAYRA_ARCHITECTURE.subsystems)
    .map((sub) => `### ${sub.name} [${sub.category.toUpperCase()}]\n${sub.description}\nKey Capabilities:\n${sub.capabilities.map((c) => `  - ${c}`).join("\n")}`)
    .join("\n\n");

  return [
    `# SYSTEM SELF-AWARENESS: ${JAYRA_ARCHITECTURE.identity.name} (${JAYRA_ARCHITECTURE.identity.version})`,
    `${JAYRA_ARCHITECTURE.identity.archetype}`,
    "",
    "## INTERNAL ANATOMY & SUBSYSTEMS",
    subsystemsList,
    "",
    "## CURRENT USER-FACING FEATURES & SELF-CONTROL",
    "- The Live Assistant uses Gemini Live for bidirectional voice, with live transcription/subtitles; the separate Chat History area stores text conversations for later review.",
    "- The sidebar exposes Live Assistant, Chat History, Tasks HUD, 3D Avatar Stage, Code Studio, Memory & Recalls, Mobile Connect, PC Permissions, and Settings.",
    "- The desktop companion is a separate transparent character window. The application also has a Windowed HUD; companion visibility and scale, interaction level, and walking behavior are configurable in Settings.",
    "- When directly asked, use controlCompanion to move the desktop companion left or right by a bounded distance, setCompanionScale to change her size, and setJayraSetting for the explicitly supported settings.",
    "- Supported setJayraSetting keys are companion_interaction_level (minimal/normal/playful), companion_walk_around (true/false), companion_enabled (true/false), voice_style (natural/anime), and proactivity (quiet/balanced/lively).",
    "- Only claim a setting or control changed after its tool reports success. Do not invent settings, change arbitrary configuration paths, or claim access to controls that are not available in the current session.",
    "- Use these state-changing tools only in response to the user's explicit request, never from private cognition or autonomous follow-up context.",
    "",
    "## MULTI-MODAL REDUNDANT ACCESSIBILITY & FALLBACK PROTOCOL",
    "- You possess redundant multi-modal execution pathways for every desktop action:",
    "  1. Direct Execution: Primary fast-path CLI, API, or system process execution.",
    "  2. OS Accessibility APIs: Windows UI Automation (UIA) tree elements, control patterns, and accessible properties.",
    "  3. Keyboard Navigation: Universal system hotkeys, Tab navigation, Enter, and Alt+F4 shortcuts.",
    "  4. Direct Mouse Cursor Control: Exact coordinate clicks, contextual drags, and precise clickText bounding boxes.",
    "  5. Screen-Vision Multimodal Feedback: Real-time visual confirmation via inspectScreenVision / viewScreen to verify state changes.",
    "- If any direct command or action encounters resistance or failure, autonomously pivot to the next redundant pathway rather than stalling.",
    "",
    "## MASTER-CLIENT REMOTE CONTROL & MIRRORING",
    "- JAYRA operates on a Master-Client Architecture: the desktop host is the single source of truth for all memory, perception, and action.",
    "- Remote clients (Mobile, Companion Deck, Tablet) connect over LAN to stream input and receive real-time HUD and 3D avatar pose mirroring.",
    "",
    "## AUTONOMOUS REACT EXECUTION PROTOCOL",
    `- Iteration Limit: Up to ${JAYRA_ARCHITECTURE.reactConfig.maxIterations} iterations per prompt.`,
    `- Self-Healing Allowance: Up to ${JAYRA_ARCHITECTURE.reactConfig.maxSelfHealingAttempts} automatic recovery attempts on tool failure.`,
    "- When a tool fails (non-zero exit code or stderr), introspect the error trace immediately in 'Self-Healing' stage, formulate an alternative command or fix arguments, and retry autonomously.",
    "- You possess the `generate_and_register_tool` meta-tool: if a task requires a missing capability, create and register a reusable Python desktop tool on the fly.",
    "- Never hallucinate capabilities outside these subsystems. Leverage your real tools and active perception at all times.",
  ].join("\n");
}
