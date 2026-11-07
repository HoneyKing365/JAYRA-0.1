/**
 * JAYRA Universal 3D Model Loader
 * Unified loader supporting .PMX, .GLB, .GLTF, and .VRM models.
 * Adapts GLTF and VRM models into the runtime's SkinnedMesh and Rig contract.
 */

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadPmx, type LoadPmxOptions } from "./PmxLoader";
import {
  type PmxModel,
  type PmxBoneInfo,
  type PmxMaterialInfo,
  type PmxVertexMorph,
  BoneFlag,
} from "./pmxTypes";
import type { RigDescription, RigBone } from "@/shared/character/rig";

export interface UniversalModelOptions extends Partial<LoadPmxOptions> {
  modelUrl: string;
  textureMapUrl?: string;
  fileFormat?: "pmx" | "glb" | "gltf" | "vrm";
  arrayBuffer?: ArrayBuffer;
  onProgress?: (phase: string, ratio: number) => void;
}

export class UniversalModelLoader {
  /** Detect format from URL or extension */
  static detectFormat(url: string): "pmx" | "glb" | "gltf" | "vrm" {
    const clean = url.split("?")[0].toLowerCase();
    if (clean.endsWith(".glb")) return "glb";
    if (clean.endsWith(".vrm")) return "vrm";
    if (clean.endsWith(".gltf")) return "gltf";
    return "pmx";
  }

  /** Universal loader entry point */
  static async load(options: UniversalModelOptions): Promise<PmxModel> {
    const format = options.fileFormat || UniversalModelLoader.detectFormat(options.modelUrl);

    if (format === "pmx") {
      return loadPmx({
        modelUrl: options.modelUrl,
        textureMapUrl: options.textureMapUrl || "",
        createMaterial: options.createMaterial || ((raw) => new THREE.MeshStandardMaterial({ name: raw.name })),
        onProgress: options.onProgress,
      });
    }

    // GLB, GLTF, or VRM loading via Three.js GLTFLoader
    return UniversalModelLoader.loadGltfOrVrm(options, format);
  }

  /** Load and adapt GLTF/GLB/VRM into PmxModel contract */
  private static async loadGltfOrVrm(
    options: UniversalModelOptions,
    format: "glb" | "gltf" | "vrm"
  ): Promise<PmxModel> {
    const report = (phase: string, ratio: number) => options.onProgress?.(phase, ratio);
    report("Loading 3D asset", 0.1);

    const loader = new GLTFLoader();

    let gltf: GLTF;
    if (options.arrayBuffer) {
      gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.parse(options.arrayBuffer!, "", resolve, reject);
      });
    } else {
      gltf = await loader.loadAsync(options.modelUrl, (event) => {
        if (event.total) report("Downloading model", 0.1 + (event.loaded / event.total) * 0.4);
      });
    }

    report("Processing skeleton & meshes", 0.6);
    const scene = gltf.scene || gltf.scenes[0];

    // Find primary SkinnedMesh
    let primarySkinnedMesh: THREE.SkinnedMesh | null = null;
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    const regularMeshes: THREE.Mesh[] = [];

    scene.traverse((obj) => {
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        skinnedMeshes.push(obj as THREE.SkinnedMesh);
      } else if ((obj as THREE.Mesh).isMesh) {
        regularMeshes.push(obj as THREE.Mesh);
      }
    });

    primarySkinnedMesh = skinnedMeshes[0] || null;

    // If no SkinnedMesh exists (static GLB), wrap regular mesh into a bone-rigged container
    if (!primarySkinnedMesh) {
      const rootBone = new THREE.Bone();
      rootBone.name = "ROOT";
      const spineBone = new THREE.Bone();
      spineBone.name = "SPINE";
      rootBone.add(spineBone);

      const targetMesh = regularMeshes[0] || new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
      const geom = targetMesh.geometry.clone();
      const count = geom.attributes.position.count;
      const skinIndices = new Float32Array(count * 4);
      const skinWeights = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        skinIndices[i * 4] = 1;
        skinWeights[i * 4] = 1.0;
      }
      geom.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndices, 4));
      geom.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeights, 4));

      primarySkinnedMesh = new THREE.SkinnedMesh(geom, targetMesh.material);
      const skeleton = new THREE.Skeleton([rootBone, spineBone]);
      primarySkinnedMesh.bind(skeleton);
      primarySkinnedMesh.add(rootBone);
    }

    const mesh = primarySkinnedMesh;
    const skeleton = mesh.skeleton;
    const bones = skeleton.bones;

    // Build boneInfos and map
    const boneInfos: PmxBoneInfo[] = [];
    const boneIndexByName = new Map<string, number>();

    bones.forEach((bone, index) => {
      boneIndexByName.set(bone.name, index);
      const parentIdx = bone.parent ? bones.indexOf(bone.parent as THREE.Bone) : -1;
      boneInfos.push({
        index,
        name: bone.name,
        parentIndex: parentIdx,
        position: bone.position.clone(),
        flag: BoneFlag.Rotatable | BoneFlag.Visible | BoneFlag.Enabled,
        transformationClass: 0,
      });
    });

    // Materials
    report("Configuring materials", 0.75);
    const materialsList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials: PmxMaterialInfo[] = materialsList.map((mat, i) => ({
      index: i,
      name: mat.name || `material_${i}`,
      start: 0,
      count: mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count,
      edgeSize: 0,
      edgeColor: new THREE.Color(0, 0, 0),
      flag: 1,
    }));

    // Morphs / Blendshapes
    report("Extracting morph targets", 0.85);
    const vertexMorphs = new Map<string, PmxVertexMorph>();
    if (mesh.morphTargetDictionary) {
      for (const [name, idx] of Object.entries(mesh.morphTargetDictionary)) {
        vertexMorphs.set(name, {
          name,
          panel: 1,
          morphTargetIndex: idx,
        });
      }
    }

    // Rig description
    const rigBones: RigBone[] = boneInfos.map((b) => ({
      index: b.index,
      name: b.name,
      englishName: b.name,
      parent: b.parentIndex,
      position: [b.position.x, b.position.y, b.position.z],
      flags: b.flag,
    }));

    const rig: RigDescription = {
      format: "pmx",
      modelName: scene.name || "GLTF_Model",
      englishModelName: scene.name || "GLTF_Model",
      vertexCount: mesh.geometry.attributes.position?.count || 0,
      bones: rigBones,
      bodies: [],
      joints: [],
      morphs: [...vertexMorphs.keys()].map((name) => ({
        name,
        englishName: name,
        type: "vertex" as const,
        panel: 1,
      })),
      materials: materials.map((m) => ({
        name: m.name,
        englishName: m.name,
        texture: null,
        faceCount: 0,
      })),
      weightedBones: bones.map((_, i) => i),
    };

    mesh.geometry.computeBoundingBox();
    const boundingBox = mesh.geometry.boundingBox || new THREE.Box3();

    report("Ready", 1.0);

    return {
      name: (gltf as any).parser?.json?.asset?.generator || scene.name || "GLTF_Model",
      mesh,
      skeleton,
      bones,
      boneInfos,
      boneIndexByName,
      materials,
      vertexMorphs,
      boneMorphs: new Map(),
      groupMorphs: new Map(),
      rigidBodies: [],
      constraints: [],
      iks: [],
      grants: [],
      boundingBox,
      rig,
    };
  }
}
