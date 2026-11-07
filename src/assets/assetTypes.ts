/**
 * JAYRA Universal Asset Importer & Fixed Extension Engine
 * Type definitions and format specifications.
 */

export type AssetKind = "avatar" | "motion" | "audio" | "texture" | "archive" | "unsupported";

export type SupportedAvatarFormat = ".pmx" | ".glb" | ".gltf" | ".vrm";
export type SupportedMotionFormat = ".vmd";
export type SupportedAudioFormat = ".wav" | ".mp3" | ".ogg";
export type SupportedTextureFormat = ".png" | ".jpg" | ".jpeg" | ".dds";
export type SupportedArchiveFormat = ".zip";

export const SUPPORTED_EXTENSIONS = {
  avatar: [".pmx", ".glb", ".gltf", ".vrm"] as const,
  motion: [".vmd"] as const,
  audio: [".wav", ".mp3", ".ogg"] as const,
  texture: [".png", ".jpg", ".jpeg", ".dds"] as const,
  archive: [".zip"] as const,
};

export const ALL_SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  ...SUPPORTED_EXTENSIONS.avatar,
  ...SUPPORTED_EXTENSIONS.motion,
  ...SUPPORTED_EXTENSIONS.audio,
  ...SUPPORTED_EXTENSIONS.texture,
  ...SUPPORTED_EXTENSIONS.archive,
]);

export const REJECTED_EXTENSIONS: Record<string, string> = {
  ".fbx": "FBX is a complex proprietary format unsuited for real-time WebGL skeletal performance. Please convert your model or motion to .GLB, .VRM, or .PMX in Blender.",
  ".obj": "OBJ is a static polygon format without skeletal bones, skinning weights, or facial morph targets. Please use .GLB, .VRM, or .PMX for character avatars.",
  ".stl": "STL only stores raw triangle geometry for 3D printing and has no skeleton, materials, or textures.",
  ".dae": "Collada (.dae) is deprecated for real-time WebGL avatars. Please export as .GLB or .VRM for hardware-accelerated playback.",
  ".blend": "Blender (.blend) scene files cannot be parsed directly in WebGL. Please export as .GLB, .VRM, or .PMX.",
  ".bvh": "BVH only contains raw joint angles without mesh binding. Convert to .VMD for native character animation.",
  ".max": "3ds Max (.max) files are proprietary. Export as .GLB or .PMX.",
  ".3ds": "Legacy 3DS format lacks modern PBR materials and bone skinning. Use .GLB instead.",
  ".c4d": "Cinema 4D (.c4d) files are proprietary. Export as .GLB or .PMX.",
};

export interface AssetSubFile {
  name: string;
  size: number;
  kind: AssetKind;
  extension: string;
}

export interface AssetInspection {
  name: string;
  path?: string;
  size: number;
  extension: string;
  kind: AssetKind;
  isValid: boolean;
  formatTitle: string;
  description: string;
  warnings: string[];
  error?: string;
  suggestedAction: "apply_avatar" | "apply_motion" | "apply_audio" | "save_library" | "extract_archive" | "reject";
  metadata: {
    bonesCount?: number;
    morphsCount?: number;
    materialsCount?: number;
    frameCount?: number;
    durationSec?: number;
    isHumanoid?: boolean;
    isVrm?: boolean;
    hasTextures?: boolean;
    dimensions?: { width: number; height: number };
    subFiles?: AssetSubFile[];
  };
}

export interface ApplyAssetOptions {
  asset: AssetInspection;
  fileBuffer?: ArrayBuffer;
  filePath?: string;
  target?: "active_avatar" | "play_motion" | "play_audio" | "save_library";
  customName?: string;
}

export interface ApplyAssetResult {
  success: boolean;
  message: string;
  characterId?: string;
  motionClipName?: string;
  savedPath?: string;
  error?: string;
}
