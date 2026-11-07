/**
 * JAYRA Universal Asset Inspector
 * Autonomously inspects, categorizes, validates, and diagnoses incoming 3D assets, motions, audio, and archives.
 */

import {
  AssetInspection,
  AssetKind,
  REJECTED_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  ALL_SUPPORTED_EXTENSIONS,
  AssetSubFile,
} from "./assetTypes";

/** Read string from DataView safely */
function readAscii(view: DataView, offset: number, length: number): string {
  if (offset + length > view.byteLength) return "";
  let str = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str;
}

/** Classify extension into AssetKind */
export function classifyExtension(ext: string): AssetKind {
  const lower = ext.toLowerCase();
  if (SUPPORTED_EXTENSIONS.avatar.includes(lower as any)) return "avatar";
  if (SUPPORTED_EXTENSIONS.motion.includes(lower as any)) return "motion";
  if (SUPPORTED_EXTENSIONS.audio.includes(lower as any)) return "audio";
  if (SUPPORTED_EXTENSIONS.texture.includes(lower as any)) return "texture";
  if (SUPPORTED_EXTENSIONS.archive.includes(lower as any)) return "archive";
  return "unsupported";
}

/** Fast inspection of a file / buffer */
export function inspectAssetBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  fileSize?: number
): AssetInspection {
  const size = fileSize ?? buffer.byteLength;
  const ext = fileName.includes(".")
    ? "." + fileName.split(".").pop()!.toLowerCase()
    : "";

  const kind = classifyExtension(ext);
  const warnings: string[] = [];
  const view = new DataView(buffer);

  // Check for rejected heavy/unsupported formats
  if (kind === "unsupported") {
    const reason =
      REJECTED_EXTENSIONS[ext] ||
      `Unsupported format "${ext}". JAYRA's real-time WebGL engine strictly supports .PMX, .GLB, .GLTF, .VRM for avatars, .VMD for animation, and .WAV/.MP3/.OGG for audio.`;
    return {
      name: fileName,
      size,
      extension: ext,
      kind: "unsupported",
      isValid: false,
      formatTitle: ext ? ext.toUpperCase().slice(1) + " File" : "Unknown File",
      description: "Format is not supported for native real-time WebGL rendering.",
      warnings: [],
      error: reason,
      suggestedAction: "reject",
      metadata: {},
    };
  }

  // Check for empty buffer
  if (size === 0) {
    return {
      name: fileName,
      size,
      extension: ext,
      kind,
      isValid: false,
      formatTitle: ext.toUpperCase().slice(1) + " File",
      description: "Empty file with 0 bytes.",
      warnings: [],
      error: "The provided asset file is empty (0 bytes).",
      suggestedAction: "reject",
      metadata: {},
    };
  }

  // 1. PMX Model Inspection
  if (ext === ".pmx") {
    return inspectPmxBuffer(fileName, buffer, size, view);
  }

  // 2. GLB / GLTF / VRM Model Inspection
  if (ext === ".glb" || ext === ".gltf" || ext === ".vrm") {
    return inspectGltfBuffer(fileName, buffer, size, view, ext);
  }

  // 3. VMD Motion Inspection
  if (ext === ".vmd") {
    return inspectVmdBuffer(fileName, buffer, size, view);
  }

  // 4. Audio Inspection (.wav, .mp3, .ogg)
  if (ext === ".wav" || ext === ".mp3" || ext === ".ogg") {
    return inspectAudioBuffer(fileName, buffer, size, view, ext);
  }

  // 5. Texture Inspection (.png, .jpg, .jpeg, .dds)
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".dds") {
    return inspectTextureBuffer(fileName, buffer, size, view, ext);
  }

  // 6. ZIP Archive Inspection
  if (ext === ".zip") {
    return inspectZipBuffer(fileName, buffer, size, view);
  }

  return {
    name: fileName,
    size,
    extension: ext,
    kind,
    isValid: true,
    formatTitle: ext.toUpperCase().slice(1),
    description: "Generic asset.",
    warnings,
    suggestedAction: "save_library",
    metadata: {},
  };
}

