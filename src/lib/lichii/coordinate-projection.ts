import fs from 'node:fs'
import path from 'node:path'
import { dataset } from '../data'
import type { Fraction, Place } from '../types'

export const placesById = new Map<string, Place>(dataset.places.map((p) => [p.id, p]))

export type MapCaptureConfig = {
  camX: number
  camY: number
  camZ: number
  height: number
  cx?: number
  cz?: number
  scaleX?: number
  scaleZ?: number
}

const CIUDADELA_ADULTO_CAPTURE: MapCaptureConfig = {
  camX: 0.0,
  camY: 200.0,
  camZ: 3.0,
  height: 214.0,
  scaleX: 8.4001,
  cx: 190.51,
  scaleZ: 8.0681,
  cz: 467.58,
}

const CIUDADELA_NINO_CAPTURE: MapCaptureConfig = {
  camX: 0.0,
  camY: 200.0,
  camZ: 3.0,
  height: 214.0,
  scaleX: 5.4314,
  cx: 422.86,
  scaleZ: 5.2191,
  cz: 305.08,
}

/**
 * Scene / BancName to oot.json placeId and orthographic capture parameters
 * from Game/MapCaptureInfo/MapCaptureInfo.game__MapCaptureInfo.bgyml
 * and Game/UI/MapMenuInfo.game__ui__MapMenuInfo.bgyml.
 */
export const SCENE_TO_PLACE: Record<
  string,
  {
    placeId: string
    defaultAge?: 'child' | 'adult'
    capture?: MapCaptureConfig
    captureByMapId?: Record<string, MapCaptureConfig>
  }
