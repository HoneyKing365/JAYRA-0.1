type UiCapabilityAction =
  | "ui.camera.access"
  | "ui.microphone.access"
  | "desktop.screen_capture";

export async function authorizeUiCapability(actionId: UiCapabilityAction): Promise<void> {
  const response = await fetch("/api/permissions/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actionId }),
  });
  const text = await response.text();
  let payload: { error?: string; authorized?: boolean } = {};
  try {
    payload = text ? JSON.parse(text) as typeof payload : {};
  } catch {
    throw new Error("JAYRA backend returned an invalid permission response.");
  }
  if (!response.ok || payload.authorized !== true) {
    throw new Error(payload.error || `Permission request failed (${response.status}).`);
  }
}
