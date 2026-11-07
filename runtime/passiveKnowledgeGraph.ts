import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "../shared/jsonFile";

export type ActivityType = "file_edit" | "file_open" | "doc_visit" | "user_query" | "command_run";

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  timestamp: number;
  project?: string;
  target: string; // file path, URL, query, or command
  details?: Record<string, unknown>;
  durationSeconds?: number;
}

export interface GraphNode {
  id: string;
  type: "project" | "file" | "doc" | "query" | "topic";
  label: string;
  properties: Record<string, unknown>;
  createdAt: number;
  lastActiveAt: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: "contains" | "references" | "queried_in" | "tagged_with";
  weight: number;
  lastObservedAt: number;
}

export interface ProjectTimeBreakdown {
  project: string;
  durationMinutes: number;
  activitiesCount: number;
}

export interface DailySummaryFlashcard {
  cardId: string;
  date: string; // YYYY-MM-DD
  title: string;
  totalActivities: number;
  focusMinutes: number;
  focusHours: number;
  productivityScore: number;
  vibeBaseline: string;
  projectBreakdown: ProjectTimeBreakdown[];
  topFiles: string[];
  keyReferences: Array<{ title?: string; url: string }>;
  recentQueries: string[];
  recommendedTodos: string[];
  sassySummary: {
    urdu: string;
    hinglish: string;
    english: string;
    romanUrdu?: string;
    romanHindi?: string;
  };
  markdownCard: string;
  generatedAt: number;
}

export interface KnowledgeGraphStorage {
  activities: ActivityEntry[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  summaries: Record<string, DailySummaryFlashcard>;
}

const SASSY_SUMMARIES = [
  {
    urdu: "آج کا حساب کتاب تیار ہے! اتنے گھنٹے کوڈنگ میں جان ماری ہے، کل کے لیے ٹاسک لسٹ پہلے ہی بنا دی ہے۔ اب آرام سے سو جاؤ!",
    hinglish: "Aaj ka hisaab-kitab tayyar hai! 3 ghante code kiya aur bug dhundne mein dimag khapaya... kal ke to-do tayyar hain, shukriya kehne ki zaroorat nahi!",
    english: "Daily developer pulse compiled. You crushed key milestones today; I've structured tomorrow's to-do list so you hit the ground running.",
    romanUrdu: "Aaj ka hisaab kitaab tayyar hai! Itne ghante coding mein jaan maari hai, kal ke liye task list pehle hi bana di hai. Ab araam se so jao!",
    romanHindi: "Aaj ka hisaab-kitaab ready hai! Din bhar code kiya aur bugs solve kiye... kal ke to-dos bhi set hain, thanks kehne ki zaroorat nahi!"
  },
  {
    urdu: "دن بھر کی محنت کا نچوڑ آپ کے ڈیک پر موجود ہے۔ کل کا آغاز تیار شدہ اہداف سے کیجیے گا!",
    hinglish: "Full day dev logs analyze ho chuke hain. Summary flashcard phone aur desktop pe deliver kar di gayi hai!",
    english: "Activity synthesized into your personal knowledge flashcard. Priorities queued for tomorrow.",
    romanUrdu: "Din bhar ki mehnat ka nichor aapke deck par mojood hai. Kal ka aaghaz tayyar shuda ahdaf se kijiyega!",
    romanHindi: "Pura din dev logs analyze ho chuke hain. Aaj ke major milestones compile karke kal ke goals ready hain!"
  },
  {
    urdu: "شاباش! آج کمال کی رفتار رہی۔ کوڈ کا بڑا حصہ نبٹ گیا ہے۔",
    hinglish: "Shabash! Aaj kamaal ki speed rahi. Code ka bada hissa nipat gaya hai, ab thoda break lo!",
    english: "Great momentum today! Substantial code milestones cleared. Time to recharge.",
    romanUrdu: "Shabash! Aaj kamaal ki speed rahi. Code ka bara hissa nibat gaya hai, ab thora break le lo!",
    romanHindi: "Shabash! Aaj kamaal ki speed rahi. Code ka bada hissa complete ho chuka hai, ab thoda break lo!"
  }
];

export class PassiveKnowledgeGraph {
  private readonly storagePath: string;
  private memory: KnowledgeGraphStorage = {
    activities: [],
    nodes: [],
    edges: [],
    summaries: {},
  };
  private isLoaded = false;
  private onSummaryGeneratedListener?: (card: DailySummaryFlashcard) => void;