> = {
  KokiriForest: {
    placeId: 'kokiri',
    capture: {
      camX: -5.0,
      camY: 120.0,
      camZ: -12.0,
      height: 300.0,
      scaleX: 2.8985,
      cx: 429.08,
      scaleZ: 2.749,
      cz: 250.37,
    },
  },
  LostWood: {
    placeId: 'perdido',
    capture: { camX: 6.0, camY: 200.0, camZ: -1.0, height: 400.0, scaleX: 3.875, cx: 434.37, scaleZ: 3.363636, cz: 529.89 },
  },
  LostWoods: {
    placeId: 'perdido',
    capture: { camX: 6.0, camY: 200.0, camZ: -1.0, height: 400.0, scaleX: 3.875, cx: 434.37, scaleZ: 3.363636, cz: 529.89 },
  },
  SacredForestMeadow: {
    placeId: 'prado',
    capture: {
      camX: -12.0,
      camY: 150.0,
      camZ: -25.0,
      height: 317.0,
      scaleX: 6.15,
      cx: 487.31,
      scaleZ: 6.15,
      cz: 1062.72,
    },
  },
  HyruleField: {
    placeId: 'llanura',
    capture: {
      camX: -23.0,
      camY: 200.0,
      camZ: 197.0,
      height: 736.0,
      scaleX: 1.4552,
      cx: 504.27,
      scaleZ: 1.4867,
      cz: 11.89,
    },
  },
  LonLonRanch: {
    placeId: 'lonlon',
    capture: {
      camX: -86.0,
      camY: 200.0,
      camZ: 239.0,
      height: 276.0,
      scaleX: 5.5232,
      cx: 917.27,
      scaleZ: 5.7915,
      cz: -996.27,
    },
  },
  Market: {
    placeId: 'ciudadela',
    capture: CIUDADELA_ADULTO_CAPTURE,
    captureByMapId: { nino: CIUDADELA_NINO_CAPTURE },
  },
  MarketEntrance: {
    placeId: 'ciudadela',
    capture: CIUDADELA_ADULTO_CAPTURE,
    captureByMapId: { nino: CIUDADELA_NINO_CAPTURE },
  },
  BackAlley: {
    placeId: 'ciudadela',
    capture: CIUDADELA_ADULTO_CAPTURE,
    captureByMapId: { nino: CIUDADELA_NINO_CAPTURE },
  },
  TempleOfTimeExterior: {
    placeId: 'ciudadela',
    capture: CIUDADELA_ADULTO_CAPTURE,
    captureByMapId: { nino: CIUDADELA_NINO_CAPTURE },
  },
  TempleOfTime: {
    placeId: 'ciudadela',
    capture: CIUDADELA_ADULTO_CAPTURE,
    captureByMapId: { nino: CIUDADELA_NINO_CAPTURE },
  },
  GuardHouse: {
    placeId: 'ciudadela',
    capture: {
      camX: 0.0,
      camY: 200.0,
      camZ: 3.0,
      height: 214.0,
      scaleX: 6.15,
      cx: 412.06,
      scaleZ: 6.15,
      cz: 269.08,
    },
  },
  HyruleCastle: {
    placeId: 'castillo',
    defaultAge: 'child',
    capture: { camX: 0.0, camY: 200.0, camZ: -80.0, height: 242.0 },
    captureByMapId: {
      nino: {
        camX: 0.0,
        camY: 200.0,
        camZ: -80.0,
        height: 242.0,
        scaleX: 8.2959,
        cx: 286.92,
        scaleZ: 8.5297,
        cz: 1319.87,
      },
    },
  },
  CastleGrounds: {
    placeId: 'castillo',
    capture: { camX: 0.0, camY: 200.0, camZ: -80.0, height: 242.0 },
    captureByMapId: {
      nino: {
        camX: 0.0,
        camY: 200.0,
        camZ: -80.0,
        height: 242.0,
        scaleX: 8.2959,
        cx: 286.92,
        scaleZ: 8.5297,
        cz: 1319.87,
      },
    },
  },
  GanonsCastleExterior: {
    placeId: 'castillo',
    defaultAge: 'adult',
    capture: { camX: 0.0, camY: 200.0, camZ: -80.0, height: 242.0 },
  },
  KakarikoVillage: {
    placeId: 'kakariko',
    capture: {
      camX: -50.0,
      camY: 200.0,
      camZ: 42.0,
      height: 246.0,
      scaleX: 4.8703,
      cx: 671.18,
      scaleZ: 5.0719,
      cz: 188.14,
    },
  },
  Graveyard: {
    placeId: 'cementerio',
    capture: {
      camX: 18.0,
      camY: 200.0,
      camZ: 8.0,
      height: 148.0,
      scaleX: 6.8026,
      cx: 290.99,
      scaleZ: 6.3988,
      cz: 122.36,
    },
  },
  RoyalFamilysTomb: {
    placeId: 'cementerio',
    capture: {
      camX: 18.0,
      camY: 200.0,
      camZ: 8.0,
      height: 148.0,
      scaleX: 6.8026,
      cx: 290.99,
      scaleZ: 6.3988,
      cz: 122.36,
    },
  },
  WindmillAndDampesGrave: {
    placeId: 'cementerio',
    capture: {
      camX: 18.0,
      camY: 200.0,
      camZ: 8.0,
      height: 148.0,
      scaleX: 6.8026,
      cx: 290.99,
      scaleZ: 6.3988,
      cz: 122.36,
    },
  },
  DeathMountainTrail: {
    placeId: 'sendero',
    capture: {
      camX: -21.0,
      camY: 200.0,
      camZ: -36.0,
      height: 390.0,
      scaleX: 7.5379,
      cx: 644.3,
      scaleZ: 8.0032,
      cz: 1341.65,
    },
  },
  GoronCity: {
    placeId: 'goron',
    capture: {
      camX: -5.0,
      camY: 150.0,
      camZ: 0.0,
      height: 156.0,
      scaleX: 8.97,
      cx: 463.57,
      scaleZ: 9.1644,
      cz: 502.25,
    },
  },
  DeathMountainCrater: {
    placeId: 'crater',
    capture: {
      camX: -12.0,
      camY: 200.0,
      camZ: 12.0,
      height: 188.0,
      scaleX: 7.5556,
      cx: 535.67,
      scaleZ: 7.0278,
      cz: 376.06,
    },
  },
  ZoraRiver: {
    placeId: 'rio',
    capture: {
      camX: 20.0,
      camY: 200.0,
      camZ: -15.0,
      height: 265.0,
      scaleX: 3.2759,
      cx: 352.05,
      scaleZ: 3.2953,
      cz: 225.64,
    },
  },
  ZorasRiver: {
    placeId: 'rio',
    capture: {
      camX: 20.0,
      camY: 200.0,
      camZ: -15.0,
      height: 265.0,
      scaleX: 3.2759,
      cx: 352.05,
      scaleZ: 3.2953,
      cz: 225.64,
    },
  },
  ZoraDomain: {
    placeId: 'dominio',
    capture: {
      camX: 30.0,
      camY: 225.0,
      camZ: -14.0,
      height: 151.0,
      scaleX: 6.4055,
      cx: 218.87,
      scaleZ: 6.3045,
      cz: 315.57,
    },
  },
  ZorasDomain: {
    placeId: 'dominio',
    capture: {
      camX: 30.0,
      camY: 225.0,
      camZ: -14.0,
      height: 151.0,
      scaleX: 6.4055,
      cx: 218.87,
      scaleZ: 6.3045,
      cz: 315.57,
    },
  },
  ZoraFountain: {
    placeId: 'fuente',
    capture: {
      camX: 30.0,
      camY: 200.0,
      camZ: -13.0,
      height: 195.0,
      scaleX: 7.0485,
      cx: 200.7,
      scaleZ: 7.1346,
      cz: 527.48,
    },
  },
  ZorasFountain: {
    placeId: 'fuente',
    capture: {
      camX: 30.0,
      camY: 200.0,
      camZ: -13.0,
      height: 195.0,
      scaleX: 7.0485,
      cx: 200.7,
      scaleZ: 7.1346,
      cz: 527.48,
    },
  },
  LakeHylia: {
    placeId: 'lago',
    capture: {
      camX: -200.0,
      camY: 200.0,
      camZ: 490.0,
      height: 422.0,
      scaleX: 2.9309,
      cx: 995.76,
      scaleZ: 3.044,
      cz: -1162.42,
    },
  },
  GerudoValley: {
    placeId: 'valle',
    capture: {
      camX: 0.0,
      camY: 200.0,
      camZ: -13.0,
      height: 240.0,
      scaleX: 5.2663,
      cx: 412.17,
      scaleZ: 5.2871,
      cz: 480.49,
    },
  },
  GerudoFortress: {
    placeId: 'fortaleza',
    defaultAge: 'adult',
    capture: {
      camX: 86.0,
      camY: 130.0,
      camZ: -22.0,
      height: 340.0,
      scaleX: 3.0667,
      cx: 199.04,
      scaleZ: 3.0306,
      cz: 421.96,
    },
  },
  GerudosFortress: {
    placeId: 'fortaleza',
    defaultAge: 'adult',
    capture: {
      camX: 86.0,
      camY: 130.0,
      camZ: -22.0,
      height: 340.0,
      scaleX: 3.0667,
      cx: 199.04,
      scaleZ: 3.0306,
      cz: 421.96,
    },
  },
  ThievesHideout: {
    placeId: 'fortaleza',
    defaultAge: 'adult',
    capture: {
      camX: 86.0,
      camY: 130.0,
      camZ: -22.0,
      height: 340.0,
      scaleX: 3.0667,
      cx: 199.04,
      scaleZ: 3.0306,
      cz: 421.96,
    },
  },
  HountedWasteland: {
    placeId: 'desierto',
    defaultAge: 'adult',
    capture: { camX: 6.0, camY: 100.0, camZ: -52.0, height: 645.0, scaleX: 2.2, cx: 307, scaleZ: 2.2, cz: 307 },
  },
  HauntedWasteland: {
    placeId: 'desierto',
    defaultAge: 'adult',
    capture: { camX: 6.0, camY: 100.0, camZ: -52.0, height: 645.0, scaleX: 2.2, cx: 307, scaleZ: 2.2, cz: 307 },
  },
  DesertColossus: {
    placeId: 'coloso',
    capture: {
      camX: -88.0,
      camY: 200.0,
      camZ: 12.0,
      height: 305.0,
      scaleX: 3.8733,
      cx: 790.51,
      scaleZ: 4.0488,
      cz: 279.89,
    },
  },
  InsideTheDekuTree: {
    placeId: 'deku',
    defaultAge: 'child',
    capture: {
      camX: -36.0,
      camY: 200.0,
      camZ: 18.0,
      height: 125.0,
      scaleX: 8.5609,
      cx: 733.86,
      scaleZ: 8.9211,
      cz: 139.64,
    },
  },
  DekuTree: {
    placeId: 'deku',
    defaultAge: 'child',
    capture: {
      camX: -36.0,
      camY: 200.0,
      camZ: 18.0,
      height: 125.0,
      scaleX: 8.5609,
      cx: 733.86,
      scaleZ: 8.9211,
      cz: 139.64,
    },
  },
  DodongoCavern: {
    placeId: 'dodongos',
    capture: {
      camX: 31.0,
      camY: 115.0,
      camZ: -30.0,
      height: 256.0,
      scaleX: 4.2462,
      cx: 284.07,
      scaleZ: 4.2462,
      cz: 505.86,
    },
  },
  DodongosCavern: {
    placeId: 'dodongos',
    capture: {
      camX: 31.0,
      camY: 115.0,
      camZ: -30.0,
      height: 256.0,
      scaleX: 4.2462,
      cx: 284.07,
      scaleZ: 4.2462,
      cz: 505.86,
    },
  },
  InsideJabuJabuBelly: {
    placeId: 'jabu',
    defaultAge: 'child',
    capture: { camX: -1.0, camY: 200.0, camZ: -92.0, height: 328.0 },
  },
  JabuJabusBelly: {
    placeId: 'jabu',
    defaultAge: 'child',
    capture: { camX: -1.0, camY: 200.0, camZ: -92.0, height: 328.0 },
  },
  ForestTemple: {
    placeId: 'bosque',
    defaultAge: 'adult',
    capture: {
      camX: -3.0,
      camY: 200.0,
      camZ: 6.0,
      height: 245.0,
      scaleX: 5.5747,
      cx: 462.29,
      scaleZ: 5.6324,
      cz: 406.55,
    },
  },
  FireTemple: {
    placeId: 'fuego',
    defaultAge: 'adult',
    capture: {
      camX: 17.0,
      camY: 200.0,
      camZ: -3.0,
      height: 220.0,
      scaleX: 3.965,
      cx: 354.2,
      scaleZ: 3.9651,
      cz: 218.31,
    },
  },
  WaterTemple: {
    placeId: 'agua',
    defaultAge: 'adult',
    capture: {
      camX: -24.0,
      camY: 200.0,
      camZ: -45.0,
      height: 263.0,
      scaleX: 4.9626,
      cx: 524.8,
      scaleZ: 4.9061,
      cz: 655.73,
    },
  },
  ShadowTemple: {
    placeId: 'sombra',
    defaultAge: 'adult',
    capture: {
      camX: -22.0,
      camY: 200.0,
      camZ: 7.0,
      height: 433.0,
      scaleX: 1.9291,
      cx: 467.09,
      scaleZ: 1.9529,
      cz: 259.55,
    },
  },
  SpiritTemple: {
    placeId: 'espiritu',
    capture: {
      camX: 0.0,
      camY: 200.0,
      camZ: -24.0,
      height: 202.0,
      // Least-squares fit against Spirit Temple's 5 Gold Skulltulas & Entrance Anchor in SVG space
      scaleX: 6.0705,
      cx: 423.4,
      scaleZ: 6.4032,
      cz: 594.39,
    },
  },
  BottomOfTheWell: {
    placeId: 'pozo',
    defaultAge: 'child',
    capture: {
      camX: -12.0,
      camY: 200.0,
      camZ: -32.0,
      height: 238.0,
      scaleX: 8.0269,
      cx: 535.33,
      scaleZ: 8.1374,
      cz: 945.29,
    },
  },
  IceCavern: {
    placeId: 'hielo',
    defaultAge: 'adult',
    capture: {
      camX: 11.0,
      camY: 110.0,
      camZ: 12.0,
      height: 287.0,
      scaleX: 5.2876,
      cx: 337.98,
      scaleZ: 5.1869,
      cz: 469.16,
    },
  },
  GerudoTrainingGround: {
    placeId: 'gerudo',
    defaultAge: 'adult',
    capture: { camX: 21.0, camY: 130.0, camZ: -57.0, height: 190.0 },
  },
  GanonCastle: {
    placeId: 'ganon',
    defaultAge: 'adult',
    capture: { camX: 61.0, camY: 200.0, camZ: 297.0, height: 268.0 },
  },
  InsideGanonCastle: {
    placeId: 'ganon',
    defaultAge: 'adult',
    capture: { camX: 0.0, camY: 500.0, camZ: -22.0, height: 380.0 },
  },
  InsideGanonsCastle: {
    placeId: 'ganon',
    defaultAge: 'adult',
    capture: { camX: 0.0, camY: 500.0, camZ: -22.0, height: 380.0 },
  },
  GanonsTower: {
    placeId: 'ganon',
    defaultAge: 'adult',
    capture: { camX: 0.0, camY: 500.0, camZ: -22.0, height: 380.0 },
  },
  CrumblingGanonCastle: {
    placeId: 'ganon',
    defaultAge: 'adult',
    capture: { camX: 0.0, camY: 500.0, camZ: -22.0, height: 380.0 },
  },
}

