import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export type CustomAssetCategory = "models" | "objects" | "animations" | "audio" | "voices" | "tts";

export interface CustomAssetDirectories {
  models: string;
  animations: string;
  audio: string;
  objects?: string;
  voices?: string;
  tts?: string;
}

export interface CustomAssetCatalog {
  models: string[];
  objects: string[];
  animations: string[];
  audio: string[];
  voices: string[];
  tts: string[];
}

const MAX_ASSETS = 5_000;
const MAX_DIRECTORY_DEPTH = 12;
const MAX_ASSET_BYTES = 500 * 1024 * 1024;

export const REJECTED_FORMAT_FEEDBACK: Record<string, string> = {
  ".fbx": "FBX is a proprietary format unsuited for real-time WebGL skeletal performance. Please convert your model to .GLB, .VRM, or .PMX in Blender.",
  ".obj": "OBJ is a static polygon format without skeletal bones, skinning weights, or facial morph targets. Please use .GLB, .VRM, or .PMX for character avatars.",
  ".stl": "STL only stores raw triangle geometry for 3D printing and lacks skeletal bones and textures.",
  ".dae": "Collada (.dae) is deprecated for WebGL avatars. Please export as .GLB or .VRM.",
  ".blend": "Blender (.blend) project files cannot be parsed directly in WebGL. Please export as .GLB, .VRM, or .PMX.",
  ".bvh": "BVH only contains raw joint angles without mesh binding. Convert to .VMD for native character animation.",
  ".max": "3ds Max (.max) files are proprietary. Export as .GLB or .PMX.",
  ".3ds": "Legacy 3DS lacks modern PBR materials and bone skinning. Use .GLB instead.",
  ".c4d": "Cinema 4D (.c4d) files are proprietary. Export as .GLB or .PMX.",
};

const EXTENSIONS = {
  models: new Set([".pmx", ".glb", ".gltf", ".vrm", ".zip"]),
  objects: new Set([".glb", ".gltf"]),
  animations: new Set([".vmd"]),
  audio: new Set([".wav", ".mp3", ".ogg"]),
  voices: new Set([".wav", ".mp3", ".ogg"]),
  tts: new Set([".onnx", ".bin", ".safetensors", ".model", ".json", ".zip"]),
} satisfies Record<keyof CustomAssetCatalog, ReadonlySet<string>>;

export async function discoverCustomAssets(directories: CustomAssetDirectories): Promise<CustomAssetCatalog> {
  const catalog: CustomAssetCatalog = { models: [], objects: [], animations: [], audio: [], voices: [], tts: [] };
  let assetCount = 0;

  for (const category of Object.keys(EXTENSIONS) as CustomAssetCategory[]) {
    const root = directories[category];
    if (!root) continue;
    catalog[category] = await scanDirectory(root, EXTENSIONS[category], () => {
      assetCount += 1;
      if (assetCount > MAX_ASSETS) {
        throw new Error(`Custom asset catalog exceeds the ${MAX_ASSETS.toLocaleString()}-file limit.`);
      }
    });
  }

  catalog.models = catalog.models.filter((file) => !file.startsWith("objects/"));
  catalog.audio = catalog.audio.filter((file) => !file.startsWith("voices/") && !file.startsWith("tts/"));
  return catalog;
}

export async function importCustomAsset(
  source: string,
  category: CustomAssetCategory,
  directories: CustomAssetDirectories,
): Promise<{ fileName: string; relativePath: string; size: number }> {
  if (!path.isAbsolute(source)) throw new Error("Choose an asset using the desktop file picker.");
  const root = directories[category];
  if (!root) throw new Error(`The ${category} asset directory is not configured.`);
  const sourcePath = await fs.realpath(source);
  const stat = await fs.stat(sourcePath);
  const extension = path.extname(sourcePath).toLowerCase();
  if (!stat.isFile() || !EXTENSIONS[category].has(extension)) {
    const feedback = REJECTED_FORMAT_FEEDBACK[extension];
    if (feedback) {
      throw new Error(`Format ${extension.toUpperCase()} is not supported: ${feedback}`);
    }
    throw new Error(`That file format (${extension}) is not supported for ${category}. Strictly supported: ${Array.from(EXTENSIONS[category]).join(", ")}`);
  }
  if (stat.size <= 0 || stat.size > MAX_ASSET_BYTES) {
    throw new Error("Assets must be non-empty and no larger than 500 MB.");
  }

  const baseName = path.basename(sourcePath).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  if (!baseName || baseName === extension) throw new Error("The selected asset has an invalid filename.");
  await fs.mkdir(root, { recursive: true });

  let destination = path.join(root, baseName);
  let suffix = 1;
  while (await pathExists(destination)) {
    const stem = path.basename(baseName, extension);
    destination = path.join(root, `${stem} (${suffix})${extension}`);
    suffix += 1;
  }
  await fs.copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
  return { fileName: path.basename(destination), relativePath: path.basename(destination), size: stat.size };
}

async function scanDirectory(root: string, extensions: ReadonlySet<string>, onAsset: () => void): Promise<string[]> {
  const results: string[] = [];

  const visit = async (directory: string, relativeDirectory: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === root && isMissingPath(error)) return;
      throw new Error(`Unable to scan custom assets in "${directory}".`, { cause: error });
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (depth >= MAX_DIRECTORY_DEPTH) {
          throw new Error(`Custom asset directory depth exceeds ${MAX_DIRECTORY_DEPTH} levels at "${absolutePath}".`);
        }
        await visit(absolutePath, relativePath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) continue;
      onAsset();
      results.push(relativePath);
    }
  };

  await visit(root, "", 0);
  return results.sort((left, right) => left.localeCompare(right));
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
}
