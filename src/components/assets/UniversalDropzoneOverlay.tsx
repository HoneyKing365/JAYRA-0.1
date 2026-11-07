/**
 * JAYRA Universal Drop & Import Dropzone Overlay
 * High-performance full-window drag-and-drop listener and interactive file importer.
 * Features glowing holographic HUD, strict extension badges, and instant diagnostic feedback.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  UploadCloud,
  FileCode,
  Film,
  Music,
  Image as ImageIcon,
  Archive,
  AlertOctagon,
  Sparkles,
  CheckCircle2,
  X,
  FileUp,
} from "lucide-react";
import {
  AssetInspection,
  SUPPORTED_EXTENSIONS,
  REJECTED_EXTENSIONS,
} from "../../assets/assetTypes";
import { inspectAssetBuffer } from "../../assets/universalAssetInspector";

export interface UniversalDropzoneOverlayProps {
  onAssetInspected: (inspection: AssetInspection, buffer: ArrayBuffer, file: File) => void;
  disabled?: boolean;
}

export const UniversalDropzoneOverlay: React.FC<UniversalDropzoneOverlayProps> = ({
  onAssetInspected,
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Global window drag & drop event handling
  useEffect(() => {
    if (disabled) return;

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDragging && e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleFiles(Array.from(e.dataTransfer.files));
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [disabled, isDragging]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setIsProcessing(true);
      setStatusMessage(`Inspecting ${files[0].name}...`);

      try {
        const file = files[0]; // Primary target
        const buffer = await file.arrayBuffer();
        const inspection = inspectAssetBuffer(file.name, buffer, file.size);
        setStatusMessage(null);
        setIsProcessing(false);
        onAssetInspected(inspection, buffer, file);
      } catch (err: any) {
        console.error("Asset inspection error:", err);
        setStatusMessage(`Error inspecting file: ${err?.message || "Corrupt file"}`);
        setTimeout(() => setStatusMessage(null), 3000);
        setIsProcessing(false);
      }
    },
    [onAssetInspected]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const triggerManualUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pmx,.glb,.gltf,.vrm,.vmd,.wav,.mp3,.ogg,.png,.jpg,.jpeg,.dds,.zip"
        onChange={handleFileInputChange}
      />

      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-md pointer-events-none"
          >
            <div className="relative w-full max-w-2xl rounded-2xl border-2 border-dashed border-cyan-400/80 bg-zinc-950/90 p-8 shadow-[0_0_50px_rgba(6,182,212,0.35)] flex flex-col items-center text-center overflow-hidden">
              {/* Animated scanline / pulse effect */}
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-cyan-500/10 via-transparent to-purple-500/10 animate-pulse" />

              <motion.div
                animate={{ scale: [1, 1.08, 1], rotate: [0, 2, -2, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-500/20 to-purple-500/30 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shadow-[0_0_30px_rgba(6,182,212,0.5)] mb-5"
              >
                <UploadCloud className="w-10 h-10 animate-bounce" />
              </motion.div>

              <h2 className="text-2xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-sky-200 to-fuchsia-300">
                UNIVERSAL ASSET INGESTION DROPZONE
              </h2>
              <p className="mt-2 text-sm text-zinc-300 max-w-lg">
                Release your file or ZIP bundle here. JAYRA will autonomously inspect skeletal bones,
                morph targets, motions, or audio and bind them into the active runtime.
              </p>

              {/* Supported format badges */}
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full max-w-lg text-xs">
                <div className="p-2.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 flex items-center gap-2 text-cyan-200">
                  <FileCode className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-zinc-100">3D Models</div>
                    <div className="text-[10px] text-cyan-300/80">.pmx, .glb, .gltf, .vrm</div>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-950/30 flex items-center gap-2 text-fuchsia-200">
                  <Film className="w-4 h-4 text-fuchsia-400 shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-zinc-100">Animations</div>
                    <div className="text-[10px] text-fuchsia-300/80">.vmd</div>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-950/30 flex items-center gap-2 text-emerald-200">
                  <Music className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-zinc-100">Audio / TTS</div>
                    <div className="text-[10px] text-emerald-300/80">.wav, .mp3, .ogg</div>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-950/30 flex items-center gap-2 text-amber-200">
                  <Archive className="w-4 h-4 text-amber-400 shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-zinc-100">Bundles</div>
                    <div className="text-[10px] text-amber-300/80">.zip packages</div>
                  </div>
                </div>
              </div>

              {/* Strict notice */}
              <div className="mt-4 flex items-center gap-2 text-[11px] text-zinc-400 bg-zinc-900/60 px-3 py-1.5 rounded-md border border-zinc-800">
                <AlertOctagon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  Heavy proprietary formats (FBX, OBJ, STL, DAE, BLEND) are automatically detected and diagnosed with conversion advice.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Processing Toast if loading */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-cyan-500/50 text-cyan-200 shadow-2xl shadow-cyan-950/50 backdrop-blur-md"
          >
            <Sparkles className="w-5 h-5 text-cyan-400 animate-spin" />
            <span className="text-xs font-medium">{statusMessage || "Analyzing 3D Asset..."}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