type ViewBox = { vx: number; vy: number; vw: number; vh: number }
const svgViewBoxCache = new Map<string, ViewBox>()
let customStaticAssetRoots: string[] = []

/** Registers static asset roots (such as dist/client) for SVG viewBox resolution in standalone mode. */
export function setStaticAssetRoots(roots: string[]): void {
  customStaticAssetRoots = roots.filter(Boolean).map((r) => path.resolve(r))
  svgViewBoxCache.clear()
}

function getStaticAssetRoots(): string[] {
  const roots: string[] = [...customStaticAssetRoots]
  const distDirEnv = process.env.APP_DIST_DIR?.trim()
  if (distDirEnv) {
    roots.push(path.join(path.resolve(distDirEnv), 'client'))
  }
  roots.push(path.resolve(process.cwd(), 'public'))
  roots.push(path.resolve(process.cwd(), 'dist', 'client'))
  return Array.from(new Set(roots))
}

function getSvgViewBox(imagePath: string): ViewBox | null {
  const cached = svgViewBoxCache.get(imagePath)
  if (cached) return cached
  const relPath = imagePath.replace(/^\/+/, '')
  try {
    for (const root of getStaticAssetRoots()) {
      const fullPath = path.resolve(root, relPath)
      if (!fullPath.startsWith(root + path.sep) || !fs.existsSync(fullPath)) continue
      const head = fs.readFileSync(fullPath, 'utf8').slice(0, 512)
      const match = head.match(/viewBox="([^"]+)"/)
      if (!match?.[1]) continue
      const parts = match[1].trim().split(/\s+/).map(Number)
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2]! > 0 && parts[3]! > 0) {
        const vb: ViewBox = { vx: parts[0]!, vy: parts[1]!, vw: parts[2]!, vh: parts[3]! }
        svgViewBoxCache.set(imagePath, vb)
        return vb
      }
    }
  } catch {
    // Ignore read errors
  }
  return null
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function normalizeSceneName(rawScene: string | null): {
  scene: string | null
  ageHint: 'child' | 'adult' | null
} {
  if (!rawScene) return { scene: null, ageHint: null }
  let cleaned = rawScene.trim()
  // Extract from paths like "Work/Banc/Scene/SpiritTemple/SpiritTemple.bcett.json" or "SpiritTemple/SpiritTemple"
  const bcettMatch = cleaned.match(/Scene\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)/)
  if (bcettMatch) {
    cleaned = bcettMatch[2] || bcettMatch[1] || cleaned
  } else if (cleaned.includes('/')) {
    const parts = cleaned.split('/').filter(Boolean)
    cleaned = parts[parts.length - 1] ?? cleaned
  }
  cleaned = cleaned.replace(/\.(bcett|json|byml|bgyml).*$/i, '')

  let ageHint: 'child' | 'adult' | null = null
  if (/_Child(_Alternative)?$/i.test(cleaned)) {
    ageHint = 'child'
    cleaned = cleaned.replace(/_Child(_Alternative)?$/i, '')
  } else if (/_Adult(_Alternative)?$/i.test(cleaned)) {
    ageHint = 'adult'
    cleaned = cleaned.replace(/_Adult(_Alternative)?$/i, '')
  }

  return { scene: cleaned || null, ageHint }
}