/** PMX parser inspection */
function inspectPmxBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  size: number,
  view: DataView
): AssetInspection {
  if (buffer.byteLength < 4) {
    return invalidInspection(fileName, size, ".pmx", "avatar", "File is too small to be a valid PMX model.");
  }
  const magic = readAscii(view, 0, 4);
  if (magic !== "PMX ") {
    return invalidInspection(
      fileName,
      size,
      ".pmx",
      "avatar",
      `Corrupt PMX header: expected magic 'PMX ', found '${magic}'.`
    );
  }

  const version = view.getFloat32(4, true);
  let bonesCount = 0;
  let morphsCount = 0;
  let materialsCount = 0;
  let modelName = fileName;
  const warnings: string[] = [];

  try {
    const globalsCount = view.getUint8(8);
    let offset = 9 + globalsCount;
    const textEncoding = globalsCount > 0 ? view.getUint8(9) : 0; // 0 = UTF-16LE, 1 = UTF-8

    // Read Model Name (local)
    const nameLen = view.getUint32(offset, true);
    offset += 4;
    if (nameLen > 0 && offset + nameLen <= buffer.byteLength) {
      const decoder = new TextDecoder(textEncoding === 0 ? "utf-16le" : "utf-8");
      const nameBytes = new Uint8Array(buffer, offset, nameLen);
      const parsed = decoder.decode(nameBytes).trim();
      if (parsed) modelName = parsed;
    }
  } catch {
    // Non-fatal metadata reading
  }

  if (size > 80 * 1024 * 1024) {
    warnings.push("Model size is over 80 MB; complex geometry may impact frame rates on low-end GPUs.");
  }

  return {
    name: fileName,
    size,
    extension: ".pmx",
    kind: "avatar",
    isValid: true,
    formatTitle: "MMD 3D Character Model (.PMX)",
    description: `Native MMD humanoid character model "${modelName}" with skeletal hierarchy, vertex morphs, and physics.`,
    warnings,
    suggestedAction: "apply_avatar",
    metadata: {
      isHumanoid: true,
      hasTextures: true,
      bonesCount,
      morphsCount,
      materialsCount,
    },
  };
}

