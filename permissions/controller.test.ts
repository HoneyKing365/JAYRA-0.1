import assert from "node:assert/strict";
import test from "node:test";
import { ConfirmationBroker } from "./confirmations";
import { CapabilityAuthorizationError, CapabilityController } from "./controller";
import { PermissionEngine } from "./engine";

function createController() {
  const permissions = new PermissionEngine(".", {});
  const confirmations = new ConfirmationBroker();
  const controller = new CapabilityController(permissions, confirmations);
  controller.register({ id: "phone.camera", capability: "ACCESS_CAMERA" });
  controller.register({ id: "phone.notification", capability: "SEND_MESSAGE" });
  controller.register({ id: "api.adapter.call", capability: "NETWORK_API" });
  return { controller, confirmations };
}

test("capability actions are explicit and duplicate registration is rejected", () => {
  const { controller } = createController();
  assert.deepEqual(controller.get("api.adapter.call"), {
    id: "api.adapter.call",
    capability: "NETWORK_API",
  });
  assert.throws(
    () => controller.register({ id: "api.adapter.call", capability: "BROWSE_WEB" }),
    /already registered/,
  );
  assert.throws(() => controller.evaluate("unregistered.action"), /Unknown capability action/);
});

test("denied capabilities never invoke their registered feature handler", async () => {
  const { controller } = createController();
  let invoked = false;
  await assert.rejects(
    controller.execute("phone.camera", {}, () => {
      invoked = true;
      return true;
    }),
    (error: unknown) => error instanceof CapabilityAuthorizationError && error.decision === "deny",
  );
  assert.equal(invoked, false);
});

test("ask decisions require a one-time confirmation before feature execution", async () => {
  const { controller, confirmations } = createController();
  let invoked = false;
  const execution = controller.execute("phone.notification", { detail: "test" }, () => {
    invoked = true;
    return "sent";
  });
  const [pending] = confirmations.list();
  assert.ok(pending);
  assert.equal(pending.capability, "SEND_MESSAGE");
  assert.equal(invoked, false);
  confirmations.resolve(pending.id, { approved: true, via: "ui" });
  assert.equal(await execution, "sent");
  assert.equal(invoked, true);
  assert.equal(confirmations.list().length, 0);
});

test("legacy environment disables are enforced by the same permission engine", () => {
  const permissions = new PermissionEngine(".", { MYRAA_PERMISSION_NETWORK: "off" });
  const verdict = permissions.check("NETWORK_API");
  assert.equal(verdict.decision, "deny");
  assert.match(verdict.reason, /MYRAA_PERMISSION_NETWORK/);
});
