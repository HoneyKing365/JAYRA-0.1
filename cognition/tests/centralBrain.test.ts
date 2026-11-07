import assert from "node:assert/strict";
import test from "node:test";
import { appEvents } from "../../shared/appEvents";
import { CentralBrain } from "../../runtime/centralBrain";
import { loadCognitionConfig } from "../config";
import { ToolExecutor } from "../toolExecutor";
import { ToolRegistry } from "../toolRegistry";

test("Central Brain tracks tool health and routes registered read-only fallbacks", async () => {
  const registry = new ToolRegistry();
  for (const name of ["primaryLookup", "backupLookup"]) {
    registry.register({
      name,
      purpose: "Read a record.",
      permission: "filesystem_read",
      riskLevel: 1,
      timeoutMs: 1_000,
      maxRetries: 0,
    });
  }
  const executor = new ToolExecutor({
    config: loadCognitionConfig({} as NodeJS.ProcessEnv),
    registry,
    handler: async (tool) => tool === "primaryLookup"
      ? { ok: false, error: "Primary store unavailable." }
      : { ok: true, result: { value: "from backup" } },
  });
  const brain = new CentralBrain({
    registry,
    executor,
    dispatchContext: async (event) => event.type,
  });
  brain.registerFallback("primaryLookup", "backupLookup");

  const outcome = await brain.execute("primaryLookup", { id: "record-1" });

  assert.equal(outcome.success, true);
  assert.equal(outcome.tool, "backupLookup");
  assert.equal(outcome.fallbackTool, "backupLookup");
  assert.equal(brain.status().toolCount, 2);
  assert.equal(brain.listTools().find((tool) => tool.name === "primaryLookup")?.failures, 1);
  assert.equal(brain.listTools().find((tool) => tool.name === "backupLookup")?.lastStatus, "succeeded");
});

test("Central Brain refuses fallback routes that broaden permission or risk", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "readOnly",
    purpose: "Read data.",
    permission: "filesystem_read",
    riskLevel: 1,
    timeoutMs: 1_000,
    maxRetries: 0,
  });
  registry.register({
    name: "writeData",
    purpose: "Write data.",
    permission: "filesystem_write",
    riskLevel: 2,
    timeoutMs: 1_000,
    maxRetries: 0,
  });
  const brain = new CentralBrain({
    registry,
    executor: new ToolExecutor({
      config: loadCognitionConfig({} as NodeJS.ProcessEnv),
      registry,
      handler: async () => ({ ok: true }),
    }),
    dispatchContext: async () => undefined,
  });

  assert.throws(() => brain.registerFallback("readOnly", "writeData"), /read-only tools with matching permission scopes/);
});

test("context dispatch failures are diagnosed and rethrown", async () => {
  const registry = new ToolRegistry();
  const executor = new ToolExecutor({
    config: loadCognitionConfig({} as NodeJS.ProcessEnv),
    registry,
    handler: async () => ({ ok: true }),
  });
  const brain = new CentralBrain({
    registry,
    executor,
    dispatchContext: async () => {
      throw new Error("context dispatch failed");
    },
  });
  const events: string[] = [];
  const unsubscribe = appEvents.subscribe((event) => {
    if (event.type === "error.diagnosed") events.push(String((event.payload as { error?: unknown }).error));
  });
  try {
    await assert.rejects(
      brain.dispatchContext({ type: "test.event", source: "system" }),
      /context dispatch failed/,
    );
    assert.deepEqual(events, ["context dispatch failed"]);
  } finally {
    unsubscribe();
  }
});