/** GLB / GLTF / VRM parser inspection */
function inspectGltfBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  size: number,
  view: DataView,
  ext: string
): AssetInspection {
  let isVrm = ext === ".vrm";
  let bonesCount = 0;
  let morphsCount = 0;
  let materialsCount = 0;
  const warnings: string[] = [];

  if (ext === ".glb" || ext === ".vrm") {
    if (buffer.byteLength < 12) {
      return invalidInspection(fileName, size, ext, "avatar", "File is too small for binary GLTF/VRM.");
    }
    const magic = view.getUint32(0, true);
    if (magic !== 0x46546c67) { // "glTF"
      return invalidInspection(fileName, size, ext, "avatar", "Invalid binary GLTF header magic bytes.");
    }

    try {
      // Chunk 0 is JSON
      const jsonChunkLength = view.getUint32(12, true);
      const jsonChunkType = view.getUint32(16, true);
      if (jsonChunkType === 0x4e4f534a) { // "JSON"
        const jsonBytes = new Uint8Array(buffer, 20, Math.min(jsonChunkLength, buffer.byteLength - 20));
        const jsonStr = new TextDecoder("utf-8").decode(jsonBytes);
        const gltf = JSON.parse(jsonStr);

        if (gltf.extensions && (gltf.extensions.VRM || gltf.extensions.VRMC_vrm)) {
          isVrm = true;
        }

        materialsCount = Array.isArray(gltf.materials) ? gltf.materials.length : 0;
        if (Array.isArray(gltf.skins) && gltf.skins.length > 0) {
          bonesCount = Array.isArray(gltf.skins[0].joints) ? gltf.skins[0].joints.length : 0;
        } else if (Array.isArray(gltf.nodes)) {
          bonesCount = gltf.nodes.length;
        }

        if (Array.isArray(gltf.meshes)) {
          for (const mesh of gltf.meshes) {
            if (Array.isArray(mesh.weights)) morphsCount += mesh.weights.length;
          }
        }
      }
    } catch {
      // Non-fatal parse warning
    }
  } else if (ext === ".gltf") {
    try {
      const jsonStr = new TextDecoder("utf-8").decode(new Uint8Array(buffer));
      const gltf = JSON.parse(jsonStr);
      if (gltf.extensions && (gltf.extensions.VRM || gltf.extensions.VRMC_vrm)) isVrm = true;
      materialsCount = Array.isArray(gltf.materials) ? gltf.materials.length : 0;
      if (Array.isArray(gltf.skins) && gltf.skins.length > 0) {
        bonesCount = Array.isArray(gltf.skins[0].joints) ? gltf.skins[0].joints.length : 0;
      }
    } catch {
      return invalidInspection(fileName, size, ext, "avatar", "Invalid GLTF JSON structure.");
    }
  }

  const formatTitle = isVrm
    ? "VRoid / VRM Humanoid Avatar (.VRM)"
    : ext === ".glb"
    ? "GL Transmission Binary Format (.GLB)"
    : "GL Transmission Format (.GLTF)";

  return {
    name: fileName,
    size,
    extension: ext,
    kind: "avatar",
    isValid: true,
    formatTitle,
    description: isVrm
      ? "Standardized humanoid avatar with facial blendshapes, eye gaze tracking, and spring bones."
      : "High-performance real-time 3D model with skeletal skinning and PBR materials.",
    warnings,
    suggestedAction: "apply_avatar",
    metadata: {
      isHumanoid: true,
      isVrm,
      bonesCount,
      morphsCount,
      materialsCount,
      hasTextures: true,
    },
  };
}

/** VMD Motion parser inspection */
function inspectVmdBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  size: number,
  view: DataView
): AssetInspection {
  if (buffer.byteLength < 50) {
    return invalidInspection(fileName, size, ".vmd", "motion", "VMD file is too small.");
  }
  const magic = readAscii(view, 0, 30);
  if (!magic.startsWith("Vocaloid Motion Data")) {
    return invalidInspection(
      fileName,
      size,
      ".vmd",
      "motion",
      `Invalid VMD magic header. Expected 'Vocaloid Motion Data 0002', found '${magic}'.`
    );
  }

  const motionName = readAscii(view, 30, 20);
  let frameCount = 0;
  let durationSec = 0;
  let bonesCount = 0;
  let morphsCount = 0;

  try {
    const boneKeyframeCount = view.getUint32(50, true);
    bonesCount = boneKeyframeCount;
    let maxFrame = 0;

    let offset = 54;
    // Inspect bone keyframes for max frame number (each bone record is 111 bytes)
    const step = 111;
    const inspectCount = Math.min(boneKeyframeCount, 1000);
    for (let i = 0; i < inspectCount; i++) {
      const curOffset = offset + i * step;
      if (curOffset + 19 <= buffer.byteLength) {
        const frameNum = view.getUint32(curOffset + 15, true);
        if (frameNum > maxFrame) maxFrame = frameNum;
      }
    }

    // Check morph keyframes
    const morphOffset = 54 + boneKeyframeCount * 111;
    if (morphOffset + 4 <= buffer.byteLength) {
      const morphKeyframeCount = view.getUint32(morphOffset, true);
      morphsCount = morphKeyframeCount;
      const morphInspectCount = Math.min(morphKeyframeCount, 500);
      for (let j = 0; j < morphInspectCount; j++) {
        const curMOffset = morphOffset + 4 + j * 23;
        if (curMOffset + 19 <= buffer.byteLength) {
          const mFrame = view.getUint32(curMOffset + 15, true);
          if (mFrame > maxFrame) maxFrame = mFrame;
        }
      }
    }

    frameCount = maxFrame;
    durationSec = Math.round((maxFrame / 30) * 10) / 10;
  } catch {
    // Non-fatal frame inspection
  }

  return {
    name: fileName,
    size,
    extension: ".vmd",
    kind: "motion",
    isValid: true,
    formatTitle: "VMD Dance & Motion File (.VMD)",
    description: `MMD skeletal animation & dance motion "${motionName || fileName}" (${frameCount} frames, ~${durationSec}s at 30fps).`,
    warnings: [],
    suggestedAction: "apply_motion",
    metadata: {
      frameCount,
      durationSec,
      bonesCount,
      morphsCount,
    },
  };
}