export function determineDungeonFloor(placeId: string, y: number): string {
  switch (placeId) {
    case 'espiritu': // Spirit Temple: 1F/PB (Y < 109.5), 2F/P1 (109.5 <= Y < 127.5), 3F/P2 (127.5 <= Y < 148.0), 4F/P3 (Y >= 148.0)
      if (y < 109.5) return '1F'
      if (y < 127.5) return '2F'
      if (y < 148.0) return '3F'
      return '4F'
    case 'deku': // Inside the Deku Tree: S2, S1, 1F, 2F, 3F (TransY: 45, 73, 93.5, 106.5, 118)
      if (y < 70.0) return 'S2'
      if (y < 90.0) return 'S1'
      if (y < 104.0) return '1F'
      if (y < 115.0) return '2F'
      return '3F'
    case 'dodongos': // Dodongo's Cavern: 1F, 2F (TransY: 90.36, 108.02)
      return y < 105.0 ? '1F' : '2F'
    case 'jabu': // Jabu-Jabu's Belly: S1, 1F, 2F (TransY: 66.24, 88.52, 95.92)
      if (y < 85.0) return 'S1'
      if (y < 94.0) return '1F'
      return '2F'
    case 'bosque': // Forest Temple: S2, S1, 1F, 2F, 3F (TransY: 55.42, 69.17, 94.52, 112.2, 122.54)
      if (y < 66.0) return 'S2'
      if (y < 90.0) return 'S1'
      if (y < 109.0) return '1F'
      if (y < 120.0) return '2F'
      return '3F'
    case 'fuego': // Fire Temple: 1F..5F (TransY: 99.9, 126.95, 145.01, 166.91, 185.4)
      if (y < 124.0) return '1F'
      if (y < 142.0) return '2F'
      if (y < 164.0) return '3F'
      if (y < 182.0) return '4F'
      return '5F'
    case 'agua': // Water Temple: S1, 1F, 2F, 3F (TransY: 85.0, 96.97, 108.7, 115.61)
      if (y < 95.0) return 'S1'
      if (y < 106.0) return '1F'
      if (y < 114.0) return '2F'
      return '3F'
    case 'sombra': // Shadow Temple: S4, S3, S2, S1 (TransY: -47.15, 49.34, 72.85, 89.85)
      if (y < 45.0) return 'S4'
      if (y < 70.0) return 'S3'
      if (y < 87.0) return 'S2'
      return 'S1'
    case 'pozo': // Bottom of the Well: S2, S1 (TransY: 82.65, 96.04)
      return y < 94.0 ? 'S2' : 'S1'
    case 'hielo':
      return 'principal'
    default:
      return '1F'
  }
}

