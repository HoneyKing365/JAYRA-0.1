/**
 * JAYRA Holographic Shader — Procedural GLSL Hologram Material for Three.js
 *
 * Implements:
 *  - Rim/Fresnel edge glow
 *  - Animated scanline oscillation
 *  - Dynamic quantum electromagnetic glitch jitter
 *  - Vertex displacement pulse
 *  - Color theme transitions (Mark LV Cyan, Stark Gold, Matrix Green, Stealth Violet)
 */

import * as THREE from "three";

export interface HoloShaderUniforms {
  [key: string]: THREE.IUniform<any>;
  uTime: { value: number };
  uColor: { value: THREE.Color };
  uFresnelPower: { value: number };
  uScanlineDensity: { value: number };
  uScanlineSpeed: { value: number };
  uGlitchIntensity: { value: number };
  uOpacity: { value: number };
}

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uGlitchIntensity;

  // Simple pseudo-random hash
  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    
    // Holographic glitch jitter displacement
    float glitchTrigger = step(0.92, sin(uTime * 14.0));
    float displacement = sin(worldPos.y * 25.0 + uTime * 8.0) * glitchTrigger * uGlitchIntensity * 0.08;
    worldPos.x += displacement * hash(worldPos.y + uTime);

    vWorldPosition = worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uFresnelPower;
  uniform float uScanlineDensity;
  uniform float uScanlineSpeed;
  uniform float uGlitchIntensity;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // Fresnel effect: high intensity on silhouette edges
    float fresnel = 1.0 - abs(dot(normal, viewDir));
    fresnel = pow(clamp(fresnel, 0.0, 1.0), uFresnelPower);

    // Scanlines
    float scanline = sin(vWorldPosition.y * uScanlineDensity - uTime * uScanlineSpeed) * 0.5 + 0.5;
    scanline = pow(scanline, 2.0);

    // Flickering core
    float flicker = 0.95 + 0.05 * sin(uTime * 30.0);

    // Final color synthesis
    vec3 glowColor = uColor * 1.5;
    vec3 baseColor = uColor * 0.35;
    vec3 finalColor = mix(baseColor, glowColor, fresnel) * (0.6 + 0.4 * scanline) * flicker;

    // Glitch flash
    float glitch = step(0.96, sin(uTime * 22.0)) * uGlitchIntensity * 0.4;
    finalColor += vec3(glitch);

    float alpha = clamp((fresnel * 1.2 + 0.15 + scanline * 0.2) * uOpacity, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export function createHoloMaterial(options?: {
  color?: string | number;
  fresnelPower?: number;
  scanlineDensity?: number;
  scanlineSpeed?: number;
  glitchIntensity?: number;
  opacity?: number;
  wireframe?: boolean;
}): THREE.ShaderMaterial {
  const color = new THREE.Color(options?.color ?? "#00d4ff");

  const uniforms: HoloShaderUniforms = {
    uTime: { value: 0 },
    uColor: { value: color },
    uFresnelPower: { value: options?.fresnelPower ?? 2.2 },
    uScanlineDensity: { value: options?.scanlineDensity ?? 60.0 },
    uScanlineSpeed: { value: options?.scanlineSpeed ?? 4.0 },
    uGlitchIntensity: { value: options?.glitchIntensity ?? 0.6 },
    uOpacity: { value: options?.opacity ?? 0.88 },
  };

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    wireframe: options?.wireframe ?? false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
