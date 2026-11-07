/**
 * Character registry.
 *
 * Built-in characters are compiled in; user characters are imported locally
 * (see character_import/) and fetched from the backend, which serves them
 * from the user's data folder. Both resolve to the same CharacterConfig.
 */
import type { CharacterConfig } from './types';
import type { CharacterProfile } from '@/shared/character/profile';
import { configFromProfile } from './fromProfile';

/**
 * Public installers (npm run dist:public) ship without the bundled model:
 * its licence forbids redistribution. Each user imports their own character.
 */
export const PUBLIC_BUILD = (import.meta.env.VITE_JAYRA_PUBLIC || import.meta.env.VITE_MYRAA_PUBLIC) === '1';

/** There is no bundled character config in the source tree. */
export const CHARACTERS: Record<string, CharacterConfig> = {};

/** Empty until a valid bundled character configuration is added. */
export const DEFAULT_CHARACTER_ID = '';

/** Raised when there is no character to show yet (public build, nothing imported). */
export const NO_CHARACTER = 'NO_CHARACTER';

export function getCharacterConfig(id: string = DEFAULT_CHARACTER_ID): CharacterConfig | null {
  return CHARACTERS[id] ?? null;
}

export function isBuiltInCharacter(id: string): boolean {
  return id in CHARACTERS;
}

export interface CharacterListing {
  id: string;
  displayName: string;
  source: 'built-in' | 'user';
  restrictions?: string[];
  summary?: { supported: number; partial: number; unsupported: number; testsPassed: number; testsFailed: number };
}

export function listCharacters(): Array<{ id: string; displayName: string }> {
  return Object.values(CHARACTERS).map((c) => ({ id: c.id, displayName: c.displayName }));
}

/** Built-in plus locally imported characters. */
export async function listAllCharacters(): Promise<CharacterListing[]> {
  const builtIn: CharacterListing[] = Object.values(CHARACTERS).map((c) => ({ id: c.id, displayName: c.displayName, source: 'built-in' }));
  try {
    const response = await fetch('/api/characters');
    if (!response.ok) return builtIn;
    const users = (await response.json()) as Array<{ id: string; displayName: string; restrictions: string[]; summary: CharacterListing['summary'] }>;
    return [...builtIn, ...users.filter((u) => !(u.id in CHARACTERS)).map((u) => ({ id: u.id, displayName: u.displayName, source: 'user' as const, restrictions: u.restrictions, summary: u.summary }))];
  } catch {
    return builtIn;
  }
}