export function determineMapId(place: Place, age: 'child' | 'adult' | null, y: number | null): string | null {
  if (place.maps.length === 0) return null
  if (place.maps.length === 1) return place.maps[0]!.id
  const mapIds = new Set(place.maps.map((m) => m.id))
  if (mapIds.has('nino') && mapIds.has('adulto')) {
    return age === 'child' ? 'nino' : 'adulto'
  }
  if (y !== null && Number.isFinite(y)) {
    const floor = determineDungeonFloor(place.id, y)
    if (mapIds.has(floor)) return floor
  }
  return place.startMap ?? place.maps[0]!.id
}

/**
 * Routes seamless overworld `HyruleField.bcett` coordinates into `LonLonRanch` or
 * `LakeHylia` when the player is inside those sub-regions.
 */
export function resolveEffectiveScene(
  sceneKey: string | null,
  x: number | null,
  z: number | null,
): string | null {
  if (sceneKey !== 'HyruleField' || x === null || z === null) return sceneKey
  if (x >= -165 && x <= -14 && z >= 186 && z <= 305) return 'LonLonRanch'
  if (x >= -350 && x <= -40 && z >= 395 && z <= 620) return 'LakeHylia'
  return sceneKey
}

export function projectToPlaceMap(
  sceneKey: string,
  place: Place,
  mapId: string | null,
  x: number,
  z: number,
): Fraction | null {
  if (!mapId) return null
  const placeMap = place.maps.find((m) => m.id === mapId) ?? place.maps[0]
  if (!placeMap) return null

  const sceneInfo = SCENE_TO_PLACE[sceneKey]
  const cap = sceneInfo?.captureByMapId?.[placeMap.id] ?? sceneInfo?.capture
  const vb = getSvgViewBox(placeMap.image)

  if (cap && vb) {
    const scaleX = cap.scaleX ?? 1260.0 / cap.height
    const scaleZ = cap.scaleZ ?? 1260.0 / cap.height
    // Default capture origin to the SVG viewBox center when explicit cx/cz calibration is absent.
    const cx = cap.cx ?? vb.vx + vb.vw / 2 - cap.camX * scaleX
    const cz = cap.cz ?? vb.vy + vb.vh / 2 - cap.camZ * scaleZ

    const sx = cx + x * scaleX
    const sy = cz + z * scaleZ

    const fx = clamp((sx - vb.vx) / vb.vw, 0.02, 0.98)
    const fy = clamp((sy - vb.vy) / vb.vh, 0.02, 0.98)
    return {
      x: Number(fx.toFixed(4)),
      y: Number(fy.toFixed(4)),
    }
  }

  if (cap) {
    const width = cap.height * placeMap.aspect
    const fx = clamp(0.5 + (x - cap.camX) / width, 0.02, 0.98)
    const fy = clamp(0.5 + (z - cap.camZ) / cap.height, 0.02, 0.98)
    return {
      x: Number(fx.toFixed(4)),
      y: Number(fy.toFixed(4)),
    }
  }

  return { x: 0.5, y: 0.5 }
}

export function projectToWorldMap(place: Place, mapFraction: Fraction | null): Fraction {
  if (!mapFraction) return { ...place.pin }
  const spread = place.id === 'llanura' ? 0.14 : place.kind === 'zone' ? 0.035 : 0.018
  return {
    x: Number(clamp(place.pin.x + (mapFraction.x - 0.5) * spread, 0.02, 0.98).toFixed(4)),
    y: Number(clamp(place.pin.y + (mapFraction.y - 0.5) * spread, 0.02, 0.98).toFixed(4)),
  }
}
