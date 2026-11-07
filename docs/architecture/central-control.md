# Central runtime control

JAYRA's Node runtime is the authorization and settings boundary for desktop,
phone, camera, screen-capture, and verified API actions.

## Capability execution

`MyraaRuntime` owns one `PermissionEngine`, one confirmation broker, and a
`CapabilityController`. Feature modules register stable action IDs with the
capability they require, then call the controller before executing their
handler. A denied action never reaches its handler; an `ask` decision creates
the same UI-visible one-time confirmation used by runtime tasks.

The legacy cognition tool executor also consults this `PermissionEngine`.
Its action names are translated to capability names at the boundary, while
autonomy pause and risk confirmation remain separate checks. Existing
`MYRAA_PERMISSION_*` environment flags are enforced as deny-only safety
overrides by the permission engine.

For an additional feature, register its action during runtime initialization
and wrap the feature's handler:

```ts
runtime.capabilities.register({
  id: "feature.export",
  capability: "WRITE_FILE",
});

await runtime.capabilities.execute(
  "feature.export",
  { path: destination },
  () => exportFeature(destination),
  { title: "Approve export" },
);
```

Existing HTTP, voice, and socket protocol shapes are retained. Shared dispatch
helpers ensure mobile commands and API-adapter calls reach the same policy
boundary regardless of which transport initiated them. Browser camera,
microphone, and continuous screen-sharing acquisition also request
authorization before opening the device or stream.

## Settings source of truth

`AppSettingsStore` now contains both application settings and renderer
preferences. The `/api/settings` compatibility endpoint presents the previous
flat renderer shape and translates writes into the canonical store. The
renderer's `localStorage` is only a startup cache; the app hydrates it from the
backend, and changes are persisted centrally. `settings.json` remains a
compatibility projection for the Python sidecar, not a second settings
authority. Network exposure changes remain on `/api/network/access` so they
retain their gateway restart and rollback behavior.

The Python sidecar keeps its local tool registry and OS-level checks as an
execution adapter. It is not a replacement authorization authority for Node
requests; tools invoked through the Node runtime are checked before dispatch.
When spawned by Node, execution, automation, browser, tool-management,
observation, telemetry, and pairing-detail routes additionally require a
per-process token. Node's legitimate sidecar calls send this token, preventing
direct localhost requests from skipping the Node boundary. The token is an
internal caller check, not a substitute for capability authorization in Node.
Standalone sidecar launches without that environment token retain their prior
local-development behavior.

Unused persisted `privacy` booleans were removed from the settings contract;
privacy controls are represented by the capability policy, rather than a
second set of inert toggles.
