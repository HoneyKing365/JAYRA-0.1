/**
 * JAYRA Universal Asset Management & Confirmation Modal
 * Interactive inspector displaying real-time 3D analysis, validation, diagnostics, and 1-click actions.
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Boxes,
  Film,
  Music,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  X,
  Play,
  Square,
  Save,
  Sparkles,
  Layers,
  Activity,
  Archive,
  Info,
  Clock,
  ExternalLink,
} from "lucide-react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AssetInspection } from "../../assets/assetTypes";
import { VmdMotionMapper, VmdPlayer } from "../../character/loaders/VmdMotionMapper";

export interface UniversalAssetModalProps {
  inspection: AssetInspection | null;
  fileBuffer?: ArrayBuffer | null;
  isOpen: boolean;
  onClose: () => void;
  onApplyAvatar?: (inspection: AssetInspection, buffer?: ArrayBuffer) => Promise<void> | void;
  onApplyMotion?: (inspection: AssetInspection, buffer?: ArrayBuffer) => Promise<void> | void;
  onApplyAudio?: (inspection: AssetInspection, buffer?: ArrayBuffer) => Promise<void> | void;
  onSaveToLibrary?: (inspection: AssetInspection, buffer?: ArrayBuffer) => Promise<void> | void;
}

export const UniversalAssetModal: React.FC<UniversalAssetModalProps> = ({
  inspection,
  fileBuffer,
  isOpen,
  onClose,
  onApplyAvatar,
  onApplyMotion,
  onApplyAudio,
  onSaveToLibrary,
}) => {
  const [activeTab, setActiveTab] = useState<"analysis" | "preview" | "subfiles">("analysis");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewSceneRef = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; animId: number } | null>(null);

  useEffect(() => {
    setActiveTab("analysis");
    setFeedback(null);
  }, [inspection]);

  // Mini 3D Preview when 'preview' tab is selected
  useEffect(() => {
    if (!isOpen || activeTab !== "preview" || !previewCanvasRef.current || !fileBuffer || !inspection) return;

    const canvas = previewCanvasRef.current;
    const width = canvas.clientWidth || 360;
    const height = canvas.clientHeight || 240;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070913);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 3);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambient = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0x00f3ff, 2);
    dirLight.position.set(2, 4, 3);
    scene.add(dirLight);

    let mixer: THREE.AnimationMixer | null = null;
    let modelObj: THREE.Object3D | null = null;

    if (inspection.kind === "avatar" && (inspection.extension === ".glb" || inspection.extension === ".vrm" || inspection.extension === ".gltf")) {
      new GLTFLoader().parse(fileBuffer, "", (gltf) => {
        modelObj = gltf.scene;
        modelObj.scale.setScalar(0.9);
        scene.add(modelObj);

        // Center model in view
        const box = new THREE.Box3().setFromObject(modelObj);
        const center = box.getCenter(new THREE.Vector3());
        modelObj.position.sub(center);
        modelObj.position.y += 0.2;
      });
    } else {
      // Placeholder rotating preview mesh
      const geom = new THREE.TorusKnotGeometry(0.5, 0.18, 64, 16);
      const mat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, metalness: 0.6, roughness: 0.2 });
      modelObj = new THREE.Mesh(geom, mat);
      scene.add(modelObj);
    }

    const clock = new THREE.Clock();
    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      if (modelObj) modelObj.rotation.y += 0.01;
      if (mixer) mixer.update(dt);
      renderer.render(scene, camera);
    };
    animate();

    previewSceneRef.current = { scene, camera, renderer, animId };

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      previewSceneRef.current = null;
    };
  }, [isOpen, activeTab, fileBuffer, inspection]);

  if (!isOpen || !inspection) return null;

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getKindIcon = (kind: AssetInspection["kind"]) => {
    switch (kind) {
      case "avatar":
        return <Boxes className="w-5 h-5 text-cyan-400" />;
      case "motion":
        return <Film className="w-5 h-5 text-fuchsia-400" />;
      case "audio":
        return <Music className="w-5 h-5 text-emerald-400" />;
      case "texture":
        return <ImageIcon className="w-5 h-5 text-amber-400" />;
      case "archive":
        return <Archive className="w-5 h-5 text-blue-400" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-rose-400" />;
    }
  };

  const handleApply = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (inspection.kind === "avatar" && onApplyAvatar) {
        await onApplyAvatar(inspection, fileBuffer || undefined);
        setFeedback("Applied as active companion avatar!");
      } else if (inspection.kind === "motion" && onApplyMotion) {
        await onApplyMotion(inspection, fileBuffer || undefined);
        setFeedback("Loaded dance / motion animation onto active character!");
      } else if (inspection.kind === "audio" && onApplyAudio) {
        await onApplyAudio(inspection, fileBuffer || undefined);
        setFeedback("Loaded audio voice track!");
      }
    } catch (err: any) {
      setFeedback(`Failed to apply: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      if (onSaveToLibrary) {
        await onSaveToLibrary(inspection, fileBuffer || undefined);
        setFeedback("Asset saved successfully into JAYRA's local library.");
      }
    } catch (err: any) {
      setFeedback(`Failed to save: ${err.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#070b14]/95 shadow-[0_0_50px_rgba(0,229,255,0.15)] backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                {getKindIcon(inspection.kind)}
              </div>
              <div>
                <h3 className="font-display text-sm font-semibold tracking-wide text-white">
                  3D Asset Inspector
                </h3>
                <p className="text-[11px] text-slate-400">
                  {inspection.formatTitle} &bull; {formatSize(inspection.size)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tab navigation */}
          <div className="flex border-b border-white/10 px-5 text-xs font-medium">
            <button
              onClick={() => setActiveTab("analysis")}
              className={`border-b-2 px-3 py-2.5 transition-colors ${
                activeTab === "analysis"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Analysis & Diagnostics
            </button>
            {inspection.isValid && inspection.kind === "avatar" && (
              <button
                onClick={() => setActiveTab("preview")}
                className={`border-b-2 px-3 py-2.5 transition-colors ${
                  activeTab === "preview"
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                3D Preview
              </button>
            )}
            {inspection.metadata.subFiles && inspection.metadata.subFiles.length > 0 && (
              <button
                onClick={() => setActiveTab("subfiles")}
                className={`border-b-2 px-3 py-2.5 transition-colors ${
                  activeTab === "subfiles"
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                Bundle Contents ({inspection.metadata.subFiles.length})
              </button>
            )}
          </div>

          {/* Body */}
          <div className="p-5 max-h-[60vh] overflow-y-auto space-y-4">
            {activeTab === "analysis" && (
              <>
                {/* Status banner */}
                {inspection.isValid ? (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-300">
                    <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <div className="font-semibold text-emerald-200">
                        Compatible & Ready for Integration
                      </div>
                      <p className="text-emerald-300/80 leading-relaxed">
                        {inspection.description}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-rose-300">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <div className="font-semibold text-rose-200">
                        Unsupported or Incompatible Asset Format
                      </div>
                      <p className="text-rose-300/90 leading-relaxed">
                        {inspection.error}
                      </p>
                    </div>
                  </div>
                )}

                {/* Metadata cards */}
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">File Name</span>
                    <div className="mt-1 font-mono font-medium text-slate-200 truncate">{inspection.name}</div>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">Target Category</span>
                    <div className="mt-1 font-medium text-slate-200 capitalize">{inspection.kind}</div>
                  </div>

                  {inspection.metadata.bonesCount !== undefined && inspection.metadata.bonesCount > 0 && (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">Skeletal Bones</span>
                      <div className="mt-1 font-medium text-cyan-300">{inspection.metadata.bonesCount} Joints</div>
                    </div>
                  )}

                  {inspection.metadata.frameCount !== undefined && inspection.metadata.frameCount > 0 && (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">Motion Duration</span>
                      <div className="mt-1 font-medium text-fuchsia-300">
                        {inspection.metadata.durationSec}s ({inspection.metadata.frameCount} frames)
                      </div>
                    </div>
                  )}

                  {inspection.metadata.morphsCount !== undefined && inspection.metadata.morphsCount > 0 && (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">Facial Blendshapes</span>
                      <div className="mt-1 font-medium text-slate-200">{inspection.metadata.morphsCount} Morphs</div>
                    </div>
                  )}

                  {inspection.metadata.dimensions && (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">Dimensions</span>
                      <div className="mt-1 font-medium text-slate-200">
                        {inspection.metadata.dimensions.width} &times; {inspection.metadata.dimensions.height} px
                      </div>
                    </div>
                  )}
                </div>

                {/* Warnings if any */}
                {inspection.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-300 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Diagnostic Notes
                    </div>
                    {inspection.warnings.map((w, idx) => (
                      <div key={idx} className="text-amber-300/80 leading-relaxed">&bull; {w}</div>
                    ))}
                  </div>
                )}

                {/* Recommendations */}
                {inspection.isValid && (
                  <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3.5 text-xs text-cyan-200">
                    <span className="font-semibold text-cyan-100 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-cyan-400" /> JAYRA Recommendation:
                    </span>
                    <p className="mt-1 text-slate-300 leading-relaxed">
                      {inspection.kind === "avatar"
                        ? "Would you like to set this as your active companion avatar right now, or save it to your local library?"
                        : inspection.kind === "motion"
                        ? "Would you like to map and play this dance motion on your active character right now?"
                        : "Ready to save into your JAYRA asset library."}
                    </p>
                  </div>
                )}

                {feedback && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white">
                    {feedback}
                  </div>
                )}
              </>
            )}

            {activeTab === "preview" && (
              <div className="flex flex-col items-center">
                <canvas
                  ref={previewCanvasRef}
                  className="w-full h-60 rounded-xl border border-white/10 bg-[#070913]"
                />
                <span className="mt-2 text-[10px] text-slate-500">
                  Interactive real-time WebGL inspection preview
                </span>
              </div>
            )}

            {activeTab === "subfiles" && inspection.metadata.subFiles && (
              <div className="space-y-1.5">
                {inspection.metadata.subFiles.map((sub, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 truncate">
                      {getKindIcon(sub.kind)}
                      <span className="font-mono text-slate-300 truncate">{sub.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 shrink-0">{formatSize(sub.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between border-t border-white/10 px-5 py-4 bg-white/[0.01]">
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              {inspection.isValid && (
                <>
                  <button
                    disabled={busy}
                    onClick={handleSave}
                    className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" /> Save to Library
                  </button>
                  <button
                    disabled={busy}
                    onClick={handleApply}
                    className="flex items-center gap-1.5 rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-5 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors shadow-[0_0_15px_rgba(0,229,255,0.2)]"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Apply Instantly
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
