import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceBriefingManager } from "../runtime/workspaceBriefing";
import type { MyraaRuntime } from "../runtime/myraaRuntime";

test("WorkspaceBriefingManager generates structured briefing", async () => {
  const manager = new WorkspaceBriefingManager();
  const mockRuntime = {
    router: { network: { current: "online" } },
    tasks: {
      active: () => [
        { id: "task-1", goal: "Audit code", state: "running" },
      ],
    },
    speakDiscretionary: () => true,
  } as unknown as MyraaRuntime;

  const briefing = await manager.generateBriefing(mockRuntime);
  assert.ok(briefing.id.startsWith("briefing_"));
  assert.equal(briefing.system.network, "online");
  assert.equal(briefing.tasks.pendingCount, 1);
  assert.equal(briefing.tasks.items[0].goal, "Audit code");
  assert.ok(briefing.system.ramPercent >= 0 && briefing.system.ramPercent <= 100);
  assert.ok(briefing.speechText.length > 10);
  assert.ok(briefing.summaryText.includes("Audit code"));
});

test("WorkspaceBriefingManager triggers startup briefing once", async () => {
  const manager = new WorkspaceBriefingManager();
  let spoken = false;
  const mockRuntime = {
    router: { network: { current: "online" } },
    tasks: { active: () => [] },
    speakDiscretionary: () => {
      spoken = true;
      return true;
    },
  } as unknown as MyraaRuntime;

  const first = await manager.triggerStartupBriefing(mockRuntime);
  assert.ok(first);
  assert.equal(spoken, true);
  assert.equal(manager.latest?.id, first.id);

  // Subsequent call returns cached and does not speak again
  spoken = false;
  const second = await manager.triggerStartupBriefing(mockRuntime);
  assert.equal(second?.id, first.id);
  assert.equal(spoken, false);
});
