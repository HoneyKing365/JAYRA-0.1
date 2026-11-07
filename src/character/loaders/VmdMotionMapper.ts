/**
 * JAYRA VMD Motion Mapper & Animation Binding Pipeline
 * Converts MMD Vocaloid Motion Data (.VMD) into three.js AnimationClips and retargets them
 * onto compatible PMX, VRM, and GLTF humanoid character skeletons.
 */

import * as THREE from "three";
import { Parser as MmdParser } from "mmd-parser";

/** Japanese MMD Bone -> Standard Humanoid Bone mapping dictionary */
export const MMD_TO_HUMANOID_BONES: Record<string, string> = {
  // Center / Spine
  "全ての親": "ROOT",
  "センター": "CENTER",
  "グルーブ": "GROOVE",
  "腰": "HIPS",
  "下半身": "LOWER_BODY",
  "上半身": "SPINE",
  "上半身2": "CHEST",
  "首": "NECK",
  "頭": "HEAD",
  "左目": "LEFT_EYE",
  "右目": "RIGHT_EYE",

  // Left Arm
  "左肩": "LEFT_SHOULDER",
  "左腕": "LEFT_UPPER_ARM",
  "左ひじ": "LEFT_LOWER_ARM",
  "左手首": "LEFT_HAND",

  // Right Arm
  "右肩": "RIGHT_SHOULDER",
  "右腕": "RIGHT_UPPER_ARM",
  "右ひじ": "RIGHT_LOWER_ARM",
  "右手首": "RIGHT_HAND",

  // Left Leg
  "左足": "LEFT_UPPER_LEG",
  "左ひざ": "LEFT_LOWER_LEG",
  "左足首": "LEFT_FOOT",
  "左つま先": "LEFT_TOES",

  // Right Leg
  "右足": "RIGHT_UPPER_LEG",
  "右ひざ": "RIGHT_LOWER_LEG",
  "右足首": "RIGHT_FOOT",
  "右つま先": "RIGHT_TOES",

  // Left Fingers
  "左親指０": "LEFT_THUMB_METACARPAL",
  "左親指１": "LEFT_THUMB_PROXIMAL",
  "左親指２": "LEFT_THUMB_DISTAL",
  "左人指１": "LEFT_INDEX_PROXIMAL",
  "左人指２": "LEFT_INDEX_INTERMEDIATE",
  "左人指３": "LEFT_INDEX_DISTAL",
  "左中指１": "LEFT_MIDDLE_PROXIMAL",
  "左中指２": "LEFT_MIDDLE_INTERMEDIATE",
  "左中指３": "LEFT_MIDDLE_DISTAL",
  "左薬指１": "LEFT_RING_PROXIMAL",
  "左薬指２": "LEFT_RING_INTERMEDIATE",
  "左薬指３": "LEFT_RING_DISTAL",
  "左小指１": "LEFT_LITTLE_PROXIMAL",
  "左小指２": "LEFT_LITTLE_INTERMEDIATE",
  "左小指３": "LEFT_LITTLE_DISTAL",

  // Right Fingers
  "右親指０": "RIGHT_THUMB_METACARPAL",
  "右親指１": "RIGHT_THUMB_PROXIMAL",
  "右親指２": "RIGHT_THUMB_DISTAL",
  "右人指１": "RIGHT_INDEX_PROXIMAL",
  "右人指２": "RIGHT_INDEX_INTERMEDIATE",
  "右人指３": "RIGHT_INDEX_DISTAL",
  "右中指１": "RIGHT_MIDDLE_PROXIMAL",
  "右中指２": "RIGHT_MIDDLE_INTERMEDIATE",
  "右中指３": "RIGHT_MIDDLE_DISTAL",
  "右薬指１": "RIGHT_RING_PROXIMAL",
  "右薬指２": "RIGHT_RING_INTERMEDIATE",
  "右薬指３": "RIGHT_RING_DISTAL",
  "右小指１": "RIGHT_LITTLE_PROXIMAL",
  "右小指２": "RIGHT_LITTLE_INTERMEDIATE",
  "右小指３": "RIGHT_LITTLE_DISTAL",
};

