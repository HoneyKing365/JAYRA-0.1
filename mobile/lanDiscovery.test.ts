import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMobilePairingUri,
  createLanDiscoveryResponse,
  getOrCreateMobileBridgeToken,
  getOrCreatePairingCode,
} from "./lanDiscovery";

test("native pairing QR uses the Android deep-link schema without embedding the bridge token", () => {
  const uri = new URL(createMobilePairingUri("192.168.1.25", 3000, "84920153"));
  assert.equal(uri.protocol, "jayra:");
  assert.equal(uri.hostname, "pair");
  assert.equal(uri.searchParams.get("host"), "192.168.1.25");
  assert.equal(uri.searchParams.get("port"), "3000");
  assert.equal(uri.searchParams.get("code"), "84920153");
  assert.equal(uri.searchParams.has("token"), false);
  assert.throws(() => createMobilePairingUri("", 3000, "84920153"), /host is required/);
  assert.throws(() => createMobilePairingUri("192.168.1.25", 70_000, "84920153"), /port is invalid/);
  assert.throws(() => createMobilePairingUri("192.168.1.25", 3000, "1234"), /eight digits/);
});

test("mobile bridge token and manual pairing code remain stable across host restarts", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jayra-pairing-"));
  const tokenPath = path.join(directory, "mobile-bridge-token");
  const codePath = path.join(directory, "mobile-pairing-code");
  try {
    const first = getOrCreateMobileBridgeToken(tokenPath);
    const second = getOrCreateMobileBridgeToken(tokenPath);
    const pairingCode = getOrCreatePairingCode(codePath);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(second, first);
    assert.equal(readFileSync(tokenPath, "utf8"), first);
    assert.match(pairingCode, /^\d{8}$/);
    assert.equal(getOrCreatePairingCode(codePath), pairingCode);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("LAN discovery echoes a validated nonce and contains no pairing credentials", () => {
  const nonce = "d7f5eb3a-15f2-4f05-8a9b-bf4181dd0cc1";
  const response = createLanDiscoveryResponse(
    Buffer.from(JSON.stringify({ type: "jayra_discover", protocolVersion: 1, nonce })),
    "host-id",
    ["192.168.1.25", "8.8.8.8", "not-an-ip"],
    3000,
  );
  assert.deepEqual(response, {
    type: "jayra_host",
    protocolVersion: 1,
    nonce,
    hostId: "host-id",
    addresses: ["192.168.1.25"],
    port: 3000,
    secure: false,
  });
  assert.equal("token" in (response || {}), false);
  assert.equal(createLanDiscoveryResponse(Buffer.from("{"), "host-id", [], 3000), null);
  assert.equal(createLanDiscoveryResponse(Buffer.from(JSON.stringify({
    type: "jayra_discover", protocolVersion: 1, nonce: "invalid",
  })), "host-id", [], 3000), null);
});