/** Audio parser inspection (.wav, .mp3, .ogg) */
function inspectAudioBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  size: number,
  view: DataView,
  ext: string
): AssetInspection {
  let formatTitle = "Audio File";
  let isValid = true;
  let durationSec: number | undefined;

  if (ext === ".wav") {
    formatTitle = "Waveform Audio (.WAV)";
    if (buffer.byteLength >= 12) {
      const riff = readAscii(view, 0, 4);
      const wave = readAscii(view, 8, 4);
      if (riff !== "RIFF" || wave !== "WAVE") {
        return invalidInspection(fileName, size, ext, "audio", "Invalid WAV audio file header.");
      }
    }
  } else if (ext === ".ogg") {
    formatTitle = "Ogg Vorbis Audio (.OGG)";
    if (buffer.byteLength >= 4) {
      const ogg = readAscii(view, 0, 4);
      if (ogg !== "OggS") {
        return invalidInspection(fileName, size, ext, "audio", "Invalid OGG container header.");
      }
    }
  } else if (ext === ".mp3") {
    formatTitle = "MPEG Audio Layer III (.MP3)";
  }

  return {
    name: fileName,
    size,
    extension: ext,
    kind: "audio",
    isValid,
    formatTitle,
    description: `High-quality audio track ready for TTS, voicepacks, or companion sound effects.`,
    warnings: [],
    suggestedAction: "apply_audio",
    metadata: {
      durationSec,
    },
  };
}

/** Texture parser inspection (.png, .jpg, .jpeg, .dds) */
function inspectTextureBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  size: number,
  view: DataView,
  ext: string
): AssetInspection {
  let formatTitle = "Texture Image";
  let width = 0;
  let height = 0;

  if (ext === ".png" && buffer.byteLength >= 24) {
    formatTitle = "PNG Texture (.PNG)";
    width = view.getUint32(16, false);
    height = view.getUint32(20, false);
  } else if (ext === ".dds" && buffer.byteLength >= 20) {
    formatTitle = "DirectDraw Surface Texture (.DDS)";
    const magic = readAscii(view, 0, 4);
    if (magic === "DDS ") {
      height = view.getUint32(12, true);
      width = view.getUint32(16, true);
    }
  } else if (ext === ".jpg" || ext === ".jpeg") {
    formatTitle = "JPEG Texture (.JPG)";
  }

  return {
    name: fileName,
    size,
    extension: ext,
    kind: "texture",
    isValid: true,
    formatTitle,
    description: `Model skinning and appearance texture${width && height ? ` (${width}×${height}px)` : ""}.`,
    warnings: [],
    suggestedAction: "save_library",
    metadata: {
      dimensions: width && height ? { width, height } : undefined,
    },
  };
}

