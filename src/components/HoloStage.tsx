/**
 * JAYRA HoloStage - Powered by Jarvis Holographic Core Orb
 */
import React from "react";
import { JarvisOrb, type JarvisOrbProps } from "./JarvisOrb";
import type { AppSettings } from "../lib/appApi";

export interface HoloStageProps extends JarvisOrbProps {
  appSettings: AppSettings | null;
  interactive?: boolean;
  state?: "idle" | "listening" | "thinking" | "speaking" | string;
  characterState?: string;
  themeColor?: string;
}

export function HoloStage(props: HoloStageProps) {
  return <JarvisOrb {...props} />;
}

export default HoloStage;