  constructor(dataDir: string) {
    this.storagePath = path.join(dataDir, "knowledge_graph", "second_brain.v1.json");
  }

  async initialize(): Promise<void> {
    if (this.isLoaded) return;
    this.memory = await readJsonFile<KnowledgeGraphStorage>(this.storagePath, {
      activities: [],
      nodes: [],
      edges: [],
      summaries: {},
    });
    this.isLoaded = true;
  }

  onSummaryGenerated(listener: (card: DailySummaryFlashcard) => void): void {
    this.onSummaryGeneratedListener = listener;
  }

  async recordActivity(
    type: ActivityType,
    target: string,
    options?: {
      project?: string;
      durationSeconds?: number;
      details?: Record<string, unknown>;
      timestamp?: number;
    },
  ): Promise<ActivityEntry> {
    await this.initialize();

    const sanitizedTarget = this.sanitizeSensitiveData(target);
    const timestamp = options?.timestamp ?? Date.now();
    const project = options?.project || this.inferProjectName(sanitizedTarget);

    const entry: ActivityEntry = {
      id: randomUUID(),
      type,
      timestamp,
      project,
      target: sanitizedTarget,
      details: options?.details ? this.sanitizeDetails(options.details) : undefined,
      durationSeconds: options?.durationSeconds || 60,
    };

    this.memory.activities.push(entry);

    // Limit activities to last 5,000 in storage to keep file footprint bounded
    if (this.memory.activities.length > 5000) {
      this.memory.activities.splice(0, this.memory.activities.length - 5000);
    }

    this.updateGraph(entry);
    await this.save();

    return entry;
  }

