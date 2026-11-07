/**
 * Test Suite: JAYRA Universal 3D Asset Importer & Fixed Extension Engine
 * Validates strict format filtering, binary header inspection, diagnostic rejections, and VMD motion parsing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExtension,
  inspectAssetBuffer,
} from "../assets/universalAssetInspector";
import {
  SUPPORTED_EXTENSIONS,
  REJECTED_EXTENSIONS,
} from "../assets/assetTypes";
import { VmdMotionMapper } from "../character/loaders/VmdMotionMapper";
import { REJECTED_FORMAT_FEEDBACK } from "../../runtime/customAssets";

describe("Universal Asset Engine - Strict Format Scope", () => {
  it("strictly classifies supported 3D avatar formats", () => {
    for (const ext of SUPPORTED_EXTENSIONS.avatar) {
      assert.strictEqual(
        classifyExtension(ext),
        "avatar",
        `Expected ${ext} to be classified as avatar`
      );
    }
  });

  it("strictly classifies supported animation motions (.vmd)", () => {
    for (const ext of SUPPORTED_EXTENSIONS.motion) {
      assert.strictEqual(
        classifyExtension(ext),
        "motion",
        `Expected ${ext} to be classified as motion`
      );
    }
  });

  it("strictly classifies supported audio formats", () => {
    for (const ext of SUPPORTED_EXTENSIONS.audio) {
      assert.strictEqual(
        classifyExtension(ext),
        "audio",
        `Expected ${ext} to be classified as audio`
      );
    }
  });

  it("strictly classifies supported texture and archive formats", () => {
    for (const ext of SUPPORTED_EXTENSIONS.texture) {
      assert.strictEqual(
        classifyExtension(ext),
        "texture",
        `Expected ${ext} to be classified as texture`
      );
    }
    for (const ext of SUPPORTED_EXTENSIONS.archive) {
      assert.strictEqual(
        classifyExtension(ext),
        "archive",
        `Expected ${ext} to be classified as archive`
      );
    }
  });

  it("instantly rejects heavy/unsupported formats with actionable conversion diagnostics", () => {
    const rejectedList = [".fbx", ".obj", ".stl", ".dae", ".blend", ".bvh"];

    for (const ext of rejectedList) {
      assert.strictEqual(classifyExtension(ext), "unsupported");

      const dummyBuffer = new ArrayBuffer(64);
      const inspection = inspectAssetBuffer(`test_model${ext}`, dummyBuffer);

      assert.strictEqual(inspection.isValid, false);
      assert.strictEqual(inspection.kind, "unsupported");
      assert.strictEqual(inspection.suggestedAction, "reject");
      assert.ok(
        inspection.error && inspection.error.length > 10,
        `Expected detailed conversion diagnostic for ${ext}`
      );
      assert.ok(
        REJECTED_EXTENSIONS[ext],
        `Expected ${ext} in REJECTED_EXTENSIONS table`
      );
      assert.ok(
        REJECTED_FORMAT_FEEDBACK[ext],
        `Expected ${ext} in backend REJECTED_FORMAT_FEEDBACK table`
      );
    }
  });
});

describe("Universal Asset Engine - Binary Header Inspection", () => {
  it("detects and validates GLB binary magic bytes (glTF v2)", () => {
    // Construct minimal valid GLB header: magic 0x46546C67 ("glTF"), version 2, length 28
    const buffer = new ArrayBuffer(32);
    const view = new DataView(buffer);
    view.setUint32(0, 0x46546c67, true); // "glTF" little-endian magic
    view.setUint32(4, 2, true); // version 2 little-endian
    view.setUint32(8, 28, true); // total length

    // JSON chunk header
    view.setUint32(12, 8, true); // chunk length
    view.setUint32(16, 0x4e4f534a, false); // "JSON"

    const inspection = inspectAssetBuffer("avatar_test.glb", buffer);
    assert.strictEqual(inspection.isValid, true);
    assert.strictEqual(inspection.kind, "avatar");
    assert.strictEqual(inspection.suggestedAction, "apply_avatar");
    assert.ok(inspection.formatTitle.includes("GLB"));
  });

  it("detects and validates PMX binary magic bytes (PMX 2.0)", () => {
    // Construct minimal PMX buffer: "PMX " (0x50, 0x4D, 0x58, 0x20), version 2.0 (float 2.0)
    const buffer = new ArrayBuffer(128);
    const view = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    u8[0] = 0x50; // 'P'
    u8[1] = 0x4d; // 'M'
    u8[2] = 0x58; // 'X'
    u8[3] = 0x20; // ' '
    view.setFloat32(4, 2.0, true); // version 2.0

    const inspection = inspectAssetBuffer("miku_model.pmx", buffer);
    assert.strictEqual(inspection.isValid, true);
    assert.strictEqual(inspection.kind, "avatar");
    assert.strictEqual(inspection.suggestedAction, "apply_avatar");
    assert.ok(inspection.formatTitle.includes("PMX"));
  });

  it("detects and validates ZIP archive magic bytes (PK\\x03\\x04)", () => {
    const buffer = new ArrayBuffer(64);
    const u8 = new Uint8Array(buffer);
    u8[0] = 0x50; // 'P'
    u8[1] = 0x4b; // 'K'
    u8[2] = 0x03;
    u8[3] = 0x04;

    const inspection = inspectAssetBuffer("character_bundle.zip", buffer);
    assert.strictEqual(inspection.isValid, true);
    assert.strictEqual(inspection.kind, "archive");
    assert.strictEqual(inspection.suggestedAction, "extract_archive");
  });

  it("flags corrupt or empty buffers gracefully without throwing", () => {
    const emptyBuffer = new ArrayBuffer(0);
    const inspection = inspectAssetBuffer("corrupted.pmx", emptyBuffer);
    assert.strictEqual(inspection.isValid, false);
    assert.ok(inspection.error);
  });
});

describe("VMD Motion Parsing & Three.js Retargeting", () => {
  it("creates an AnimationClip with bone tracks from synthetic VMD frames", () => {
    // Test VmdMotionMapper static helper
    const dummyVmd = {
      motion: [
        {
          boneName: "センター", // Center / root
          frameNum: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
        {
          boneName: "センター",
          frameNum: 30, // 1 second at 30 fps
          position: [0, 5, 0],
          rotation: [0, 0.7071, 0, 0.7071],
        },
        {
          boneName: "左腕", // Left Arm
          frameNum: 0,
          position: [0, 0, 0],
          rotation: [0, 0, 0, 1],
        },
        {
          boneName: "左腕",
          frameNum: 15,
          position: [0, 0, 0],
          rotation: [0.5, 0, 0, 0.866],
        },
      ],
      morph: [],
      camera: [],
      light: [],
    };

    const clip = VmdMotionMapper.vmdDataToClip("test_dance", dummyVmd);
    assert.ok(clip, "AnimationClip must be created");
    assert.strictEqual(clip.name, "test_dance");
    assert.strictEqual(clip.duration, 1.0); // 30 frames at 30 FPS = 1.0 second
    assert.ok(clip.tracks.length >= 2, "Clip must contain tracks for animated bones");
  });
});
