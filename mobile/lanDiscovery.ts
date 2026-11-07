import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import path from "node:path";

export const LAN_DISCOVERY_GROUP = "239.255.42.99";
export const LAN_DISCOVERY_PORT = 45_842;

export interface LanHostDiscovery {
  type: "jayra_host";
  protocolVersion: 1;
  nonce: string;
  hostId: string;
  addresses: string[];
  port: number;
  secure: false;
}

export function createMobilePairingUri(host: string, port: number, pairingCode: string): string {
  if (!host.trim()) throw new Error("A host is required for JAYRA mobile pairing.");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("The JAYRA mobile pairing port is invalid.");
  }
  if (!/^\d{8}$/.test(pairingCode)) {
    throw new Error("The JAYRA mobile pairing code must contain eight digits.");
  }

  const uri = new URL("jayra://pair");
  uri.searchParams.set("host", host.trim());
  uri.searchParams.set("port", String(port));
  uri.searchParams.set("code", pairingCode);
  return uri.toString();
}

export function getOrCreateMobileBridgeToken(filePath: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const readToken = (): string => {
    const token = readFileSync(filePath, "utf8").trim();
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      throw new Error("The persisted JAYRA mobile bridge token is invalid.");
    }
    return token;
  };

  try {
    return readToken();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const token = randomBytes(32).toString("hex");
  try {
    writeFileSync(filePath, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readToken();
    throw error;
  }
}

export function getOrCreatePairingCode(filePath: string): string {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const readCode = (): string => {
    const code = readFileSync(filePath, "utf8").trim();
    if (!/^\d{8}$/.test(code)) throw new Error("The persisted JAYRA manual pairing code is invalid.");
    return code;
  };

  try {
    return readCode();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const code = randomInt(0, 100_000_000).toString().padStart(8, "0");
  try {
    writeFileSync(filePath, code, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return code;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return readCode();
    throw error;
  }
}

export function createLanDiscoveryResponse(
  rawMessage: Buffer,
  hostId: string,
  addresses: string[],
  port: number,
): LanHostDiscovery | null {
  if (rawMessage.length > 1_024) return null;

  let request: unknown;
  try {
    request = JSON.parse(rawMessage.toString("utf8"));
  } catch {
    return null;
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;

  const value = request as Record<string, unknown>;
  if (
    value.type !== "jayra_discover"
    || value.protocolVersion !== 1
    || typeof value.nonce !== "string"
    || !/^[\da-f]{8}-([\da-f]{4}-){3}[\da-f]{12}$/i.test(value.nonce)
  ) {
    return null;
  }

  return {
    type: "jayra_host",
    protocolVersion: 1,
    nonce: value.nonce,
    hostId,
    addresses: addresses.filter(isPrivateLanAddress),
    port,
    secure: false,
  };
}

function isPrivateLanAddress(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 10
    || first === 192 && second === 168
    || first === 172 && second >= 16 && second <= 31;
}

export function startLanDiscoveryResponder(options: {
  port: number;
  isEnabled: () => boolean;
  addresses: () => string[];
  onError: (error: Error) => void;
}): { close: () => void } {
  const socket: Socket = createSocket({ type: "udp4", reuseAddr: true });
  const hostId = randomUUID();

  socket.on("error", options.onError);
  socket.on("message", (message: Buffer, remote: RemoteInfo) => {
    if (!options.isEnabled() || !isPrivateLanAddress(remote.address)) return;
    const response = createLanDiscoveryResponse(message, hostId, options.addresses(), options.port);
    if (!response) return;
    socket.send(Buffer.from(JSON.stringify(response)), LAN_DISCOVERY_PORT, LAN_DISCOVERY_GROUP, (error) => {
      if (error) options.onError(error);
    });
  });
  socket.bind(LAN_DISCOVERY_PORT, "0.0.0.0", () => {
    try {
      socket.addMembership(LAN_DISCOVERY_GROUP);
      socket.setMulticastTTL(1);
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
      socket.close();
    }
  });

  return { close: () => socket.close() };
}