export const DEFAULT_BASE_CONFIG: CharacterConfig = {
  id: 'default',
  displayName: 'JAYRA',
  modelUrl: '',
  textureMapUrl: '',
  scale: 1,
  groundOffset: 0,
  bones: {
    root: 'ROOT',
    center: 'CENTER',
    lowerBody: 'LOWER_BODY',
    upperBody: 'SPINE',
    neck: 'NECK',
    head: 'HEAD',
    shoulderL: 'LEFT_SHOULDER',
    shoulderR: 'RIGHT_SHOULDER',
    armL: 'LEFT_UPPER_ARM',
    armR: 'RIGHT_UPPER_ARM',
    elbowL: 'LEFT_LOWER_ARM',
    elbowR: 'RIGHT_LOWER_ARM',
    wristL: 'LEFT_HAND',
    wristR: 'RIGHT_HAND',
    legL: 'LEFT_UPPER_LEG',
    legR: 'RIGHT_UPPER_LEG',
    kneeL: 'LEFT_LOWER_LEG',
    kneeR: 'RIGHT_LOWER_LEG',
    ankleL: 'LEFT_FOOT',
    ankleR: 'RIGHT_FOOT',
  },
  morphs: {},
  materialRoles: {},
  materialTuning: {},
  camera: {
    targetBone: 'HEAD',
    targetOffset: -0.22,
    distance: 28.0,
    fov: 38,
    heightOffset: 0.05,
    parallax: 0.04,
    minDistance: 2.0,
    maxDistance: 80.0,
  },
  lighting: {
    keyIntensity: 1.2,
    keyColor: 0xfff0e8,
    keyAzimuth: 35,
    keyElevation: 25,
    fillIntensity: 0.6,
    fillColor: 0xd8eeff,
    fillAzimuth: -45,
    fillElevation: 10,
    rimIntensity: 0.8,
    rimColor: 0x88ccff,
    rimAzimuth: 160,
    rimElevation: 30,
    hairLightIntensity: 0.5,
    hairLightColor: 0xffffff,
    frontFillIntensity: 0.4,
    frontFillColor: 0xffffff,
    face: {
      keyAzimuth: 25,
      keyElevation: 15,
      keyIntensity: 1.1,
      keyColor: 0xfff5ee,
      fillIntensity: 0.5,
      fillColor: 0xddeeff,
      topIntensity: 0.3,
      topColor: 0xffffff,
      rimIntensity: 0.5,
      rimColor: 0x99ddff,
      bounceIntensity: 0.2,
      bounceColor: 0xffe4d0,
    },
    ambientIntensity: 0.4,
    ambientSkyColor: 0x88aacc,
    ambientGroundColor: 0x443322,
    environmentIntensity: 0.3,
    shadow: {
      enabled: true,
      mapSize: 1024,
      radius: 2,
      bias: -0.0005,
      normalBias: 0.02,
      opacity: 0.35,
    },
  },
  render: {
    exposure: 1.0,
    toneMapping: 'neutral',
    bloom: { enabled: true, strength: 0.25, radius: 0.4, threshold: 0.85 },
    antialias: true,
    maxPixelRatio: 2,
    targetFps: 60,
  },
  physics: {
    frequency: 60,
    maxSubSteps: 2,
    gravity: -9.8,
    globalAmplitude: 1,
    groups: {},
    fallback: { match: [], amplitude: 1, stiffness: 1, damping: 1, enabled: true },
  },
  idle: {
    breathRate: 0.25,
    breathDepth: 0.02,
    swayRate: 0.15,
    swayAmount: 0.015,
    postureIntervalMin: 12,
    postureIntervalMax: 25,
    blinkIntervalMin: 2.5,
    blinkIntervalMax: 6.0,
    doubleBlinkChance: 0.15,
    saccadeIntervalMin: 1.5,
    saccadeIntervalMax: 4.0,
  },
  behaviour: {
    intervalMin: 10,
    intervalMax: 25,
    noRepeatWindow: 4,
    busyIntervalScale: 2.5,
  },
  lipSync: {
    attack: 0.2,
    release: 0.3,
    gain: 1.2,
    noiseFloor: 0.02,
    maxWeight: 1.0,
    visemeBlendRate: 15,
  },
};

export async function fetchCharacterProfile(id: string): Promise<CharacterProfile> {
  const response = await fetch(`/api/characters/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`Character "${id}" is not available (${response.status}).`);
  return (await response.json()) as CharacterProfile;
}

function configFromImportedProfile(profile: CharacterProfile): CharacterConfig {
  const base = getCharacterConfig() || DEFAULT_BASE_CONFIG;
  return configFromProfile(profile, base);
}

/** Resolve any character id to a runnable config (and its profile if imported). */
export async function resolveCharacter(id: string | undefined): Promise<{ config: CharacterConfig; profile?: CharacterProfile }> {
  if (id && id in CHARACTERS) {
    const config = getCharacterConfig(id);
    if (config) return { config };
  }

  // Look for locally imported characters
  let userCharacters: CharacterListing[] = [];
  try {
    const available = await listAllCharacters();
    userCharacters = available.filter((c) => c.source === 'user');
  } catch {
    /* backend list offline */
  }

  // If a specific id was requested and is imported, use it
  if (id) {
    const matched = userCharacters.find((c) => c.id === id);
    if (matched) {
      try {
        const profile = await fetchCharacterProfile(matched.id);
        return { config: configFromImportedProfile(profile), profile };
      } catch {
        /* fall through to general user character check */
      }
    }
  }

  // Otherwise pick the first imported character if any exist
  if (userCharacters.length > 0) {
    try {
      const profile = await fetchCharacterProfile(userCharacters[0].id);
      return { config: configFromImportedProfile(profile), profile };
    } catch {
      /* fall through to default base config */
    }
  }

  // If a built-in character exists in CHARACTERS, use it
  const builtInConfig = getCharacterConfig();
  if (builtInConfig) return { config: builtInConfig };

  // Fallback to default base configuration so it NEVER throws NO_CHARACTER
  return { config: DEFAULT_BASE_CONFIG };
}
