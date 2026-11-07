import test from "node:test";
import assert from "node:assert/strict";
import { PhoneBridgeManager, parsePhoneRemoteCommand } from "../mobile/phoneBridge";

class FakeSocket {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
}

test("phone bridge validates allowlisted and bounded commands", () => {
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "LAUNCH_APP", appId: "camera" }),
    { action: "LAUNCH_APP", appId: "camera" },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "MEDIA_CONTROL", operation: "volume", volume: 70 }),
    { action: "MEDIA_CONTROL", operation: "volume", volume: 70 },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "WHATSAPP_DRAFT", phoneNumber: "+14155552671", message: "  Hello!  " }),
    { action: "WHATSAPP_DRAFT", phoneNumber: "+14155552671", message: "Hello!" },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "LAUNCH_APP", packageName: "com.google.android.youtube" }),
    { action: "LAUNCH_APP", packageName: "com.google.android.youtube" },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "LAUNCH_APP", appName: "Instagram", uri: "https://instagram.com" }),
    { action: "LAUNCH_APP", appName: "Instagram", uri: "https://instagram.com" },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "OPEN_DEEP_LINK", uri: "https://www.youtube.com/watch?v=123" }),
    { action: "OPEN_DEEP_LINK", uri: "https://www.youtube.com/watch?v=123" },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "PHONE_SEARCH_AND_PLAY", app: "YouTube", query: "Interstellar soundtrack" }),
    { action: "PHONE_SEARCH_AND_PLAY", app: "youtube", query: "Interstellar soundtrack" },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({
      action: "ACCESSIBILITY_ACTION",
      actionType: "CLICK",
      target: { text: "Search" },
    }),
    {
      action: "ACCESSIBILITY_ACTION",
      actionType: "CLICK",
      target: { text: "Search" },
    },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "INSPECT_SCREEN_HIERARCHY", maxDepth: 5 }),
    { action: "INSPECT_SCREEN_HIERARCHY", maxDepth: 5 },
  );
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "LIST_INSTALLED_APPS" }),
    { action: "LIST_INSTALLED_APPS" },
  );
  assert.throws(() => parsePhoneRemoteCommand({ action: "LAUNCH_APP" }), /Either appId, packageName, appName, or uri/);
  assert.throws(() => parsePhoneRemoteCommand({ action: "WHATSAPP_DRAFT", phoneNumber: "4155552671", message: "Hello" }), /E.164/);
  assert.throws(() => parsePhoneRemoteCommand({ action: "WHATSAPP_DRAFT", phoneNumber: "+14155552671", message: " " }), /1 to 2000/);
  assert.throws(() => parsePhoneRemoteCommand({ action: "WHATSAPP_DRAFT", phoneNumber: "+14155552671", message: "x".repeat(2001) }), /1 to 2000/);
  assert.throws(() => parsePhoneRemoteCommand({ action: "execute_intent", intent: "arbitrary.action" }), /Unsupported phone command/);
  assert.throws(() => parsePhoneRemoteCommand({ action: "MEDIA_CONTROL", operation: "volume", volume: 101 }), /0 to 100/);
  assert.throws(() => parsePhoneRemoteCommand({ action: "TRIGGER_RINGTONE_FINDER", durationSec: 120 }), /5 to 60/);
  assert.throws(() => parsePhoneRemoteCommand({ action: "ACCESSIBILITY_ACTION", actionType: "INVALID" as any }), /Accessibility actionType/);
});

test("phone bridge dispatch waits for the intended phone acknowledgement", async () => {
  const bridge = new PhoneBridgeManager();
  const socket = new FakeSocket();
  const deviceId = bridge.register(socket, { name: "Test phone", platform: "Android" });
  const resultPromise = bridge.dispatch({ action: "QUERY_PHONE_STATUS" }, deviceId);
  const sent = socket.sent[0];

  assert.deepEqual(sent, { type: "command", id: sent.id, command: { action: "QUERY_PHONE_STATUS" } });
  bridge.receive(deviceId, socket, JSON.stringify({
    type: "command_result",
    id: sent.id,
    success: true,
    result: { batteryPercent: 82 },
  }));
  assert.deepEqual(await resultPromise, { success: true, deviceId, result: { batteryPercent: 82 } });
  assert.equal(bridge.status()[0].name, "Test phone");
  bridge.unregister(deviceId, socket);
});

