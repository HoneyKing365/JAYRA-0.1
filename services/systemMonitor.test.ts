import assert from "node:assert/strict";
import test from "node:test";
import { calculateCpuUsage, calculateNetworkRates } from "./systemMonitor";

test("CPU sampling computes bounded overall and per-core utilization", () => {
  const result = calculateCpuUsage(
    [{ idle: 50, total: 100 }, { idle: 90, total: 100 }],
    [{ idle: 60, total: 200 }, { idle: 110, total: 200 }]
  );
  assert.deepEqual(result.cores, [90, 80]);
  assert.equal(result.usagePercent, 85);
  assert.equal(calculateCpuUsage([], [{ idle: 0, total: 1 }]).usagePercent, 0);
});

test("network bandwidth uses matching interface counter deltas", () => {
  const result = calculateNetworkRates(
    [{ name: "wifi", received: 1000, sent: 500 }],
    [
      { name: "wifi", received: 4000, sent: 2500 },
      { name: "vpn", received: 500, sent: 400 },
    ],
    2
  );
  assert.deepEqual(result, {
    interfaceName: "wifi",
    receiveBytesPerSecond: 1500,
    transmitBytesPerSecond: 1000,
  });
});

test("network bandwidth avoids negative rates after counters reset", () => {
  const result = calculateNetworkRates(
    [{ name: "wifi", received: 1000, sent: 1000 }],
    [{ name: "wifi", received: 10, sent: 20 }],
    1
  );
  assert.equal(result.receiveBytesPerSecond, null);
  assert.equal(result.transmitBytesPerSecond, null);
});