/** ZIP Archive parser inspection */
function inspectZipBuffer(
  fileName: string,
  buffer: ArrayBuffer,
  size: number,
  view: DataView
): AssetInspection {
  if (buffer.byteLength < 22) {
    return invalidInspection(fileName, size, ".zip", "archive", "File is too small to be a valid ZIP archive.");
  }

  // Find End of Central Directory
  let eocdOffset = -1;
  const maxSearch = Math.min(buffer.byteLength, 65557);
  for (let i = buffer.byteLength - 22; i >= buffer.byteLength - maxSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) {
    // Check for standard ZIP local file header (PK\x03\x04)
    const localHeaderMagic = view.getUint32(0, true);
    if (localHeaderMagic === 0x04034b50) {
      return {
        name: fileName,
        size,
        extension: ".zip",
        kind: "archive",
        isValid: true,
        formatTitle: "ZIP Archive Bundle (.ZIP)",
        description: "ZIP archive package containing character assets or animations.",
        warnings: ["Central directory unindexed; full extraction will unpack contents."],
        suggestedAction: "extract_archive",
        metadata: { subFiles: [] },
      };
    }
    return invalidInspection(fileName, size, ".zip", "archive", "Corrupt ZIP file (no end-of-central-directory or valid header).");
  }

  const entriesCount = view.getUint16(eocdOffset + 10, true);
  let cdOffset = view.getUint32(eocdOffset + 16, true);
  const subFiles: AssetSubFile[] = [];

  let pointer = cdOffset;
  for (let i = 0; i < entriesCount && pointer + 46 <= buffer.byteLength; i++) {
    const signature = view.getUint32(pointer, true);
    if (signature !== 0x02014b50) break;

    const uncompressedSize = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);

    const nameBytes = new Uint8Array(buffer, pointer + 46, nameLength);
    const entryName = new TextDecoder("utf-8").decode(nameBytes);
    const entryExt = entryName.includes(".") ? "." + entryName.split(".").pop()!.toLowerCase() : "";
    const entryKind = classifyExtension(entryExt);

    if (!entryName.endsWith("/") && !entryName.endsWith("\\")) {
      subFiles.push({
        name: entryName,
        size: uncompressedSize,
        kind: entryKind,
        extension: entryExt,
      });
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  const avatarFiles = subFiles.filter((f) => f.kind === "avatar");
  const motionFiles = subFiles.filter((f) => f.kind === "motion");
  const audioFiles = subFiles.filter((f) => f.kind === "audio");
  const textureFiles = subFiles.filter((f) => f.kind === "texture");
  const unsupportedFiles = subFiles.filter((f) => f.kind === "unsupported");

  const warnings: string[] = [];
  if (unsupportedFiles.length > 0) {
    warnings.push(
      `Archive contains ${unsupportedFiles.length} unsupported files (e.g. ${unsupportedFiles.slice(0, 3).map((f) => f.name).join(", ")}). They will be skipped.`
    );
  }

  let description = `Asset bundle containing ${subFiles.length} files.`;
  let suggestedAction: AssetInspection["suggestedAction"] = "extract_archive";

  if (avatarFiles.length > 0) {
    description = `3D Character Model package with ${avatarFiles[0].name}${textureFiles.length ? ` and ${textureFiles.length} textures` : ""}.`;
    suggestedAction = "apply_avatar";
  } else if (motionFiles.length > 0) {
    description = `Motion bundle containing ${motionFiles.length} animation tracks.`;
    suggestedAction = "apply_motion";
  }

  return {
    name: fileName,
    size,
    extension: ".zip",
    kind: "archive",
    isValid: true,
    formatTitle: "3D Asset Archive (.ZIP)",
    description,
    warnings,
    suggestedAction,
    metadata: {
      subFiles,
      hasTextures: textureFiles.length > 0,
      isHumanoid: avatarFiles.length > 0,
    },
  };
}

function invalidInspection(
  name: string,
  size: number,
  extension: string,
  kind: AssetKind,
  error: string
): AssetInspection {
  return {
    name,
    size,
    extension,
    kind,
    isValid: false,
    formatTitle: extension ? extension.toUpperCase().slice(1) + " File" : "Invalid File",
    description: "Asset inspection failed validation.",
    warnings: [],
    error,
    suggestedAction: "reject",
    metadata: {},
  };
}