test("phone bridge requires a device selection when multiple phones are connected", async () => {
  const bridge = new PhoneBridgeManager();
  const s1 = new FakeSocket(), s2 = new FakeSocket();
  const id1 = bridge.register(s1, { name: "Phone one" });
  const id2 = bridge.register(s2, { name: "Phone two" });

  await assert.rejects(
    bridge.dispatch({ action: "QUERY_PHONE_STATUS" }),
    /specify deviceId/,
  );
  bridge.unregister(id1, s1);
  bridge.unregister(id2, s2);
});

test("phone bridge bounds accessibility event metadata", () => {
  const bridge = new PhoneBridgeManager();
  const socket = new FakeSocket();
  const deviceId = bridge.register(socket, {});
  bridge.receive(deviceId, socket, JSON.stringify({
    type: "accessibility_event",
    event: "TEXT_CHANGED",
    text: "x".repeat(500),
  }));

  assert.equal(bridge.status()[0].lastAccessibilityEvent?.text?.length, 256);
  bridge.receive(deviceId, socket, JSON.stringify({ type: "accessibility_event", event: "RAW_TREE_DUMP", text: "secret" }));
  assert.equal(bridge.status()[0].lastAccessibilityEvent?.event, "TEXT_CHANGED");
  bridge.unregister(deviceId, socket);
});

test("phone bridge validates and manages advanced connectivity features", async () => {
  assert.deepEqual(
    parsePhoneRemoteCommand({ action: "SET_AUDIO_ROUTING", mode: "PHONE_ONLY" }),
    { action: "SET_AUDIO_ROUTING", mode: "PHONE_ONLY" },
  );
  assert.throws(() => parsePhoneRemoteCommand({ action: "SET_AUDIO_ROUTING", mode: "INVALID" as any }), /Audio routing mode/);

  assert.deepEqual(
    parsePhoneRemoteCommand({
      action: "FILE_TRANSFER_START",
      transferId: "tr_123",
      filename: "photo.png",
      fileSize: 1024,
      direction: "phone_to_pc",
    }),
    {
      action: "FILE_TRANSFER_START",
      transferId: "tr_123",
      filename: "photo.png",
      fileSize: 1024,
      direction: "phone_to_pc",
    },
  );

  assert.deepEqual(
    parsePhoneRemoteCommand({
      action: "REQUEST_AUTHORIZATION",
      authId: "auth_999",
      riskLevel: "CRITICAL",
      actionDescription: "Format drive",
    }),
    {
      action: "REQUEST_AUTHORIZATION",
      authId: "auth_999",
      riskLevel: "CRITICAL",
      actionDescription: "Format drive",
      timeoutMs: 30000,
    },
  );

  const bridge = new PhoneBridgeManager();
  const socket = new FakeSocket();
  const deviceId = bridge.register(socket, { name: "Pixel 9 Pro" });

  // Audio routing
  assert.equal(bridge.getAudioRoutingMode(), "DESKTOP_ONLY");
  bridge.setAudioRoutingMode("PHONE_ONLY");
  assert.equal(bridge.getAudioRoutingMode(), "PHONE_ONLY");

  // Clipboard sync
  bridge.setSharedClipboard("Copied on PC", "pc");
  assert.equal(bridge.getSharedClipboard()?.text, "Copied on PC");

  bridge.receive(deviceId, socket, JSON.stringify({
    type: "clipboard_sync",
    text: "Copied on Android",
  }));
  assert.equal(bridge.getSharedClipboard()?.text, "Copied on Android");
  assert.equal(bridge.getSharedClipboard()?.source, "phone");

  // Authorization resolution
  const authPromise = bridge.requestAuthorization({
    authId: "test_auth_1",
    actionDescription: "Execute dangerous terminal command",
    deviceId,
  });

  bridge.receive(deviceId, socket, JSON.stringify({
    type: "authorization_response",
    authId: "test_auth_1",
    approved: true,
    method: "biometric",
  }));

  const authResult = await authPromise;
  assert.equal(authResult.approved, true);
  assert.equal(authResult.method, "biometric");
  bridge.unregister(deviceId, socket);
});
