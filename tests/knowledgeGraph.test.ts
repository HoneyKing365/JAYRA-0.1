import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PassiveKnowledgeGraph, DailySummaryFlashcard } from "../runtime/passiveKnowledgeGraph";

test("passive knowledge graph initializes and sanitizes sensitive credentials", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-kg-test-"));
  try {
    const kg = new PassiveKnowledgeGraph(tmpDir);
    await kg.initialize();

    // Ingest activity with a sensitive key
    const rawTarget = "https://api.openai.com/v1?token=sk-1234567890abcdef1234567890";
    const entry = await kg.recordActivity("doc_visit", rawTarget, {
      project: "AI Engine",
      details: { title: "Documentation sk-abcdef1234567890abcdef12" },
    });

    assert.ok(!entry.target.includes("sk-1234567890abcdef"));
    assert.ok(entry.target.includes("[REDACTED_API_KEY]"));
    assert.equal(entry.project, "AI Engine");

    const graph = kg.getGraphData();
    assert.ok(graph.nodes.length >= 2); // Project node + Doc node
    assert.ok(graph.edges.length >= 1);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("passive knowledge graph synthesizes clean daily summary flashcards with project breakdown and to-dos", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jayra-kg-test-"));
  try {
    const kg = new PassiveKnowledgeGraph(tmpDir);
    await kg.initialize();

    let capturedCard: DailySummaryFlashcard | null = null;
    kg.onSummaryGenerated((card) => {
      capturedCard = card;
    });

    // Record mock activities on a specific test date: 2026-10-27
    const baseTime = Date.parse("2026-10-27T10:00:00Z");

    // 1. Worked on server.ts (30 mins = 1800s)
    await kg.recordActivity("file_edit", "src/server.ts", {
      project: "JAYRA Host",
      durationSeconds: 1800,
      timestamp: baseTime,
    });

    // 2. Worked on phoneBridge.ts (45 mins = 2700s)
    await kg.recordActivity("file_edit", "mobile/phoneBridge.ts", {
      project: "Mobile Bridge",
      durationSeconds: 2700,
      timestamp: baseTime + 10000,
    });

    // 3. Looked at reference docs
    await kg.recordActivity("doc_visit", "https://developer.android.com/reference/audio", {
      project: "Mobile Bridge",
      details: { title: "Android AudioTrack Guide" },
      timestamp: baseTime + 20000,
    });

    // 4. Asked question to JAYRA
    await kg.recordActivity("user_query", "How do we route 16kHz PCM audio over WebSocket?", {
      project: "JAYRA Host",
      timestamp: baseTime + 30000,
    });

    // 5. Run test command
    await kg.recordActivity("command_run", "npm run test:mobile", {
      project: "Mobile Bridge",
      timestamp: baseTime + 40000,
    });

    // Generate flashcard for 2026-10-27
    const flashcard = await kg.generateDailySummary("2026-10-27", baseTime + 50000);

    assert.ok(flashcard.cardId.startsWith("fc_20261027"));
    assert.equal(flashcard.date, "2026-10-27");
    assert.equal(flashcard.totalActivities, 5);
    assert.ok(flashcard.focusMinutes >= 75); // 30m + 45m + defaults
    assert.ok(flashcard.projectBreakdown.length >= 2);
    assert.ok(flashcard.topFiles.includes("phoneBridge.ts"));
    assert.ok(flashcard.keyReferences.some((r) => r.url.includes("android.com")));
    assert.ok(flashcard.recommendedTodos.length > 0);
    assert.ok(flashcard.sassySummary.hinglish.length > 10);
    assert.ok(flashcard.sassySummary.romanUrdu && flashcard.sassySummary.romanUrdu.length > 10);
    assert.ok(flashcard.sassySummary.romanHindi && flashcard.sassySummary.romanHindi.length > 10);
    assert.ok(flashcard.markdownCard.includes("JAYRA Daily Pulse"));
    assert.equal(capturedCard, flashcard);

    // Verify language-specific generation with Roman Urdu
    const urduCard = await kg.generateDailySummary("2026-10-27", baseTime + 50000, { languagePreference: "roman_urdu" });
    assert.ok(urduCard.markdownCard.includes(urduCard.sassySummary.romanUrdu || ""));

    // Verify stored summary retrieval
    const retrieved = kg.getDailySummary("2026-10-27");
    assert.equal(retrieved?.cardId, urduCard.cardId);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