export interface VmdMotionFrame {
  boneName: string;
  frameNum: number;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface VmdMorphFrame {
  morphName: string;
  frameNum: number;
  weight: number;
}

export interface ParsedVmdData {
  metadata: {
    magic: string;
    name: string;
    coordinateSystem: string;
  };
  motions: VmdMotionFrame[];
  morphs: VmdMorphFrame[];
}

export interface VmdConversionOptions {
  clipName?: string;
  fps?: number;
  scale?: number;
  /** Target skeleton available bone names (if retargeting) */
  targetBoneNames?: ReadonlySet<string>;
  /** Model bone name mapping */
  boneMapping?: Record<string, string>;
}

export class VmdMotionMapper {
  /** Parse raw VMD ArrayBuffer */
  static parse(buffer: ArrayBuffer): ParsedVmdData {
    const parser = new MmdParser();
    const vmd = parser.parseVmd(buffer);
    return vmd as ParsedVmdData;
  }

  /** Parse VMD ArrayBuffer directly to an AnimationClip */
  static parseVmdToClip(
    clipName: string,
    buffer: ArrayBuffer,
    options?: VmdConversionOptions
  ): THREE.AnimationClip {
    const vmd = VmdMotionMapper.parse(buffer);
    return VmdMotionMapper.toAnimationClip(vmd, { ...options, clipName });
  }

  /** Convert raw or synthetic VMD data directly to an AnimationClip */
  static vmdDataToClip(
    clipName: string,
    vmdData: any,
    options?: VmdConversionOptions
  ): THREE.AnimationClip {
    const parsed: ParsedVmdData = {
      metadata: { magic: "Vocaloid Motion Data 0002", name: clipName, coordinateSystem: "left-handed" },
      motions: vmdData.motions || vmdData.motion || [],
      morphs: vmdData.morphs || vmdData.morph || [],
    };
    return VmdMotionMapper.toAnimationClip(parsed, { ...options, clipName });
  }