  async generateDailySummary(
    targetDate?: string,
    simulatedNow?: number,
    options?: { languagePreference?: string },
  ): Promise<DailySummaryFlashcard> {
    await this.initialize();

    const now = simulatedNow ?? Date.now();
    const dateStr = targetDate || new Date(now).toISOString().split("T")[0];

    // Filter activities for target date (in local date string)
    const dayActivities = this.memory.activities.filter((act) => {
      const actDate = new Date(act.timestamp).toISOString().split("T")[0];
      return actDate === dateStr;
    });

    // 1. Calculate project time breakdown
    const projectMap = new Map<string, { durationSec: number; count: number }>();
    let totalSeconds = 0;

    for (const act of dayActivities) {
      const proj = act.project || "General";
      const dur = act.durationSeconds || 60;
      totalSeconds += dur;

      const current = projectMap.get(proj) || { durationSec: 0, count: 0 };
      current.durationSec += dur;
      current.count += 1;
      projectMap.set(proj, current);
    }

    const projectBreakdown: ProjectTimeBreakdown[] = Array.from(projectMap.entries()).map(([project, data]) => ({
      project,
      durationMinutes: Math.round(data.durationSec / 60),
      activitiesCount: data.count,
    })).sort((a, b) => b.durationMinutes - a.durationMinutes);

    // 2. Identify top files
    const fileCounts = new Map<string, number>();
    for (const act of dayActivities) {
      if (act.type === "file_edit" || act.type === "file_open") {
        const name = path.basename(act.target);
        fileCounts.set(name, (fileCounts.get(name) || 0) + 1);
      }
    }
    const topFiles = Array.from(fileCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f);

    // 3. Key references
    const keyReferences: Array<{ title?: string; url: string }> = [];
    const seenUrls = new Set<string>();
    for (const act of dayActivities) {
      if (act.type === "doc_visit" && !seenUrls.has(act.target)) {
        seenUrls.add(act.target);
        keyReferences.push({
          url: act.target,
          title: typeof act.details?.title === "string" ? act.details.title : undefined,
        });
        if (keyReferences.length >= 5) break;
      }
    }

    // 4. Recent queries
    const recentQueries: string[] = dayActivities
      .filter((act) => act.type === "user_query")
      .map((act) => act.target)
      .slice(-5);

    // 5. Automated dynamic recommendations for tomorrow
    const recommendedTodos: string[] = [];
    if (topFiles.length > 0) {
      recommendedTodos.push(`Review and write tests for ${topFiles[0]}`);
    }
    if (dayActivities.some((act) => act.type === "command_run" && String(act.target).includes("test"))) {
      recommendedTodos.push("Verify full test suite regression coverage");
    }
    if (recentQueries.length > 0) {
      recommendedTodos.push(`Follow up on architectural research: "${recentQueries[0].slice(0, 45)}..."`);
    }
    if (recommendedTodos.length === 0) {
      recommendedTodos.push("Continue workspace feature roadmap implementation");
      recommendedTodos.push("Audit background worker telemetry and connection latency");
    }

    const focusMinutes = Math.max(1, Math.round(totalSeconds / 60));
    const focusHours = Number((focusMinutes / 60).toFixed(1));
    const productivityScore = Math.min(100, Math.max(25, Math.round((focusMinutes / 240) * 70 + (dayActivities.length / 15) * 30)));
    const vibeBaseline = focusHours >= 3 ? "DEEP_FOCUS" : focusHours >= 1 ? "CREATIVE_FLOW" : "STEADY_VELOCITY";

    const sassyIndex = Math.floor(Math.random() * SASSY_SUMMARIES.length);
    const sassySummary = SASSY_SUMMARIES[sassyIndex];

    const preferredQuote = options?.languagePreference === "roman_urdu"
      ? (sassySummary.romanUrdu || sassySummary.hinglish)
      : options?.languagePreference === "roman_hindi"
      ? (sassySummary.romanHindi || sassySummary.hinglish)
      : options?.languagePreference === "en"
      ? sassySummary.english
      : sassySummary.hinglish;

    const markdownCard = [
      `### ⚡ JAYRA Daily Pulse — ${dateStr}`,
      `> *"${preferredQuote}"*`,
      ``,
      `⏱ **Focus Time:** ${focusHours} hrs (${focusMinutes} mins) across ${dayActivities.length} activities`,
      ``,
      `📂 **Project Focus:**`,
      ...projectBreakdown.map((p) => `- **${p.project}**: ${p.durationMinutes} mins (${p.activitiesCount} events)`),
      ``,
      topFiles.length > 0 ? `📝 **Key Files:** ${topFiles.map((f) => `\`${f}\``).join(", ")}` : "",
      keyReferences.length > 0 ? `🔗 **References:**\n${keyReferences.map((r) => `- [${r.title || r.url}](${r.url})`).join("\n")}` : "",
      ``,
      `🎯 **Recommended Next Steps (Tomorrow):**`,
      ...recommendedTodos.map((t) => `- [ ] ${t}`),
    ].filter(Boolean).join("\n");

    const flashcard: DailySummaryFlashcard = {
      cardId: `fc_${dateStr.replace(/-/g, "")}_${randomUUID().slice(0, 6)}`,
      date: dateStr,
      title: `Daily Dev Pulse: ${dateStr}`,
      totalActivities: dayActivities.length,
      focusMinutes,
      focusHours,
      productivityScore,
      vibeBaseline,
      projectBreakdown,
      topFiles,
      keyReferences,
      recentQueries,
      recommendedTodos,
      sassySummary,
      markdownCard,
      generatedAt: now,
    };

    this.memory.summaries[dateStr] = flashcard;
    await this.save();

    this.onSummaryGeneratedListener?.(flashcard);
    return flashcard;
  }

  getDailySummary(dateStr?: string): DailySummaryFlashcard | null {
    const key = dateStr || new Date().toISOString().split("T")[0];
    return this.memory.summaries[key] || null;
  }

  getRecentSummaries(limit = 7): DailySummaryFlashcard[] {
    return Object.values(this.memory.summaries)
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .slice(0, limit);
  }

  getGraphData(): { nodesCount: number; edgesCount: number; activitiesCount: number; nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodesCount: this.memory.nodes.length,
      edgesCount: this.memory.edges.length,
      activitiesCount: this.memory.activities.length,
      nodes: [...this.memory.nodes],
      edges: [...this.memory.edges],
    };
  }

  private updateGraph(entry: ActivityEntry): void {
    const now = entry.timestamp;

    // 1. Ensure project node exists
    const projName = entry.project || "General";
    const projNodeId = `proj_${projName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
    let projNode = this.memory.nodes.find((n) => n.id === projNodeId);
    if (!projNode) {
      projNode = {
        id: projNodeId,
        type: "project",
        label: projName,
        properties: { totalActivities: 1 },
        createdAt: now,
        lastActiveAt: now,
      };
      this.memory.nodes.push(projNode);
    } else {
      projNode.lastActiveAt = now;
      projNode.properties.totalActivities = Number(projNode.properties.totalActivities || 0) + 1;
    }

    // 2. Add entity node based on type
    if (entry.type === "file_edit" || entry.type === "file_open") {
      const fileId = `file_${entry.target.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 100);
      let fileNode = this.memory.nodes.find((n) => n.id === fileId);
      if (!fileNode) {
        fileNode = {
          id: fileId,
          type: "file",
          label: path.basename(entry.target),
          properties: { path: entry.target, touches: 1 },
          createdAt: now,
          lastActiveAt: now,
        };
        this.memory.nodes.push(fileNode);
      } else {
        fileNode.lastActiveAt = now;
        fileNode.properties.touches = Number(fileNode.properties.touches || 0) + 1;
      }
      this.addEdge(projNodeId, fileNode.id, "contains", now);
    } else if (entry.type === "doc_visit") {
      const docId = `doc_${entry.target.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 100);
      let docNode = this.memory.nodes.find((n) => n.id === docId);
      if (!docNode) {
        docNode = {
          id: docId,
          type: "doc",
          label: entry.target,
          properties: { visits: 1, ...(entry.details || {}) },
          createdAt: now,
          lastActiveAt: now,
        };
        this.memory.nodes.push(docNode);
      } else {
        docNode.lastActiveAt = now;
        docNode.properties.visits = Number(docNode.properties.visits || 0) + 1;
      }
      this.addEdge(projNodeId, docNode.id, "references", now);
    } else if (entry.type === "user_query") {
      const queryId = `query_${entry.id.slice(0, 8)}`;
      const queryNode: GraphNode = {
        id: queryId,
        type: "query",
        label: entry.target.slice(0, 60),
        properties: { query: entry.target },
        createdAt: now,
        lastActiveAt: now,
      };
      this.memory.nodes.push(queryNode);
      this.addEdge(projNodeId, queryNode.id, "queried_in", now);
    }

    // Bound total nodes to 2000
    if (this.memory.nodes.length > 2000) {
      this.memory.nodes.splice(0, this.memory.nodes.length - 2000);
    }
  }