  /** Convert VMD parsed data into a three.js AnimationClip */
  static toAnimationClip(
    vmd: ParsedVmdData,
    options: VmdConversionOptions = {}
  ): THREE.AnimationClip {
    const clipName = options.clipName || vmd.metadata.name || "VMD_Dance_Motion";
    const fps = options.fps ?? 30;
    const scale = options.scale ?? 1.0;
    const targetBones = options.targetBoneNames;
    const customMapping = options.boneMapping || {};

    const tracks: THREE.KeyframeTrack[] = [];
    let maxTime = 0;

    // 1. Group bone motions by bone name
    const boneMotions = new Map<string, VmdMotionFrame[]>();
    for (const motion of vmd.motions || []) {
      const boneName = motion.boneName;
      if (!boneMotions.has(boneName)) boneMotions.set(boneName, []);
      boneMotions.get(boneName)!.push(motion);
    }

    // 2. Build bone tracks
    for (const [rawBoneName, frames] of boneMotions) {
      if (frames.length === 0) continue;

      // Determine target bone name in model hierarchy
      let targetName = rawBoneName;
      if (targetBones) {
        if (!targetBones.has(targetName)) {
          // Try humanoid translation
          const slot = MMD_TO_HUMANOID_BONES[rawBoneName] || customMapping[rawBoneName];
          if (slot && targetBones.has(slot)) {
            targetName = slot;
          } else {
            // Case-insensitive or stripped check
            const found = [...targetBones].find(
              (b) => b.toLowerCase() === rawBoneName.toLowerCase()
            );
            if (found) targetName = found;
          }
        }
      }

      // Sort frames strictly by frameNum
      frames.sort((a, b) => a.frameNum - b.frameNum);

      // De-duplicate any multiple keyframes at identical frame numbers
      const times: number[] = [];
      const positions: number[] = [];
      const rotations: number[] = [];
      let lastFrame = -1;
      let hasPosition = false;

      for (const f of frames) {
        if (f.frameNum === lastFrame) continue;
        lastFrame = f.frameNum;
        const t = f.frameNum / fps;
        times.push(t);
        if (t > maxTime) maxTime = t;

        // Position: X, Y, -Z (left-handed PMX to right-handed Three.js)
        const px = (f.position[0] || 0) * scale;
        const py = (f.position[1] || 0) * scale;
        const pz = -(f.position[2] || 0) * scale;
        positions.push(px, py, pz);
        if (Math.abs(px) > 1e-4 || Math.abs(py) > 1e-4 || Math.abs(pz) > 1e-4) {
          hasPosition = true;
        }

        // Quaternion: -X, -Y, Z, W (coordinate handedness flip)
        const qx = -(f.rotation[0] || 0);
        const qy = -(f.rotation[1] || 0);
        const qz = f.rotation[2] || 0;
        const qw = f.rotation[3] !== undefined ? f.rotation[3] : 1;
        rotations.push(qx, qy, qz, qw);
      }

      if (times.length > 0) {
        const rotTrackName = `${targetName}.quaternion`;
        tracks.push(
          new THREE.QuaternionKeyframeTrack(
            rotTrackName,
            new Float32Array(times),
            new Float32Array(rotations)
          )
        );

        // Include translation track for root/center/hips or bones with animated translation
        const isMovableBone =
          rawBoneName === "センター" ||
          rawBoneName === "全ての親" ||
          rawBoneName === "グルーブ" ||
          rawBoneName === "腰" ||
          hasPosition;

        if (isMovableBone) {
          const posTrackName = `${targetName}.position`;
          tracks.push(
            new THREE.VectorKeyframeTrack(
              posTrackName,
              new Float32Array(times),
              new Float32Array(positions)
            )
          );
        }
      }
    }

    // 3. Group facial / expression morph keyframes
    const morphFrames = new Map<string, VmdMorphFrame[]>();
    for (const morph of vmd.morphs || []) {
      const name = morph.morphName;
      if (!morphFrames.has(name)) morphFrames.set(name, []);
      morphFrames.get(name)!.push(morph);
    }

    for (const [morphName, frames] of morphFrames) {
      if (frames.length === 0) continue;
      frames.sort((a, b) => a.frameNum - b.frameNum);

      const times: number[] = [];
      const values: number[] = [];
      let lastFrame = -1;

      for (const m of frames) {
        if (m.frameNum === lastFrame) continue;
        lastFrame = m.frameNum;
        const t = m.frameNum / fps;
        times.push(t);
        values.push(m.weight);
        if (t > maxTime) maxTime = t;
      }

      if (times.length > 0) {
        const trackName = `.morphTargetInfluences[${morphName}]`;
        tracks.push(
          new THREE.NumberKeyframeTrack(
            trackName,
            new Float32Array(times),
            new Float32Array(values)
          )
        );
      }
    }

    return new THREE.AnimationClip(clipName, Math.max(maxTime, 0.1), tracks);
  }
}

/** Controller to play and blend VMD animations on a SkinnedMesh */
export class VmdPlayer {
  readonly mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | null = null;
  private isPlaying = false;

  constructor(readonly root: THREE.Object3D) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  play(clip: THREE.AnimationClip, loop = true): void {
    if (this.action) {
      this.action.stop();
      this.mixer.uncacheClip(this.action.getClip());
    }
    this.action = this.mixer.clipAction(clip);
    this.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    this.action.clampWhenFinished = !loop;
    this.action.play();
    this.isPlaying = true;
  }

  stop(): void {
    if (this.action) {
      this.action.stop();
      this.action = null;
    }
    this.isPlaying = false;
  }

  pause(): void {
    if (this.action) {
      this.action.paused = true;
      this.isPlaying = false;
    }
  }

  resume(): void {
    if (this.action) {
      this.action.paused = false;
      this.isPlaying = true;
    }
  }

  update(delta: number): void {
    if (this.isPlaying) {
      this.mixer.update(delta);
    }
  }

  get running(): boolean {
    return this.isPlaying;
  }
}