  private addEdge(source: string, target: string, relation: GraphEdge["relation"], now: number): void {
    const existing = this.memory.edges.find((e) => e.source === source && e.target === target && e.relation === relation);
    if (existing) {
      existing.weight += 1;
      existing.lastObservedAt = now;
    } else {
      this.memory.edges.push({
        id: randomUUID(),
        source,
        target,
        relation,
        weight: 1,
        lastObservedAt: now,
      });
      if (this.memory.edges.length > 3000) {
        this.memory.edges.shift();
      }
    }
  }

  private sanitizeSensitiveData(input: string): string {
    if (!input || typeof input !== "string") return "";
    return input
      .replace(/(?:sk-[a-zA-Z0-9_-]{20,})/gi, "[REDACTED_API_KEY]")
      .replace(/(?:ghp_[a-zA-Z0-9]{30,})/gi, "[REDACTED_GITHUB_TOKEN]")
      .replace(/(?:Bearer\s+[a-zA-Z0-9._-]{20,})/gi, "Bearer [REDACTED_TOKEN]")
      .replace(/(?:password[:=]\s*[^\s&]+)/gi, "password=[REDACTED]");
  }

  private sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(details)) {
      if (typeof v === "string") {
        cleaned[k] = this.sanitizeSensitiveData(v);
      } else if (typeof v === "number" || typeof v === "boolean") {
        cleaned[k] = v;
      }
    }
    return cleaned;
  }

  private inferProjectName(filepathOrTarget: string): string {
    const normalized = filepathOrTarget.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length >= 2) {
      return segments[segments.length - 2] || "JAYRA Host";
    }
    return "JAYRA Host";
  }

  private async save(): Promise<void> {
    try {
      await writeJsonFile(this.storagePath, this.memory);
    } catch (err) {
      console.warn("[PassiveKnowledgeGraph] Save error:", err);
    }
  }
}

