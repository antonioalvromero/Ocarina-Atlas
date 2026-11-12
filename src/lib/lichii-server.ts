import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { Plugin } from 'vite'
import { dataset } from './data'
import type { LichiiTelemetryState } from './lichii-types'
import type { Fraction, Place } from './types'

const DEFAULT_LICHII_HOST = '127.0.0.1'
const DEFAULT_LICHII_PORT = 6545
const OOT_REMAKE_TITLE_ID = '0400486024DEC000'

/** Resolves the Lichii TCP debug host from LICHII_HOST (default '127.0.0.1'). */
export function getLichiiHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.LICHII_HOST?.trim()
  return raw ? raw : DEFAULT_LICHII_HOST
}

/** Parses a TCP port string into 1..65535, falling back when unset or invalid. */
export function parseLichiiPort(raw: string | undefined, fallback = DEFAULT_LICHII_PORT): number {
  const trimmed = raw?.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback
  const port = Number.parseInt(trimmed, 10)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : fallback
}

/** Resolves the Lichii TCP debug port from LICHII_PORT (default 6545). */
export function getLichiiPort(env: NodeJS.ProcessEnv = process.env): number {
  return parseLichiiPort(env.LICHII_PORT, DEFAULT_LICHII_PORT)
}

/**
 * Returns candidate Lichii save root directories in priority order:
 * explicit LICHII_SAVE_DIR override first, then %APPDATA%\lichii\nand\user\save\0000000000000000.
 */
export function getCandidateSaveDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs: string[] = []
  const explicit = env.LICHII_SAVE_DIR?.trim()
  if (explicit) {
    dirs.push(path.resolve(explicit))
  }
  const appData = env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming')
  const defaultBase = path.join(appData, 'lichii', 'nand', 'user', 'save', '0000000000000000')
  if (!dirs.includes(defaultBase)) {
    dirs.push(defaultBase)
  }
  return dirs
}

type MapCaptureConfig = {
  camX: number
  camY: number
  camZ: number
  height: number
  cx?: number
  cz?: number
  scaleX?: number
  scaleZ?: number
}

/**
 * Scene / BancName to oot.json placeId and orthographic capture parameters
 * from Game/MapCaptureInfo/MapCaptureInfo.game__MapCaptureInfo.bgyml
 * and Game/UI/MapMenuInfo.game__ui__MapMenuInfo.bgyml.
 */
const SCENE_TO_PLACE: Record<
  string,
  {
    placeId: string
    defaultAge?: 'child' | 'adult'
    capture?: MapCaptureConfig
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
    capture: { camX: 6.0, camY: 200.0, camZ: -1.0, height: 400.0 },
  },
  LostWoods: {
    placeId: 'perdido',
    capture: { camX: 6.0, camY: 200.0, camZ: -1.0, height: 400.0 },
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
    capture: { camX: -23.0, camY: 200.0, camZ: 197.0, height: 736.0 },
  },
  LonLonRanch: {
    placeId: 'lonlon',
    capture: { camX: -86.0, camY: 200.0, camZ: 239.0, height: 276.0 },
  },
  Market: {
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
  MarketEntrance: {
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
  BackAlley: {
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
  TempleOfTimeExterior: {
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
  TempleOfTime: {
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
  },
  CastleGrounds: {
    placeId: 'castillo',
    capture: { camX: 0.0, camY: 200.0, camZ: -80.0, height: 242.0 },
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
      scaleZ: 6.5707,
      cz: 500.06,
    },
  },
  DeathMountainCrater: {
    placeId: 'crater',
    capture: {
      camX: -12.0,
      camY: 200.0,
      camZ: 12.0,
      height: 188.0,
      scaleX: 3.3323,
      cx: 522.18,
      scaleZ: 7.436,
      cz: 368.77,
    },
  },
  ZoraRiver: {
    placeId: 'rio',
    capture: { camX: 20.0, camY: 200.0, camZ: -15.0, height: 265.0 },
  },
  ZorasRiver: {
    placeId: 'rio',
    capture: { camX: 20.0, camY: 200.0, camZ: -15.0, height: 265.0 },
  },
  ZoraDomain: {
    placeId: 'dominio',
    capture: { camX: 30.0, camY: 225.0, camZ: -14.0, height: 151.0 },
  },
  ZorasDomain: {
    placeId: 'dominio',
    capture: { camX: 30.0, camY: 225.0, camZ: -14.0, height: 151.0 },
  },
  ZoraFountain: {
    placeId: 'fuente',
    capture: { camX: 30.0, camY: 200.0, camZ: -13.0, height: 195.0 },
  },
  ZorasFountain: {
    placeId: 'fuente',
    capture: { camX: 30.0, camY: 200.0, camZ: -13.0, height: 195.0 },
  },
  LakeHylia: {
    placeId: 'lago',
    capture: {
      camX: -200.0,
      camY: 200.0,
      camZ: 490.0,
      height: 422.0,
      scaleX: 2.9336,
      cx: 976.97,
      scaleZ: 2.7077,
      cz: -996.48,
    },
  },
  GerudoValley: {
    placeId: 'valle',
    capture: {
      camX: 0.0,
      camY: 200.0,
      camZ: -13.0,
      height: 240.0,
      scaleX: 5.5131,
      cx: 410.1,
      scaleZ: 5.6454,
      cz: 500.3,
    },
  },
  GerudoFortress: {
    placeId: 'fortaleza',
    defaultAge: 'adult',
    capture: { camX: 86.0, camY: 130.0, camZ: -22.0, height: 340.0 },
  },
  GerudosFortress: {
    placeId: 'fortaleza',
    defaultAge: 'adult',
    capture: { camX: 86.0, camY: 130.0, camZ: -22.0, height: 340.0 },
  },
  ThievesHideout: {
    placeId: 'fortaleza',
    defaultAge: 'adult',
    capture: { camX: 86.0, camY: 130.0, camZ: -22.0, height: 340.0 },
  },
  HountedWasteland: {
    placeId: 'desierto',
    defaultAge: 'adult',
    capture: { camX: 6.0, camY: 100.0, camZ: -52.0, height: 645.0 },
  },
  HauntedWasteland: {
    placeId: 'desierto',
    defaultAge: 'adult',
    capture: { camX: 6.0, camY: 100.0, camZ: -52.0, height: 645.0 },
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
    capture: { camX: -36.0, camY: 200.0, camZ: 18.0, height: 125.0 },
  },
  DekuTree: {
    placeId: 'deku',
    defaultAge: 'child',
    capture: { camX: -36.0, camY: 200.0, camZ: 18.0, height: 125.0 },
  },
  DodongoCavern: {
    placeId: 'dodongos',
    capture: { camX: 31.0, camY: 115.0, camZ: -30.0, height: 256.0 },
  },
  DodongosCavern: {
    placeId: 'dodongos',
    capture: { camX: 31.0, camY: 115.0, camZ: -30.0, height: 256.0 },
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

/**
 * Known Gold Skulltula 64-bit InstanceIDs from MapIconInfo.bgyml mapped to oot.json item IDs.
 * Every Gold Skulltula has two paired 64-bit IDs (h and h ^ 2) in GameDataMgr's flag table.
 */
export const KNOWN_SKULLTULA_HASH_MAP: Array<{ hashes: bigint[]; itemIds: string[] }> = [
  // Spirit Temple
  { hashes: [0x9222e742b73d3d2cn, 0x9222e742b73d3d2en], itemIds: ['espiritu-gs-01'] },
  { hashes: [0xb3d9f353599eea51n, 0xb3d9f353599eea53n], itemIds: ['espiritu-gs-02'] },
  { hashes: [0x8c8bb95471d20d00n, 0x8c8bb95471d20d02n], itemIds: ['espiritu-gs-03'] },
  { hashes: [0x70b0fca66ca48088n, 0x70b0fca66ca4808an], itemIds: ['espiritu-gs-04'] },
  { hashes: [0x4696b2730de0516cn, 0x4696b2730de0516en], itemIds: ['espiritu-gs-05'] },
  // Kokiri Forest
  { hashes: [0xecdc46b409ed7d38n, 0xecdc46b409ed7d3an], itemIds: ['kokiri-gs-01'] },
  { hashes: [0x858f5000ad57b2ccn, 0x858f5000ad57b2cen], itemIds: ['kokiri-gs-02'] },
  { hashes: [0x62c340f0b876c195n, 0x62c340f0b876c197n], itemIds: ['kokiri-gs-03'] },
  // Sacred Forest Meadow
  { hashes: [0xc8db3346f78ea31bn, 0xc8db3346f78ea319n], itemIds: ['prado-gs-01'] },
  // Hyrule Castle Town
  { hashes: [0x7c1a05315f83c34dn, 0x7c1a05315f83c34fn], itemIds: ['ciudadela-gs-01'] },
  // Kakariko Village
  { hashes: [0xc3c68d0ac4b85831n, 0xc3c68d0ac4b85833n], itemIds: ['kakariko-gs-01'] },
  { hashes: [0x6a8d9b2373d08fcbn, 0x6a8d9b2373d08fc9n], itemIds: ['kakariko-gs-02'] },
  { hashes: [0xd1cef51cf294fb86n, 0xd1cef51cf294fb84n], itemIds: ['kakariko-gs-03'] },
  { hashes: [0xa1632e322c612b97n, 0xa1632e322c612b95n], itemIds: ['kakariko-gs-04'] },
  { hashes: [0xd4883a16973b1d06n, 0xd4883a16973b1d04n], itemIds: ['kakariko-gs-05'] },
  { hashes: [0x2df265292516bdf0n, 0x2df265292516bdf2n], itemIds: ['kakariko-gs-06'] },
  // Graveyard
  { hashes: [0x032f42f523be6425n, 0x032f42f523be6427n], itemIds: ['cementerio-gs-01'] },
  { hashes: [0xe91f6be796358ffcn, 0xe91f6be796358ffen], itemIds: ['cementerio-gs-02'] },
  // Death Mountain Trail
  { hashes: [0xf1d32c06612da232n, 0xf1d32c06612da230n], itemIds: ['sendero-gs-01'] },
  { hashes: [0x04e03ac27985e328n, 0x04e03ac27985e32an], itemIds: ['sendero-gs-02'] },
  { hashes: [0xf5359b24fc86ac22n, 0xf5359b24fc86ac20n], itemIds: ['sendero-gs-03'] },
  { hashes: [0x0b8e43abfa0b5f86n, 0x0b8e43abfa0b5f84n], itemIds: ['sendero-gs-04'] },
  // Goron City
  { hashes: [0x07e6e21142cc54dbn, 0x07e6e21142cc54d9n], itemIds: ['goron-gs-01'] },
  { hashes: [0xfbbc2d490276c68en, 0xfbbc2d490276c68cn], itemIds: ['goron-gs-02'] },
  // Death Mountain Crater
  { hashes: [0xfcd7f04dcf755e8en, 0xfcd7f04dcf755e8cn], itemIds: ['crater-gs-01'] },
  { hashes: [0x58c75badf059ca54n, 0x58c75badf059ca56n], itemIds: ['crater-gs-02'] },
  // Lake Hylia
  { hashes: [0x61576befd16c499an, 0x61576befd16c4998n], itemIds: ['lago-gs-01'] },
  { hashes: [0xc1858a4fcd84a28en, 0xc1858a4fcd84a28cn], itemIds: ['lago-gs-02'] },
  { hashes: [0x781e0de8eed42373n, 0x781e0de8eed42371n], itemIds: ['lago-gs-03'] },
  { hashes: [0x6689bdebc95368ebn, 0x6689bdebc95368e9n], itemIds: ['lago-gs-04'] },
  { hashes: [0x0af4d6f063d3ae9fn, 0x0af4d6f063d3ae9dn], itemIds: ['lago-gs-05'] },
  // Gerudo Valley
  { hashes: [0xd3d86d3d6988ed8cn, 0xd3d86d3d6988ed8en], itemIds: ['valle-gs-01'] },
  { hashes: [0x738f5746cc517702n, 0x738f5746cc517700n], itemIds: ['valle-gs-02'] },
  { hashes: [0xbc85efca2b222cd9n, 0xbc85efca2b222cdbn], itemIds: ['valle-gs-03'] },
  { hashes: [0xa017ce09904c2dcen, 0xa017ce09904c2dccn], itemIds: ['valle-gs-04'] },
  // Desert Colossus
  { hashes: [0x0341f2c03598c861n, 0x0341f2c03598c863n], itemIds: ['coloso-gs-01'] },
  { hashes: [0x9ae3d0ac392e6cdan, 0x9ae3d0ac392e6cd8n], itemIds: ['coloso-gs-02'] },
  { hashes: [0xd0f7e5ffa76ba288n, 0xd0f7e5ffa76ba28an], itemIds: ['coloso-gs-03'] },
  // Forest Temple
  { hashes: [0x99ca89963485df11n, 0x99ca89963485df13n], itemIds: ['bosque-gs-01'] },
  { hashes: [0xf46b1710ed0620d1n, 0xf46b1710ed0620d3n], itemIds: ['bosque-gs-02'] },
  { hashes: [0x1bf5f0176ef03bdan, 0x1bf5f0176ef03bd8n], itemIds: ['bosque-gs-03'] },
  { hashes: [0x984021bc20419eben, 0x984021bc20419ebcn], itemIds: ['bosque-gs-04'] },
  { hashes: [0x2aa39f00aaa2d331n, 0x2aa39f00aaa2d333n], itemIds: ['bosque-gs-05'] },
  // Fire Temple
  { hashes: [0x5e3ae6a7cf3ac292n, 0x5e3ae6a7cf3ac290n], itemIds: ['fuego-gs-01'] },
  { hashes: [0xb0f77b17cfb37458n, 0xb0f77b17cfb3745an], itemIds: ['fuego-gs-02'] },
  { hashes: [0x7f498ada1c2e9c7an, 0x7f498ada1c2e9c78n], itemIds: ['fuego-gs-03'] },
  { hashes: [0x4d1b7e35ca0c6484n, 0x4d1b7e35ca0c6486n], itemIds: ['fuego-gs-04'] },
  { hashes: [0xcc175a90e0014905n, 0xcc175a90e0014907n], itemIds: ['fuego-gs-05'] },
  // Water Temple
  { hashes: [0xe03a2965df9f7b30n, 0xe03a2965df9f7b32n], itemIds: ['agua-gs-01'] },
  { hashes: [0xd731ea6a04d0fd01n, 0xd731ea6a04d0fd03n], itemIds: ['agua-gs-02'] },
  { hashes: [0xa0973706f6415ecdn, 0xa0973706f6415ecfn], itemIds: ['agua-gs-03'] },
  { hashes: [0x02974596f92cf377n, 0x02974596f92cf375n], itemIds: ['agua-gs-04'] },
  { hashes: [0x3d0de5adaeb73cc9n, 0x3d0de5adaeb73ccbn], itemIds: ['agua-gs-05'] },
  // Shadow Temple
  { hashes: [0xd23a7a2c9eced9cen, 0xd23a7a2c9eced9ccn], itemIds: ['sombra-gs-01'] },
  { hashes: [0xd7ffbe169189e50dn, 0xd7ffbe169189e50fn], itemIds: ['sombra-gs-02'] },
  { hashes: [0xeafe60e592e9a3fbn, 0xeafe60e592e9a3f9n], itemIds: ['sombra-gs-03'] },
  { hashes: [0x7a74bc651f9fe024n, 0x7a74bc651f9fe026n], itemIds: ['sombra-gs-04'] },
  { hashes: [0x8e87908cb035e950n, 0x8e87908cb035e952n], itemIds: ['sombra-gs-05'] },
  // Bottom of the Well
  { hashes: [0x6789388e9fb9c92cn, 0x6789388e9fb9c92en], itemIds: ['pozo-gs-01'] },
  { hashes: [0xa8d6182a5c956e16n, 0xa8d6182a5c956e14n], itemIds: ['pozo-gs-02'] },
  { hashes: [0x35fb354fac262d36n, 0x35fb354fac262d34n], itemIds: ['pozo-gs-03'] },
  // Ice Cavern
  { hashes: [0x63701a2cf70b201cn, 0x63701a2cf70b201en], itemIds: ['hielo-gs-01'] },
  { hashes: [0xcdb49f5d0a67fcf6n, 0xcdb49f5d0a67fcf4n], itemIds: ['hielo-gs-02'] },
  { hashes: [0x165fc0bc0aca1f6cn, 0x165fc0bc0aca1f6en], itemIds: ['hielo-gs-03'] },
  // Lost Woods
  { hashes: [0x8186bcb07d6c2cf9n, 0x8186bcb07d6c2cfbn], itemIds: ['perdido-gs-01'] },
  { hashes: [0xf6fa6ef0ca152948n, 0xf6fa6ef0ca15294an], itemIds: ['perdido-gs-02'] },
  { hashes: [0x3c2b585ac5c0443en, 0x3c2b585ac5c0443cn], itemIds: ['perdido-gs-03'] },
  // Hyrule Field
  { hashes: [0x1e38e8d23596eecfn, 0x1e38e8d23596eecdn], itemIds: ['llanura-gs-01'] },
  { hashes: [0xa6a4e87da18fa678n, 0xa6a4e87da18fa67an], itemIds: ['llanura-gs-02'] },
  // Lon Lon Ranch
  { hashes: [0x04be4a8ff29f2099n, 0x04be4a8ff29f209bn], itemIds: ['lonlon-gs-01'] },
  { hashes: [0x25e6072d4df023b3n, 0x25e6072d4df023b1n], itemIds: ['lonlon-gs-02'] },
  { hashes: [0xdc8113831c56b194n, 0xdc8113831c56b196n], itemIds: ['lonlon-gs-03'] },
  { hashes: [0x7d8ec14bdd1f6341n, 0x7d8ec14bdd1f6343n], itemIds: ['lonlon-gs-04'] },
  // Hyrule Castle
  { hashes: [0x22c0f7dff5ebb86dn, 0x22c0f7dff5ebb86fn], itemIds: ['castillo-gs-01'] },
  { hashes: [0x7f28485fa5d3688fn, 0x7f28485fa5d3688dn], itemIds: ['castillo-gs-02'] },
  { hashes: [0x4e13cc311cd04df4n, 0x4e13cc311cd04df6n], itemIds: ['castillo-gs-03'] },
  // Zora's River
  { hashes: [0xabad0e9f0d471156n, 0xabad0e9f0d471154n], itemIds: ['rio-gs-01'] },
  { hashes: [0x78ae4fd90b3cfaaan, 0x78ae4fd90b3cfaa8n], itemIds: ['rio-gs-02'] },
  { hashes: [0x97824c2ffeaa877cn, 0x97824c2ffeaa877en], itemIds: ['rio-gs-03'] },
  { hashes: [0x8325fea55edfbe97n, 0x8325fea55edfbe95n], itemIds: ['rio-gs-04'] },
  // Zora's Domain
  { hashes: [0x853b892663c0215dn, 0x853b892663c0215fn], itemIds: ['dominio-gs-01'] },
  // Zora's Fountain
  { hashes: [0x63446d12663daa83n, 0x63446d12663daa81n], itemIds: ['fuente-gs-01'] },
  { hashes: [0xf0dac245e2fc448en, 0xf0dac245e2fc448cn], itemIds: ['fuente-gs-02'] },
  { hashes: [0x845ba51dc18c855en, 0x845ba51dc18c855cn], itemIds: ['fuente-gs-03'] },
  // Gerudo's Fortress
  { hashes: [0xb4ece769e6f3a206n, 0xb4ece769e6f3a204n], itemIds: ['fortaleza-gs-01'] },
  { hashes: [0x81ed4ed76699e3d8n, 0x81ed4ed76699e3dan], itemIds: ['fortaleza-gs-02'] },
  // Haunted Wasteland
  { hashes: [0xceed596f17934971n, 0xceed596f17934973n], itemIds: ['desierto-gs-01'] },
  // Inside the Deku Tree
  { hashes: [0xbce05898ce61f1c0n, 0xbce05898ce61f1c2n], itemIds: ['deku-gs-01'] },
  { hashes: [0xdf73f3739cef466bn, 0xdf73f3739cef4669n], itemIds: ['deku-gs-02'] },
  { hashes: [0xfad8931a0011e1d4n, 0xfad8931a0011e1d6n], itemIds: ['deku-gs-03'] },
  { hashes: [0xf2e27d6a27026acfn, 0xf2e27d6a27026acdn], itemIds: ['deku-gs-04'] },
  // Dodongo's Cavern
  { hashes: [0x10434342a3917ebdn, 0x10434342a3917ebfn], itemIds: ['dodongos-gs-01'] },
  { hashes: [0x758ce7b4868447fbn, 0x758ce7b4868447f9n], itemIds: ['dodongos-gs-02'] },
  { hashes: [0x3f5b150f16d84603n, 0x3f5b150f16d84601n], itemIds: ['dodongos-gs-03'] },
  { hashes: [0xbdfe13c37f356829n, 0xbdfe13c37f35682bn], itemIds: ['dodongos-gs-04'] },
  { hashes: [0x0d53e429a1ef383dn, 0x0d53e429a1ef383fn], itemIds: ['dodongos-gs-05'] },
  // Inside Jabu-Jabu's Belly
  { hashes: [0x9fc92497f014dbd5n, 0x9fc92497f014dbd7n], itemIds: ['jabu-gs-01'] },
  { hashes: [0x9c95fd41b89c058an, 0x9c95fd41b89c0588n], itemIds: ['jabu-gs-02'] },
  { hashes: [0xc03f282ff60942b6n, 0xc03f282ff60942b4n], itemIds: ['jabu-gs-03'] },
  { hashes: [0xddd260afb6f2989an, 0xddd260afb6f29898n], itemIds: ['jabu-gs-04'] },
]

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

function normalizeSceneName(rawScene: string | null): {
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

function determineMapId(place: Place, age: 'child' | 'adult' | null, y: number | null): string | null {
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

function projectToPlaceMap(
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
  const cap = sceneInfo?.capture
  const vb = getSvgViewBox(placeMap.image)

  if (cap && vb) {
    const scaleX = cap.scaleX ?? 1260.0 / cap.height
    const scaleZ = cap.scaleZ ?? 1260.0 / cap.height
    const cx = cap.cx ?? 420.0 - cap.camX * scaleX
    const cz = cap.cz ?? 420.0 - cap.camZ * scaleZ

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

function projectToWorldMap(place: Place, mapFraction: Fraction | null): Fraction {
  if (!mapFraction) return { ...place.pin }
  const spread = place.id === 'llanura' ? 0.14 : place.kind === 'zone' ? 0.035 : 0.018
  return {
    x: Number(clamp(place.pin.x + (mapFraction.x - 0.5) * spread, 0.02, 0.98).toFixed(4)),
    y: Number(clamp(place.pin.y + (mapFraction.y - 0.5) * spread, 0.02, 0.98).toFixed(4)),
  }
}

// ============================================================================
// Save File Reader (caption.sav & progress.sav)
// ============================================================================

const INPLACE_SECTIONS = new Set([1, 3, 5, 7, 21])

type ParsedSaveSlot = {
  slotName: string
  mtimeMs: number
  scene: string | null
  subScene: string | null
  position: { x: number; y: number; z: number; yaw: number } | null
  skulltulaCount: number | null
  lastPickedItem: string | null
  savedHashes: Set<bigint>
}

let cachedSaveSlot: ParsedSaveSlot | null = null
let cachedSaveKey = ''

function readNullTerminatedAscii(buf: Buffer, offset: number, maxLen = 64): string {
  if (offset < 0 || offset >= buf.length) return ''
  const end = Math.min(buf.length, offset + maxLen)
  let i = offset
  while (i < end && buf[i] !== 0) i++
  return buf.subarray(offset, i).toString('ascii').trim()
}

function listSubdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function addSlotIfValid(slotDir: string, slots: Set<string>): void {
  const capPath = path.join(slotDir, 'caption.sav')
  const progPath = path.join(slotDir, 'progress.sav')
  if (fs.existsSync(capPath) || fs.existsSync(progPath)) {
    slots.add(slotDir)
  }
}

function collectSlotsFromTitleDir(titleDir: string, slots: Set<string>): void {
  if (!fs.existsSync(titleDir)) return
  for (const name of listSubdirs(titleDir)) {
    if (name.startsWith('slot_')) {
      addSlotIfValid(path.join(titleDir, name), slots)
    }
  }
}

function collectSlotsFromAccountDir(accountDir: string, slots: Set<string>): void {
  if (!fs.existsSync(accountDir)) return
  for (const userName of listSubdirs(accountDir)) {
    collectSlotsFromTitleDir(path.join(accountDir, userName, OOT_REMAKE_TITLE_ID), slots)
  }
}

function collectSlotsFromSaveBase(saveBaseDir: string, slots: Set<string>): void {
  if (!fs.existsSync(saveBaseDir)) return
  for (const accountName of listSubdirs(saveBaseDir)) {
    collectSlotsFromAccountDir(path.join(saveBaseDir, accountName), slots)
  }
}

function collectSlotsInCandidateRoot(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return []
  const slots = new Set<string>()

  // 1. Direct slot_* folder (or folder directly holding caption.sav / progress.sav)
  addSlotIfValid(rootDir, slots)
  // 2. Title ID folder (0400486024DEC000) containing slot_*
  collectSlotsFromTitleDir(rootDir, slots)
  // 3. Profile folder (<userId>) containing 0400486024DEC000/slot_*
  collectSlotsFromTitleDir(path.join(rootDir, OOT_REMAKE_TITLE_ID), slots)
  // 4. Account folder (0000000000000000) containing <userId>/0400486024DEC000/slot_*
  collectSlotsFromAccountDir(rootDir, slots)

  // 5. Full Lichii root / nand / user / save directory layouts
  const saveRoots = [
    path.join(rootDir, 'nand', 'user', 'save'),
    path.join(rootDir, 'user', 'save'),
    path.join(rootDir, 'save'),
  ]
  if (path.basename(rootDir).toLowerCase() === 'save') {
    saveRoots.push(rootDir)
  }
  for (const saveRoot of saveRoots) {
    collectSlotsFromSaveBase(saveRoot, slots)
  }

  return Array.from(slots)
}

/**
 * Finds the most recently modified save slot directory across candidate save roots
 * (checking explicit LICHII_SAVE_DIR before the default %APPDATA%\lichii path).
 */
export function findLatestSaveSlotDir(
  candidateDirs: string[] = getCandidateSaveDirs(),
): { dir: string; key: string; mtimeMs: number } | null {
  for (const candidateRoot of candidateDirs) {
    const slotDirs = collectSlotsInCandidateRoot(candidateRoot)
    if (slotDirs.length === 0) continue

    let bestDir: string | null = null
    let bestMtime = -1
    let bestKey = ''

    try {
      for (const slotDir of slotDirs) {
        const capPath = path.join(slotDir, 'caption.sav')
        const progPath = path.join(slotDir, 'progress.sav')
        const capStat = fs.existsSync(capPath) ? fs.statSync(capPath) : null
        const progStat = fs.existsSync(progPath) ? fs.statSync(progPath) : null
        if (!capStat && !progStat) continue
        const mtime = Math.max(capStat?.mtimeMs ?? 0, progStat?.mtimeMs ?? 0)
        if (mtime > bestMtime) {
          bestMtime = mtime
          bestDir = slotDir
          bestKey = `${slotDir}:${capStat?.mtimeMs ?? 0}:${progStat?.mtimeMs ?? 0}`
        }
      }
    } catch {
      continue
    }

    if (bestDir) {
      return { dir: bestDir, key: bestKey, mtimeMs: bestMtime }
    }
  }

  return null
}

function parseSaveSlot(slotInfo: { dir: string; key: string; mtimeMs: number }): ParsedSaveSlot | null {
  if (cachedSaveSlot && cachedSaveKey === slotInfo.key) {
    return cachedSaveSlot
  }

  const capPath = path.join(slotInfo.dir, 'caption.sav')
  const progPath = path.join(slotInfo.dir, 'progress.sav')

  let scene: string | null = null
  let subScene: string | null = null
  let pos: { x: number; y: number; z: number } | null = null
  let yaw = 0
  let skulltulaCount: number | null = null
  let lastPickedItem: string | null = null
  const savedHashes = new Set<bigint>()

  try {
    if (fs.existsSync(capPath)) {
      const cap = fs.readFileSync(capPath)
      if (cap.length >= 0x28) {
        const dataOff = cap.readUInt32LE(8)
        for (let off = 0x28; off + 8 <= dataOff && off + 8 <= cap.length; off += 8) {
          const h = cap.readUInt32LE(off)
          const v = cap.readUInt32LE(off + 4)
          if (h === 0xdc941483) {
            skulltulaCount = v
          } else if (h === 0xaccbda17) {
            yaw = cap.readFloatLE(off + 4)
          } else if (h === 0x8b26618e && v + 12 <= cap.length) {
            pos = {
              x: cap.readFloatLE(v),
              y: cap.readFloatLE(v + 4),
              z: cap.readFloatLE(v + 8),
            }
          } else if (h === 0xf74e0e8e && v < cap.length) {
            scene = readNullTerminatedAscii(cap, v, 64) || scene
          } else if (h === 0x0cccc6cd && v < cap.length) {
            subScene = readNullTerminatedAscii(cap, v, 64) || subScene
          }
        }
      }
    }

    if (fs.existsSync(progPath)) {
      const prog = fs.readFileSync(progPath)
      if (prog.length >= 0x28) {
        const dataOff = prog.readUInt32LE(8)
        let sec = 1
        const ptrs: Array<{ off: number; h: number }> = []
        for (let off = 0x28; off + 8 <= dataOff && off + 8 <= prog.length; off += 8) {
          const h = prog.readUInt32LE(off)
          const v = prog.readUInt32LE(off + 4)
          if (h === 0) {
            sec = v + 1
            continue
          }
          const isPtr = !INPLACE_SECTIONS.has(sec)
          if (!isPtr) {
            if (h === 0x04735978) {
              skulltulaCount = v
            } else if (h === 0xa4aee8cd) {
              yaw = prog.readFloatLE(off + 4)
            }
          } else if (v >= dataOff && v < prog.length) {
            ptrs.push({ off: v, h })
          }
        }

        ptrs.sort((a, b) => a.off - b.off)
        for (let i = 0; i < ptrs.length; i++) {
          const curr = ptrs[i]!
          const nextOff = i + 1 < ptrs.length ? ptrs[i + 1]!.off : prog.length
          const blob = prog.subarray(curr.off, nextOff)

          if (curr.h === 0x72c4152b) {
            lastPickedItem = readNullTerminatedAscii(blob, 0, 64) || null
          } else if ((curr.h === 0x960ad56a || curr.h === 0xc884818d) && blob.length >= 12 && !pos) {
            pos = {
              x: blob.readFloatLE(0),
              y: blob.readFloatLE(4),
              z: blob.readFloatLE(8),
            }
          } else if (curr.h === 0x4a6bdb7d && !scene) {
            scene = readNullTerminatedAscii(blob, 0, 32) || null
          } else if (curr.h === 0xa3db7114) {
            for (let k = 0; k + 8 <= blob.length; k += 8) {
              const u64 = blob.readBigUInt64LE(k)
              if (u64 !== 0n) savedHashes.add(u64)
            }
          }
        }
      }
    }
  } catch {
    return null
  }

  const normYaw = ((yaw % 360) + 360) % 360
  const parsed: ParsedSaveSlot = {
    slotName: path.basename(slotInfo.dir),
    mtimeMs: slotInfo.mtimeMs,
    scene,
    subScene,
    position: pos ? { ...pos, yaw: Number(normYaw.toFixed(1)) } : null,
    skulltulaCount,
    lastPickedItem,
    savedHashes,
  }
  cachedSaveKey = slotInfo.key
  cachedSaveSlot = parsed
  return parsed
}

// ============================================================================
// Lichii TCP Debug Client (default 127.0.0.1:6545, configurable via env)
// ============================================================================

type RpcResponse = {
  id?: number
  result?: Record<string, unknown>
  error?: unknown
}

type PendingRpc = {
  method: string
  params: Record<string, unknown>
  timeoutMs: number
  resolve: (val: Record<string, unknown> | null) => void
}

type LichiiRpcClientOptions = {
  host?: string
  port?: number
  onDisconnect?: () => void
}

/**
 * Single persistent, strictly-serialized TCP JSON-RPC client for Lichii's
 * single-threaded Boost.Asio debug server (prevents CLOSE_WAIT/socket exhaustion
 * and 500ms FPS sleep stalls).
 */
export class LichiiRpcClient {
  private readonly explicitHost?: string
  private readonly explicitPort?: number
  private activeHost: string | null = null
  private activePort: number | null = null
  private readonly onDisconnect?: () => void
  private socket: net.Socket | null = null
  private connecting: Promise<boolean> | null = null
  private buffer = ''
  private reqId = 1
  private queue: PendingRpc[] = []
  private inFlight: {
    id: number
    timer: ReturnType<typeof setTimeout>
    resolve: (val: Record<string, unknown> | null) => void
  } | null = null
  private lastConnectFailureAt = 0

  constructor(options: LichiiRpcClientOptions = {}) {
    this.explicitHost = options.host
    this.explicitPort = options.port
    this.onDisconnect = options.onDisconnect
  }

  getHost(): string {
    return this.explicitHost ?? getLichiiHost()
  }

  getPort(): number {
    return this.explicitPort ?? getLichiiPort()
  }

  isConnected(): boolean {
    return Boolean(
      this.socket &&
        !this.socket.destroyed &&
        this.socket.writable &&
        !this.socket.writableEnded &&
        !this.socket.readableEnded,
    )
  }

  close(): void {
    this.resetSocket(false)
  }

  call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 800,
  ): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      if (this.queue.length >= 24) {
        // Drop oldest stale queued reads rather than piling up backlog
        const dropped = this.queue.shift()
        dropped?.resolve(null)
      }
      this.queue.push({ method, params, timeoutMs, resolve })
      void this.pump()
    })
  }

  private async ensureConnected(): Promise<boolean> {
    const targetHost = this.getHost()
    const targetPort = this.getPort()

    if (this.isConnected()) {
      if (this.activeHost === targetHost && this.activePort === targetPort) {
        return true
      }
      this.resetSocket(false)
    }
    if (this.connecting) return this.connecting

    const now = Date.now()
    if (now - this.lastConnectFailureAt < 1000) {
      return false
    }

    this.connecting = new Promise<boolean>((resolve) => {
      const sock = net.createConnection({ host: targetHost, port: targetPort })
      let settled = false
      const settle = (ok: boolean) => {
        if (settled) return
        settled = true
        this.connecting = null
        clearTimeout(connectTimer)
        if (!ok) {
          this.lastConnectFailureAt = Date.now()
          try {
            sock.removeAllListeners()
            sock.destroy()
          } catch {
            // ignore
          }
          if (this.socket === sock) {
            this.socket = null
            this.activeHost = null
            this.activePort = null
          }
          this.onDisconnect?.()
        }
        resolve(ok)
      }

      const connectTimer = setTimeout(() => settle(false), 750)

      sock.setNoDelay(true)
      sock.on('connect', () => {
        this.socket = sock
        this.activeHost = targetHost
        this.activePort = targetPort
        this.buffer = ''
        settle(true)
      })
      sock.on('data', (chunk) => this.handleData(chunk))
      sock.on('error', () => {
        if (this.socket === sock) {
          this.resetSocket(true)
        }
        settle(false)
      })
      sock.on('close', () => {
        if (this.socket === sock) {
          this.resetSocket(true)
        }
        settle(false)
      })
      sock.on('end', () => {
        if (this.socket === sock) {
          this.resetSocket(true)
        }
        settle(false)
      })
    })

    return this.connecting
  }

  private drainQueue() {
    while (this.queue.length > 0) {
      const item = this.queue.shift()
      item?.resolve(null)
    }
  }

  private resetSocket(notifyDisconnect = true) {
    const hadActiveOrPending = Boolean(this.socket || this.inFlight || this.queue.length > 0)
    const sock = this.socket
    this.socket = null
    this.activeHost = null
    this.activePort = null
    if (sock) {
      try {
        sock.removeAllListeners()
        sock.destroy()
      } catch {
        // ignore
      }
    }
    this.buffer = ''

    const pendingInFlight = this.inFlight
    this.inFlight = null
    if (pendingInFlight) {
      clearTimeout(pendingInFlight.timer)
    }

    const queued = this.queue.splice(0, this.queue.length)

    if (notifyDisconnect && hadActiveOrPending) {
      this.onDisconnect?.()
    }

    if (pendingInFlight) {
      pendingInFlight.resolve(null)
    }
    for (const item of queued) {
      item.resolve(null)
    }
  }

  private handleData(chunk: Buffer | string) {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    while (true) {
      const nl = this.buffer.indexOf('\n')
      if (nl === -1) break
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.trim()) continue

      let parsed: (RpcResponse & { id?: number }) | null = null
      try {
        parsed = JSON.parse(line) as RpcResponse & { id?: number }
      } catch {
        parsed = null
      }

      if (this.inFlight && (!parsed?.id || parsed.id === this.inFlight.id)) {
        const cur = this.inFlight
        this.inFlight = null
        clearTimeout(cur.timer)
        cur.resolve(parsed?.result ?? null)
        void this.pump()
      }
    }
  }

  private async pump(): Promise<void> {
    if (this.inFlight || this.queue.length === 0) return

    const ok = await this.ensureConnected()
    if (!ok || !this.isConnected()) {
      this.drainQueue()
      return
    }

    if (this.inFlight || this.queue.length === 0 || !this.socket) return
    const next = this.queue.shift()!
    const id = this.reqId++

    const timer = setTimeout(() => {
      if (this.inFlight?.id === id) {
        this.resetSocket(true)
      }
    }, next.timeoutMs)

    this.inFlight = { id, timer, resolve: next.resolve }
    try {
      const payload = JSON.stringify({ id, method: next.method, params: next.params }) + '\n'
      this.socket.write(payload)
    } catch {
      this.resetSocket(true)
    }
  }
}

const lichiiRpc = new LichiiRpcClient({
  onDisconnect: () => handleRpcDisconnect(),
})

/** Closes any active Lichii RPC socket and clears pending calls during server shutdown. */
export function closeLichiiRpc(): void {
  lichiiRpc.close()
  handleRpcDisconnect()
}

function callLichiiRpc(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 800,
): Promise<Record<string, unknown> | null> {
  return lichiiRpc.call(method, params, timeoutMs)
}

async function readMemoryBuffer(addressHex: string, size: number, timeoutMs = 600): Promise<Buffer | null> {
  if (!addressHex || addressHex === '0x0') return null
  const res = await callLichiiRpc(
    'read_memory',
    { address: addressHex, size, as: 'hex' },
    timeoutMs,
  )
  const hex = typeof res?.hex === 'string' ? res.hex : null
  if (!hex) return null
  return Buffer.from(hex, 'hex')
}

async function searchMemoryOnce(
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok: boolean; hits: string[] }> {
  if (!lichiiRpc.isConnected()) return { ok: false, hits: [] }
  const res = await callLichiiRpc('search_memory', params, timeoutMs)
  if (res === null) return { ok: false, hits: [] }
  const hits = Array.isArray(res.hits)
    ? res.hits.filter((h): h is string => typeof h === 'string')
    : []
  return { ok: true, hits }
}

async function searchHeapWithFallback(options: {
  pattern: string
  start: string
  end: string
  maxHits: number
  fastBudgetMs?: number
  heapBudgetMs?: number
}): Promise<string[]> {
  if (!lichiiRpc.isConnected()) return []
  const fastBudgetMs = options.fastBudgetMs ?? 800
  const heapBudgetMs = options.heapBudgetMs ?? 1500

  const first = await searchMemoryOnce(
    {
      pattern: options.pattern,
      start: options.start,
      end: options.end,
      max_hits: options.maxHits,
      budget_ms: fastBudgetMs,
    },
    Math.max(fastBudgetMs + 300, 1000),
  )
  if (!first.ok || !lichiiRpc.isConnected() || first.hits.length > 0) {
    return first.hits
  }

  const fallback = await searchMemoryOnce(
    {
      pattern: options.pattern,
      regions: 'heap',
      max_hits: options.maxHits,
      budget_ms: heapBudgetMs,
    },
    heapBudgetMs + 300,
  )
  return fallback.hits
}

function bigintToHex(addr: bigint): string {
  return '0x' + addr.toString(16)
}

function u64ToLeHex(val: bigint): string {
  const buf = Buffer.allocUnsafe(8)
  buf.writeBigUInt64LE(val, 0)
  return buf.toString('hex')
}

async function readU64At(addrHex: string, timeoutMs = 400): Promise<bigint> {
  const buf = await readMemoryBuffer(addrHex, 8, timeoutMs)
  if (!buf || buf.length < 8) return 0n
  return buf.readBigUInt64LE(0)
}

// Fast lookup from known Skulltula 64-bit hashes to dataset item IDs
const KNOWN_HASH_TO_ITEM_IDS = new Map<bigint, string[]>()
for (const entry of KNOWN_SKULLTULA_HASH_MAP) {
  for (const h of entry.hashes) {
    const existing = KNOWN_HASH_TO_ITEM_IDS.get(h)
    if (existing) {
      for (const id of entry.itemIds) {
        if (!existing.includes(id)) existing.push(id)
      }
    } else {
      KNOWN_HASH_TO_ITEM_IDS.set(h, [...entry.itemIds])
    }
  }
}

// Cached memory addresses for low-latency polling (reset to 0/0x0 on session reset)
let cachedMainBase = 0n
let lastMainBaseScanTime = 0

let cachedSub36Addr = '0x0'
let cachedParentObjAddr = 0n
let cachedSub7Addr = 0n
let cachedSub23Addr = 0n

let cachedGdmAddr = 0n
let cachedLiveStockAddr = '0x0'
let cachedLiveCountAddr = '0x0'
let cachedLiveGdmCountAddr = '0x0'
let cachedLiveHashesAddr = '0x0'
let cachedMasterFlagTableAddr = '0x0'
let cachedMasterFlagTableCount = 0

let cachedLiveScene: string | null = null
let cachedLiveAgeHint: 'child' | 'adult' | null = null
let cachedLiveSavedHashes = new Set<bigint>()
let cachedMasterCollectedIds: string[] | null = null
let lastHashesReadTime = 0
let lastMasterReadTime = 0
let lastMasterRescanTime = 0
let lastGdmRescanTime = 0
let prevMasterReadCount: number | null = null
let lastAgeReadTime = 0
let lastRescanTime = 0

const MAIN_MOD0_OFFSET = 0x03c4705cn
const MAIN_MOD0_PATTERN_HEX = '4d4f44305467030124fb0f016c342501' // "MOD0" + u32[0x1036754, 0x10ffb24, 0x125346c]
const OWL_MOD0_PATTERN_HEX = '4f776c2e6e7373004d4f4430' // "Owl.nss\0MOD0" (hit + 8 = MOD0)
const MAIN_BASE_RESCAN_THROTTLE_MS = 1500

const MAIN_SUB6_BSS_OFFSET = 0x04e6c7a8n
const MAIN_SUB24_BSS_OFFSET = 0x04e6c938n
const MAIN_GDM_BSS_OFFSET = 0x04e90ce8n

const LEGACY_SUB36_VT1 = 0x84fce818n
const LEGACY_SUB36_VT2 = 0x84311f8cn
const LEGACY_GDM_COUNT_VT = 0x8504de98n
const GDM_STOCK_TAG = 0x20
const GDM_COUNT_TAG = 8
const GDM_STOCK_TOKEN_HASH = 0x04735978
const WORK_BANC_SCENE_PATTERN_HEX = '576f726b2f42616e632f5363656e652f' // "Work/Banc/Scene/"

const MASTER_FLAG_ENTRY_0_HASH = 0x00006e56f79838e8n
const MASTER_FLAG_ENTRY_1_HASH = 0x00006e56f79838ean
const MASTER_FLAG_COLLECTED_BIT = 0x100000000n
const MASTER_FLAG_READ_CHUNK = 32768
const MASTER_FLAG_READ_BYTES = MASTER_FLAG_READ_CHUNK * 6
const MASTER_FLAG_ENTRY_0_HEX = 'e83898f7566e0000'

export type DynamicVtables = {
  sub36Vt1: bigint
  sub36Vt2: bigint
  pObjVt: bigint
  gdmVt: bigint
  gdmStockVt: bigint
  gdmCountVt: bigint
}

/** Validates the Switch main NSO module header (`u32[0] == 1` and `u32[1] == MOD0 offset 0x03c4705c`). */
export function validateMainBaseHeader(buf: Buffer | null): boolean {
  if (!buf || buf.length < 8) return false
  return buf.readUInt32LE(0) === 1 && buf.readUInt32LE(4) === Number(MAIN_MOD0_OFFSET)
}

/** Derives ASLR-adjusted vtable pointers from the discovered main NSO base address. */
export function deriveDynamicVtables(mainBase: bigint): DynamicVtables {
  return {
    sub36Vt1: mainBase + 0x04ba1818n,
    sub36Vt2: mainBase + 0x03ee4f8cn,
    pObjVt: mainBase + 0x04ba27c8n,
    gdmVt: mainBase + 0x04c58270n,
    gdmStockVt: mainBase + 0x04c20718n,
    gdmCountVt: mainBase + 0x04c20e98n,
  }
}

async function validateMod0Hits(hits: string[], mod0Adjust = 0n): Promise<bigint> {
  for (const hit of hits) {
    let hitAddr: bigint
    try {
      hitAddr = BigInt(hit)
    } catch {
      continue
    }
    const mainBase = hitAddr + mod0Adjust - MAIN_MOD0_OFFSET
    if (mainBase <= 0n) continue
    const hdr = await readMemoryBuffer(bigintToHex(mainBase), 8, 500)
    if (validateMainBaseHeader(hdr)) {
      return mainBase
    }
  }
  return 0n
}

async function ensureMainBase(forceRefresh = false): Promise<bigint> {
  if (cachedMainBase !== 0n && !forceRefresh) {
    return cachedMainBase
  }
  const now = Date.now()
  if (!forceRefresh && now - lastMainBaseScanTime < MAIN_BASE_RESCAN_THROTTLE_MS) {
    return 0n
  }
  if (!lichiiRpc.isConnected()) {
    return 0n
  }
  lastMainBaseScanTime = now

  const searchConfigs: Array<{ params: Record<string, unknown>; mod0Adjust: bigint; timeoutMs: number }> = [
    {
      params: {
        pattern: MAIN_MOD0_PATTERN_HEX,
        start: '0x08000000',
        end: '0x200000000',
        regions: 'all',
        max_hits: 4,
        budget_ms: 1000,
      },
      mod0Adjust: 0n,
      timeoutMs: 1300,
    },
    {
      params: {
        pattern: OWL_MOD0_PATTERN_HEX,
        start: '0x08000000',
        end: '0x200000000',
        regions: 'all',
        max_hits: 4,
        budget_ms: 1000,
      },
      mod0Adjust: 8n,
      timeoutMs: 1300,
    },
    {
      params: {
        pattern: MAIN_MOD0_PATTERN_HEX,
        regions: 'all',
        max_hits: 4,
        budget_ms: 1500,
      },
      mod0Adjust: 0n,
      timeoutMs: 1800,
    },
    {
      params: {
        pattern: OWL_MOD0_PATTERN_HEX,
        regions: 'all',
        max_hits: 4,
        budget_ms: 1500,
      },
      mod0Adjust: 8n,
      timeoutMs: 1800,
    },
  ]

  for (const cfg of searchConfigs) {
    if (!lichiiRpc.isConnected()) break
    const res = await searchMemoryOnce(cfg.params, cfg.timeoutMs)
    if (!res.ok) continue
    const found = await validateMod0Hits(res.hits, cfg.mod0Adjust)
    if (found !== 0n) {
      cachedMainBase = found
      return found
    }
  }

  return 0n
}

async function resolveGameDataMgr(mainBase: bigint, vtables: DynamicVtables): Promise<bigint> {
  if (cachedGdmAddr !== 0n) return cachedGdmAddr
  if (mainBase === 0n || !lichiiRpc.isConnected()) return 0n
  const gdmPtr = await readU64At(bigintToHex(mainBase + MAIN_GDM_BSS_OFFSET), 400)
  if (gdmPtr <= 0x2000000000n) return 0n
  const vt = await readU64At(bigintToHex(gdmPtr), 400)
  if (vt !== vtables.gdmVt) return 0n
  cachedGdmAddr = gdmPtr
  return gdmPtr
}

/**
 * Parses GameDataMgr's sorted (uint64 InstanceID, uint64 flags) table.
 * Returns null unless the header matches and all known Skulltulas are present.
 */
export function parseMasterFlagTableBuffer(buf: Buffer): {
  presentItemIds: Set<string>
  collectedItemIds: string[]
} | null {
  if (
    buf.length < 32 ||
    buf.readBigUInt64LE(0) !== MASTER_FLAG_ENTRY_0_HASH ||
    buf.readBigUInt64LE(16) !== MASTER_FLAG_ENTRY_1_HASH
  ) {
    return null
  }
  const presentItemIds = new Set<string>()
  const collectedSet = new Set<string>()
  let prevHash = 0n
  for (let off = 0; off + 16 <= buf.length; off += 16) {
    const h = buf.readBigUInt64LE(off)
    if (h === 0n || (off > 0 && h <= prevHash)) break
    prevHash = h
    const itemIds = KNOWN_HASH_TO_ITEM_IDS.get(h)
    if (!itemIds) continue
    const flags = buf.readBigUInt64LE(off + 8)
    const isCollected = (flags & MASTER_FLAG_COLLECTED_BIT) !== 0n
    for (const id of itemIds) {
      presentItemIds.add(id)
      if (isCollected) collectedSet.add(id)
    }
  }
  if (presentItemIds.size < KNOWN_SKULLTULA_HASH_MAP.length) {
    return null
  }
  return {
    presentItemIds,
    collectedItemIds: Array.from(collectedSet).sort(),
  }
}

function isValidMasterTableHeader(buf: Buffer | null): buf is Buffer {
  return Boolean(
    buf &&
      buf.length >= 32 &&
      buf.readBigUInt64LE(0) === MASTER_FLAG_ENTRY_0_HASH &&
      buf.readBigUInt64LE(16) === MASTER_FLAG_ENTRY_1_HASH,
  )
}

async function resolveMasterTableMetaFromGdm(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<boolean> {
  const gdm = await resolveGameDataMgr(mainBase, vtables)
  if (gdm === 0n) return false
  const tblMeta = await readMemoryBuffer(bigintToHex(gdm + 0xdc0n), 16, 400)
  if (!tblMeta || tblMeta.length < 16) return false
  const count = Number(tblMeta.readBigUInt64LE(0))
  const ptr = tblMeta.readBigUInt64LE(8)
  if (ptr <= 0x2000000000n || count < 100 || count > 65536) return false
  cachedMasterFlagTableAddr = bigintToHex(ptr)
  cachedMasterFlagTableCount = count
  return true
}

async function readMasterFlagTableFirstChunk(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<{ firstChunk: Buffer; totalTargetBytes: number } | null> {
  if (cachedMasterFlagTableAddr === '0x0') {
    await resolveMasterTableMetaFromGdm(mainBase, vtables)
  }

  let totalTargetBytes =
    cachedMasterFlagTableCount > 0
      ? clamp(cachedMasterFlagTableCount * 16, 32, MASTER_FLAG_READ_CHUNK * 12)
      : MASTER_FLAG_READ_BYTES
  let firstChunk = await readMemoryBuffer(
    cachedMasterFlagTableAddr,
    Math.min(MASTER_FLAG_READ_CHUNK, totalTargetBytes),
    600,
  )
  if (isValidMasterTableHeader(firstChunk)) {
    return { firstChunk, totalTargetBytes }
  }

  // Re-try via .bss GameDataMgr pointer in case masterTable moved before resorting to heap scan
  cachedMasterFlagTableAddr = '0x0'
  cachedMasterFlagTableCount = 0
  if (await resolveMasterTableMetaFromGdm(mainBase, vtables)) {
    totalTargetBytes = clamp(cachedMasterFlagTableCount * 16, 32, MASTER_FLAG_READ_CHUNK * 12)
    firstChunk = await readMemoryBuffer(
      cachedMasterFlagTableAddr,
      Math.min(MASTER_FLAG_READ_CHUNK, totalTargetBytes),
      600,
    )
    if (isValidMasterTableHeader(firstChunk)) {
      return { firstChunk, totalTargetBytes }
    }
  }

  const now = Date.now()
  if (!lichiiRpc.isConnected() || now - lastMasterRescanTime <= 2500) return null
  lastMasterRescanTime = now

  const hits = await searchHeapWithFallback({
    pattern: MASTER_FLAG_ENTRY_0_HEX,
    start: '0x2160000000',
    end: '0x21c0000000',
    maxHits: 8,
    fastBudgetMs: 800,
    heapBudgetMs: 1500,
  })

  for (const hit of hits) {
    const candidate = await readMemoryBuffer(hit, MASTER_FLAG_READ_CHUNK, 600)
    if (isValidMasterTableHeader(candidate)) {
      cachedMasterFlagTableAddr = hit
      cachedMasterFlagTableCount = 0
      return { firstChunk: candidate, totalTargetBytes: MASTER_FLAG_READ_BYTES }
    }
  }
  return null
}

async function readMasterFlagCollectedIds(
  now: number,
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<string[] | null> {
  const head = await readMasterFlagTableFirstChunk(mainBase, vtables)
  if (!head) {
    cachedMasterCollectedIds = null
    return null
  }

  const baseAddr = BigInt(cachedMasterFlagTableAddr)
  const chunks: Buffer[] = [head.firstChunk]
  for (let off = head.firstChunk.length; off < head.totalTargetBytes; off += MASTER_FLAG_READ_CHUNK) {
    const prev = chunks[chunks.length - 1]!
    if (prev.length >= 32) {
      const hPrev = prev.readBigUInt64LE(prev.length - 32)
      const hLast = prev.readBigUInt64LE(prev.length - 16)
      if (hLast === 0n || hLast <= hPrev) break
    }
    const readSize = Math.min(MASTER_FLAG_READ_CHUNK, head.totalTargetBytes - off)
    if (readSize < 16) break
    const chunk = await readMemoryBuffer(bigintToHex(baseAddr + BigInt(off)), readSize, 600)
    if (!chunk || chunk.length === 0) break
    chunks.push(chunk)
  }

  const parsed = parseMasterFlagTableBuffer(Buffer.concat(chunks))
  if (!parsed) {
    cachedMasterCollectedIds = null
    return null
  }
  cachedMasterCollectedIds = parsed.collectedItemIds
  lastMasterReadTime = now
  return parsed.collectedItemIds
}

function isValidCoord(x: number, y: number, z: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(z) &&
    Math.abs(x) < 15000 &&
    Math.abs(y) < 15000 &&
    Math.abs(z) < 15000 &&
    (Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001)
  )
}

/** Validates Sub[36] player telemetry struct header vtables and non-zero coordinates. */
export function isValidSub36Buffer(
  buf: Buffer | null,
  expectedVt1 = LEGACY_SUB36_VT1,
  expectedVt2 = LEGACY_SUB36_VT2,
): buf is Buffer {
  if (!buf || buf.length < 0x40) return false
  const vt1 = buf.readBigUInt64LE(0)
  const vt2 = buf.readBigUInt64LE(8)
  if (vt1 !== expectedVt1 || vt2 !== expectedVt2) return false
  const x = buf.readFloatLE(0x1c)
  const y = buf.readFloatLE(0x20)
  const z = buf.readFloatLE(0x24)
  return isValidCoord(x, y, z)
}

/** Validates a GameDataMgr container StockNum entry (vtable gdmStockVt, tag 0x20) and returns its 0..100 count. */
export function parseGdmStockNumBuffer(buf: Buffer | null, expectedVt: bigint): number | null {
  if (!buf || buf.length < 0x24) return null
  if (buf.readBigUInt64LE(0) !== expectedVt || buf.readUInt32LE(8) !== GDM_STOCK_TAG) {
    return null
  }
  const val = buf.readUInt32LE(0x1c)
  return val >= 0 && val <= 100 ? val : null
}

/** Validates a GameDataMgr StockNum count struct (vtable gdmCountVt, tag 8) and returns its 0..100 count. */
export function parseGdmSkulltulaCount(
  buf: Buffer | null,
  expectedVt = LEGACY_GDM_COUNT_VT,
): number | null {
  if (!buf || buf.length < 0x2c) return null
  if (buf.readBigUInt64LE(0) !== expectedVt || buf.readUInt32LE(8) !== GDM_COUNT_TAG) {
    return null
  }
  const val = buf.readUInt32LE(0x20)
  return val >= 0 && val <= 100 ? val : null
}

/**
 * Derives public RPC connectivity, running state, and telemetry source without
 * letting disk saves impersonate an active emulator connection.
 */
export function deriveConnectionStatus(params: {
  tcpConnected: boolean
  emulatorRunning: boolean
  hasLivePosition: boolean
  hasSavePosition: boolean
}): {
  connected: boolean
  emulatorRunning: boolean
  source: 'memory' | 'save' | 'none'
} {
  const connected = params.tcpConnected
  const emulatorRunning = params.tcpConnected && params.emulatorRunning
  const source: 'memory' | 'save' | 'none' =
    emulatorRunning && params.hasLivePosition
      ? 'memory'
      : params.hasSavePosition
        ? 'save'
        : 'none'

  return { connected, emulatorRunning, source }
}

/** Clears stale disk save item names while streaming live RAM telemetry. */
export function deriveLastPickedItem(
  source: 'memory' | 'save' | 'none',
  saveLastPickedItem: string | null,
): string | null {
  return source === 'memory' ? null : saveLastPickedItem
}

type LiveMemoryTelemetry = {
  position: { x: number; y: number; z: number; yaw: number } | null
  scene: string | null
  ageHint: 'child' | 'adult' | null
  masterCollectedIds: string[] | null
  liveSavedHashes: Set<bigint>
  liveSkulltulaCount: number | null
  readFailed: boolean
}

function emptyLiveMemoryTelemetry(readFailed = false): LiveMemoryTelemetry {
  return {
    position: null,
    scene: null,
    ageHint: null,
    masterCollectedIds: null,
    liveSavedHashes: new Set<bigint>(),
    liveSkulltulaCount: null,
    readFailed,
  }
}

async function resolveSubPointersFromPObj(
  pObjPtr: bigint,
  vtables: DynamicVtables,
  validatePObjVt: boolean,
): Promise<{ sub36Ptr: bigint; sub7Ptr: bigint; sub23Ptr: bigint } | null> {
  if (pObjPtr <= 0x2000000000n) return null
  const pObjBuf = await readMemoryBuffer(bigintToHex(pObjPtr), 0x60, 500)
  if (!pObjBuf || pObjBuf.length < 0x60) return null
  if (validatePObjVt && pObjBuf.readBigUInt64LE(0) !== vtables.pObjVt) return null

  const subCount = pObjBuf.readUInt32LE(0x50)
  const subArrPtr = pObjBuf.readBigUInt64LE(0x58)
  if (subCount <= 36 || subCount > 128 || subArrPtr <= 0x2000000000n) return null

  const arrBuf = await readMemoryBuffer(bigintToHex(subArrPtr), subCount * 8, 500)
  if (!arrBuf || arrBuf.length < 37 * 8) return null

  return {
    sub36Ptr: arrBuf.readBigUInt64LE(36 * 8),
    sub7Ptr: arrBuf.readBigUInt64LE(7 * 8),
    sub23Ptr: arrBuf.readBigUInt64LE(23 * 8),
  }
}

async function resolvePlayerFromBss(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<Buffer | null> {
  for (const bssOff of [MAIN_SUB6_BSS_OFFSET, MAIN_SUB24_BSS_OFFSET]) {
    if (!lichiiRpc.isConnected()) return null
    const subSingletonPtr = await readU64At(bigintToHex(mainBase + bssOff), 400)
    if (subSingletonPtr <= 0x2000000000n) continue

    const singletonBuf = await readMemoryBuffer(bigintToHex(subSingletonPtr), 0x18, 400)
    if (!singletonBuf || singletonBuf.length < 0x18) continue
    const pObjPtr = singletonBuf.readBigUInt64LE(0x10)
    const subs = await resolveSubPointersFromPObj(pObjPtr, vtables, true)
    if (!subs || subs.sub36Ptr <= 0x2000000000n) continue

    const subBuf = await readMemoryBuffer(bigintToHex(subs.sub36Ptr), 0x40, 500)
    if (!isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)) continue

    cachedSub36Addr = bigintToHex(subs.sub36Ptr)
    cachedParentObjAddr = pObjPtr
    cachedSub7Addr = subs.sub7Ptr > 0x2000000000n ? subs.sub7Ptr : 0n
    cachedSub23Addr = subs.sub23Ptr > 0x2000000000n ? subs.sub23Ptr : 0n
    return subBuf
  }
  return null
}

async function resolvePlayerViaHeapFallbacks(vtables: DynamicVtables): Promise<Buffer | null> {
  const sub36Pattern = u64ToLeHex(vtables.sub36Vt1) + u64ToLeHex(vtables.sub36Vt2)
  const vtHits = await searchHeapWithFallback({
    pattern: sub36Pattern,
    start: '0x2140000000',
    end: '0x21c0000000',
    maxHits: 8,
    fastBudgetMs: 600,
    heapBudgetMs: 1500,
  })
  for (const hit of vtHits) {
    const candidate = await readMemoryBuffer(hit, 0x40, 500)
    if (isValidSub36Buffer(candidate, vtables.sub36Vt1, vtables.sub36Vt2)) {
      cachedSub36Addr = hit
      cachedParentObjAddr = 0n
      cachedSub7Addr = 0n
      cachedSub23Addr = 0n
      return candidate
    }
  }

  // Zero-vtable fallback: locate Sub[7] via "Work/Banc/Scene/" string anchor and walk back to pObj
  const sceneHits = await searchHeapWithFallback({
    pattern: WORK_BANC_SCENE_PATTERN_HEX,
    start: '0x2140000000',
    end: '0x21c0000000',
    maxHits: 32,
    fastBudgetMs: 800,
    heapBudgetMs: 1500,
  })
  for (const hit of sceneHits) {
    let hitAddr: bigint
    try {
      hitAddr = BigInt(hit)
    } catch {
      continue
    }
    const sub7Candidate = hitAddr - 0x34n
    if (sub7Candidate <= 0x2000000000n) continue
    const sub7Hdr = await readMemoryBuffer(bigintToHex(sub7Candidate), 0x34, 400)
    if (!sub7Hdr || sub7Hdr.length < 0x34) continue
    if (sub7Hdr.readBigUInt64LE(0x28) !== hitAddr) continue
    const pObjCandidate = sub7Hdr.readBigUInt64LE(0x10)
    const subs = await resolveSubPointersFromPObj(pObjCandidate, vtables, false)
    if (!subs || subs.sub36Ptr <= 0x2000000000n) continue

    const candidate = await readMemoryBuffer(bigintToHex(subs.sub36Ptr), 0x40, 500)
    if (isValidSub36Buffer(candidate, vtables.sub36Vt1, vtables.sub36Vt2)) {
      cachedSub36Addr = bigintToHex(subs.sub36Ptr)
      cachedParentObjAddr = pObjCandidate
      cachedSub7Addr = sub7Candidate
      cachedSub23Addr = subs.sub23Ptr > 0x2000000000n ? subs.sub23Ptr : 0n
      return candidate
    }
  }

  return null
}

async function resolveGdmStockAddrFromContainer(
  gdm: bigint,
  vtables: DynamicVtables,
): Promise<number | null> {
  if (gdm === 0n || !lichiiRpc.isConnected()) return null
  const hdr = await readMemoryBuffer(bigintToHex(gdm + 0x230n), 0x28, 400)
  if (!hdr || hdr.length < 0x28) return null
  const cnt = hdr.readUInt32LE(0x08)
  const entriesPtr = hdr.readBigUInt64LE(0x10)
  const hashTablePtr = hdr.readBigUInt64LE(0x18)
  const cap = hdr.readUInt32LE(0x24)
  if (
    cnt === 0 ||
    cnt >= 10000 ||
    cap < cnt ||
    cap > 32768 ||
    entriesPtr <= 0x2000000000n ||
    hashTablePtr <= 0x2000000000n
  ) {
    return null
  }

  const hashBuf = await readMemoryBuffer(bigintToHex(hashTablePtr), cap * 8, 800)
  if (!hashBuf || hashBuf.length < 8) return null
  for (let off = 0; off + 8 <= hashBuf.length; off += 8) {
    if (hashBuf.readUInt32LE(off) !== GDM_STOCK_TOKEN_HASH) continue
    const idx = hashBuf.readUInt32LE(off + 4)
    if (idx >= cnt) continue
    const entryAddr = bigintToHex(entriesPtr + BigInt(idx) * 0x28n)
    const entryBuf = await readMemoryBuffer(entryAddr, 0x28, 400)
    const val = parseGdmStockNumBuffer(entryBuf, vtables.gdmStockVt)
    if (val !== null) {
      cachedLiveStockAddr = entryAddr
      return val
    }
  }
  return null
}

async function resolveSaveBufFallbackAddresses(gdm: bigint): Promise<void> {
  if (gdm === 0n || !lichiiRpc.isConnected()) return
  const saveBufPtr = await readU64At(bigintToHex(gdm + 0x1160n), 400)
  if (saveBufPtr <= 0x2000000000n) return
  const hdr = await readMemoryBuffer(bigintToHex(saveBufPtr), 0x28, 400)
  if (!hdr || hdr.length < 0x28) return
  const dataOff = hdr.readUInt32LE(8)
  if (dataOff <= 0x28 || dataOff > 0x40000) return

  for (let off = 0x28; off < dataOff; off += MASTER_FLAG_READ_CHUNK) {
    const size = Math.min(MASTER_FLAG_READ_CHUNK, dataOff - off)
    const chunk = await readMemoryBuffer(bigintToHex(saveBufPtr + BigInt(off)), size, 500)
    if (!chunk || chunk.length < 8) break
    for (let pos = 0; pos + 8 <= chunk.length; pos += 8) {
      const h = chunk.readUInt32LE(pos)
      if (h === GDM_STOCK_TOKEN_HASH && cachedLiveCountAddr === '0x0') {
        cachedLiveCountAddr = bigintToHex(saveBufPtr + BigInt(off + pos))
      } else if (h === 0xa3db7114 && cachedLiveHashesAddr === '0x0') {
        const ptrOff = chunk.readUInt32LE(pos + 4)
        if (ptrOff >= dataOff && ptrOff < 0x80000) {
          cachedLiveHashesAddr = bigintToHex(saveBufPtr + BigInt(ptrOff))
        }
      }
      if (cachedLiveCountAddr !== '0x0' && cachedLiveHashesAddr !== '0x0') return
    }
  }
}

async function readLiveSkulltulaCount(
  mainBase: bigint,
  vtables: DynamicVtables,
  now: number,
): Promise<number | null> {
  // Fast path: cached Item_Token_Gold.StockNum entry in GameDataMgr + 0x230
  if (cachedLiveStockAddr !== '0x0') {
    const stockBuf = await readMemoryBuffer(cachedLiveStockAddr, 0x28, 400)
    const val = parseGdmStockNumBuffer(stockBuf, vtables.gdmStockVt)
    if (val !== null) return val
    cachedLiveStockAddr = '0x0'
    cachedGdmAddr = 0n
  }

  const gdm = await resolveGameDataMgr(mainBase, vtables)
  if (gdm !== 0n) {
    const resolved = await resolveGdmStockAddrFromContainer(gdm, vtables)
    if (resolved !== null) return resolved
  }

  // Fallback: slid gdmCountVt container entry
  if (cachedLiveGdmCountAddr !== '0x0') {
    const gdmBuf = await readMemoryBuffer(cachedLiveGdmCountAddr, 0x30, 500)
    const countVal = parseGdmSkulltulaCount(gdmBuf, vtables.gdmCountVt)
    if (countVal !== null) return countVal
    cachedLiveGdmCountAddr = '0x0'
  }

  if (lichiiRpc.isConnected() && now - lastGdmRescanTime > 2500) {
    lastGdmRescanTime = now
    const pattern = u64ToLeHex(vtables.gdmCountVt) + '08000000'
    const hits = await searchHeapWithFallback({
      pattern,
      start: '0x2160000000',
      end: '0x21c0000000',
      maxHits: 16,
      fastBudgetMs: 800,
      heapBudgetMs: 1500,
    })
    const candidates: Array<{ hit: string; val: number }> = []
    for (const hit of hits) {
      const candidate = await readMemoryBuffer(hit, 0x30, 500)
      const val = parseGdmSkulltulaCount(candidate, vtables.gdmCountVt)
      if (val !== null) {
        candidates.push({ hit, val })
      }
    }
    if (candidates.length === 1) {
      cachedLiveGdmCountAddr = candidates[0]!.hit
      return candidates[0]!.val
    }
    if (candidates.length > 1) {
      const masterIds = cachedMasterCollectedIds ?? (await readMasterFlagCollectedIds(now, mainBase, vtables))
      const expectedCount = masterIds?.length ?? null
      const chosen =
        (expectedCount !== null ? candidates.find((c) => c.val === expectedCount) : undefined) ??
        candidates[0]!
      cachedLiveGdmCountAddr = chosen.hit
      return chosen.val
    }
  }

  // Last-resort fallback: SaveBuf 0x04735978 index entry
  if (lichiiRpc.isConnected()) {
    if (cachedLiveCountAddr === '0x0' && gdm !== 0n) {
      await resolveSaveBufFallbackAddresses(gdm)
    }
    if (cachedLiveCountAddr !== '0x0') {
      const countBuf = await readMemoryBuffer(cachedLiveCountAddr, 8, 500)
      if (countBuf && countBuf.length === 8 && countBuf.readUInt32LE(0) === GDM_STOCK_TOKEN_HASH) {
        const val = countBuf.readUInt32LE(4)
        if (val >= 0 && val <= 100) return val
      }
    }
  }

  return null
}

async function readLiveTelemetryFromMemory(): Promise<LiveMemoryTelemetry> {
  const now = Date.now()
  const hadActiveSession =
    cachedLiveScene !== null ||
    cachedParentObjAddr !== 0n ||
    cachedMasterCollectedIds !== null

  let mainBase = await ensureMainBase()
  if (mainBase === 0n) {
    if (hadActiveSession) {
      clearPlayerAndGdmSessionCaches()
    }
    return emptyLiveMemoryTelemetry(!lichiiRpc.isConnected())
  }
  let vtables = deriveDynamicVtables(mainBase)

  // 1. Read Sub[36] (0x40 bytes covers pObj + player pos/dir)
  let subBuf = await readMemoryBuffer(cachedSub36Addr, 0x40)
  let subValid = isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)
  let readFailed = cachedSub36Addr !== '0x0' && subBuf === null

  if (!subValid) {
    // Re-verify mainBase if a previously valid Sub[36] failed (guards against undetected restarts)
    if (cachedSub36Addr !== '0x0' && lichiiRpc.isConnected()) {
      const hdr = await readMemoryBuffer(bigintToHex(mainBase), 8, 400)
      if (!validateMainBaseHeader(hdr)) {
        resetLiveSessionCaches()
        mainBase = await ensureMainBase(true)
        if (mainBase === 0n) {
          return emptyLiveMemoryTelemetry(!lichiiRpc.isConnected())
        }
        vtables = deriveDynamicVtables(mainBase)
      }
    }

    cachedSub36Addr = '0x0'
    cachedParentObjAddr = 0n
    cachedSub7Addr = 0n
    cachedSub23Addr = 0n

    // Fast path (~1ms): resolve Sub[36] / Sub[7] / Sub[23] directly from .bss singleton
    if (lichiiRpc.isConnected()) {
      subBuf = await resolvePlayerFromBss(mainBase, vtables)
      subValid = isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)
      readFailed = subBuf === null
    }

    // Fallback: slid-vtable / "Work/Banc/Scene/" heap scan when .bss pointer is not yet populated
    if (!subValid) {
      if (hadActiveSession) {
        clearPlayerAndGdmSessionCaches()
      }
      if (lichiiRpc.isConnected() && now - lastRescanTime > 2500) {
        lastRescanTime = now
        subBuf = await resolvePlayerViaHeapFallbacks(vtables)
        subValid = isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)
        readFailed = subBuf === null
      }
    }
  }

  if (!subValid || !subBuf) {
    return emptyLiveMemoryTelemetry(readFailed || !lichiiRpc.isConnected())
  }

  const prevScene = cachedLiveScene
  const pObj = subBuf.readBigUInt64LE(0x10)
  const x = subBuf.readFloatLE(0x1c)
  const y = subBuf.readFloatLE(0x20)
  const z = subBuf.readFloatLE(0x24)
  const dx = subBuf.readFloatLE(0x28)
  const dz = subBuf.readFloatLE(0x30)

  let yaw = 0
  if (Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 0.01) {
    yaw = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360
  }

  const position = {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    z: Number(z.toFixed(2)),
    yaw: Number(yaw.toFixed(1)),
  }

  // Refresh scene name from Sub[7] + 0x34 (fallback pObj + 0x768) and age hint from Sub[23] + 0x80
  if (pObj > 0x2000000000n) {
    if (pObj !== cachedParentObjAddr) {
      cachedParentObjAddr = pObj
      const subs = await resolveSubPointersFromPObj(pObj, vtables, false)
      if (subs) {
        cachedSub7Addr = subs.sub7Ptr > 0x2000000000n ? subs.sub7Ptr : 0n
        cachedSub23Addr = subs.sub23Ptr > 0x2000000000n ? subs.sub23Ptr : 0n
      }
    }

    const primaryStrBuf =
      cachedSub7Addr > 0x2000000000n
        ? await readMemoryBuffer(bigintToHex(cachedSub7Addr + 0x34n), 0x80, 400)
        : null
    let bcettMatch =
      primaryStrBuf
        ?.toString('ascii')
        .match(/Work\/Banc\/Scene\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\.bcett/) ?? null
    if (!bcettMatch) {
      const fallbackStrBuf = await readMemoryBuffer(bigintToHex(pObj + 0x768n), 0x480, 500)
      bcettMatch =
        fallbackStrBuf
          ?.toString('ascii')
          .match(/Work\/Banc\/Scene\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\.bcett/) ?? null
    }
    if (bcettMatch) {
      const norm = normalizeSceneName(bcettMatch[2] || bcettMatch[1] || '')
      if (norm.scene !== prevScene) {
        cachedLiveScene = norm.scene
        cachedLiveAgeHint = norm.ageHint
      } else if (norm.ageHint !== null) {
        cachedLiveAgeHint = norm.ageHint
      }
    }

    const sceneChanged = cachedLiveScene !== prevScene
    if (!cachedLiveAgeHint && lichiiRpc.isConnected() && (sceneChanged || now - lastAgeReadTime > 1000)) {
      lastAgeReadTime = now
      if (cachedSub23Addr > 0x2000000000n) {
        const adjBuf = await readMemoryBuffer(bigintToHex(cachedSub23Addr + 0x80n), 0x80, 400)
        if (adjBuf) {
          const adjAscii = readNullTerminatedAscii(adjBuf, 0, 0x80)
          if (adjAscii.includes('_Adult')) cachedLiveAgeHint = 'adult'
          else if (adjAscii.includes('_Child')) cachedLiveAgeHint = 'child'
        }
      }
    }
  }

  if (!lichiiRpc.isConnected()) {
    return emptyLiveMemoryTelemetry(true)
  }

  // 2. Read live runtime GameDataMgr StockNum (direct GDM + 0x230 hash table, or slid fallback)
  const liveSkulltulaCount = await readLiveSkulltulaCount(mainBase, vtables, now)

  // 3. Refresh authoritative 100-Skulltula runtime flag table on pickup, scene change, or every 500ms
  let masterCollectedIds = cachedMasterCollectedIds
  if (
    lichiiRpc.isConnected() &&
    (masterCollectedIds === null ||
      liveSkulltulaCount !== prevMasterReadCount ||
      cachedLiveScene !== prevScene ||
      now - lastMasterReadTime > 500)
  ) {
    masterCollectedIds = await readMasterFlagCollectedIds(now, mainBase, vtables)
    prevMasterReadCount = liveSkulltulaCount
  }

  // 4. Fallback to RAM SaveBuf 0xa3db7114 array only if master table was unavailable
  if (
    lichiiRpc.isConnected() &&
    masterCollectedIds === null &&
    (cachedLiveScene !== prevScene || now - lastHashesReadTime > 1000)
  ) {
    lastHashesReadTime = now
    if (cachedLiveHashesAddr === '0x0') {
      const gdm = await resolveGameDataMgr(mainBase, vtables)
      await resolveSaveBufFallbackAddresses(gdm)
    }
    const hashesBuf = await readMemoryBuffer(cachedLiveHashesAddr, 3216, 600)
    if (hashesBuf && hashesBuf.length >= 64) {
      const first = hashesBuf.readBigUInt64LE(0)
      const second = hashesBuf.readBigUInt64LE(8)
      if (first > 0n && second > first) {
        const nextSet = new Set<bigint>()
        let strictlySorted = true
        let prev = 0n
        for (let off = 0; off + 8 <= hashesBuf.length; off += 8) {
          const h = hashesBuf.readBigUInt64LE(off)
          if (h === 0n) break
          if (h <= prev) {
            strictlySorted = false
            break
          }
          prev = h
          nextSet.add(h)
        }
        if (strictlySorted && nextSet.size >= 2) {
          cachedLiveSavedHashes = nextSet
        }
      }
    }
  }

  if (!lichiiRpc.isConnected()) {
    return emptyLiveMemoryTelemetry(true)
  }

  return {
    position,
    scene: cachedLiveScene,
    ageHint: cachedLiveAgeHint,
    masterCollectedIds,
    liveSavedHashes: cachedLiveSavedHashes,
    liveSkulltulaCount,
    readFailed: false,
  }
}

// ============================================================================
// Main Telemetry Aggregator
// ============================================================================

const STATE_CACHE_TTL_MS = 80
let stickyLastCollectedId: string | null = null
let prevMasterCollectedSet: Set<string> | null = null

let cachedStatusRes: Record<string, unknown> | null = null
let lastStatusCheckTime = 0
let cachedTelemetryState: LichiiTelemetryState | null = null
let cachedTelemetryStateTime = 0
let inFlightStatePromise: Promise<LichiiTelemetryState> | null = null

function clearPlayerAndGdmSessionCaches() {
  cachedSub36Addr = '0x0'
  cachedParentObjAddr = 0n
  cachedSub7Addr = 0n
  cachedSub23Addr = 0n
  cachedGdmAddr = 0n
  cachedLiveStockAddr = '0x0'
  cachedLiveCountAddr = '0x0'
  cachedLiveGdmCountAddr = '0x0'
  cachedLiveHashesAddr = '0x0'
  cachedMasterFlagTableAddr = '0x0'
  cachedMasterFlagTableCount = 0
  cachedLiveScene = null
  cachedLiveAgeHint = null
  lastRescanTime = 0
  lastMasterReadTime = 0
  lastMasterRescanTime = 0
  lastGdmRescanTime = 0
  lastHashesReadTime = 0
  lastAgeReadTime = 0
  cachedMasterCollectedIds = null
  prevMasterReadCount = null
  prevMasterCollectedSet = null
  stickyLastCollectedId = null
  cachedLiveSavedHashes = new Set<bigint>()
}

function resetLiveSessionCaches() {
  cachedMainBase = 0n
  lastMainBaseScanTime = 0
  clearPlayerAndGdmSessionCaches()
}

function handleRpcDisconnect() {
  cachedStatusRes = null
  lastStatusCheckTime = 0
  cachedTelemetryState = null
  cachedTelemetryStateTime = 0
  resetLiveSessionCaches()
}

export async function getLichiiTelemetryState(): Promise<LichiiTelemetryState> {
  const now = Date.now()
  if (
    cachedTelemetryState &&
    now - cachedTelemetryStateTime < STATE_CACHE_TTL_MS &&
    (!cachedTelemetryState.connected || lichiiRpc.isConnected())
  ) {
    return cachedTelemetryState
  }
  if (inFlightStatePromise) {
    return inFlightStatePromise
  }

  inFlightStatePromise = computeLichiiTelemetryState()
    .then((state) => {
      if (!state.connected || lichiiRpc.isConnected()) {
        cachedTelemetryState = state
        cachedTelemetryStateTime = Date.now()
      } else {
        cachedTelemetryState = null
        cachedTelemetryStateTime = 0
      }
      return state
    })
    .finally(() => {
      inFlightStatePromise = null
    })

  return inFlightStatePromise
}

async function computeLichiiTelemetryState(): Promise<LichiiTelemetryState> {
  const now = Date.now()
  // Always pass fps_window_ms: 0 so status responds in <1ms instead of sleeping 500ms,
  // and refresh full status every 1s (or immediately when disconnected).
  if (
    !lichiiRpc.isConnected() ||
    !cachedStatusRes ||
    !cachedStatusRes.powered_on ||
    now - lastStatusCheckTime > 1000
  ) {
    const freshStatus = await callLichiiRpc('status', { fps_window_ms: 0 }, 700)
    lastStatusCheckTime = Date.now()
    cachedStatusRes = freshStatus
  }

  let tcpConnected = cachedStatusRes !== null && lichiiRpc.isConnected()
  let emulatorRunning = tcpConnected && Boolean(cachedStatusRes?.powered_on)
  let titleId = typeof cachedStatusRes?.program_id === 'string' ? cachedStatusRes.program_id : undefined

  const latestSlotInfo = findLatestSaveSlotDir()
  const saveState = latestSlotInfo ? parseSaveSlot(latestSlotInfo) : null

  let liveState =
    tcpConnected && emulatorRunning
      ? await readLiveTelemetryFromMemory()
      : emptyLiveMemoryTelemetry()

  // If cached status assumed alive but memory read returned nothing, re-check status right away
  if (
    tcpConnected &&
    emulatorRunning &&
    !liveState.position &&
    (!lichiiRpc.isConnected() ||
      !cachedStatusRes ||
      liveState.readFailed ||
      Date.now() - lastStatusCheckTime > 50)
  ) {
    const wasDisconnected = !lichiiRpc.isConnected()
    const freshStatus = await callLichiiRpc('status', { fps_window_ms: 0 }, 700)
    lastStatusCheckTime = Date.now()
    cachedStatusRes = freshStatus
    tcpConnected = freshStatus !== null && lichiiRpc.isConnected()
    emulatorRunning = tcpConnected && Boolean(freshStatus?.powered_on)
    titleId = typeof freshStatus?.program_id === 'string' ? freshStatus.program_id : undefined
    if (!tcpConnected || !emulatorRunning) {
      resetLiveSessionCaches()
      liveState = emptyLiveMemoryTelemetry()
    } else if (wasDisconnected) {
      liveState = await readLiveTelemetryFromMemory()
    }
  } else if (!tcpConnected || !emulatorRunning) {
    resetLiveSessionCaches()
  }

  const { connected, emulatorRunning: activeEmulatorRunning, source } = deriveConnectionStatus({
    tcpConnected,
    emulatorRunning,
    hasLivePosition: liveState.position !== null,
    hasSavePosition: Boolean(saveState?.position),
  })

  const rawScene = liveState.scene ?? saveState?.subScene ?? saveState?.scene ?? null
  const { scene: normalizedScene, ageHint: sceneAgeHint } = normalizeSceneName(rawScene)
  const sceneKey = normalizedScene ?? (saveState?.scene ? normalizeSceneName(saveState.scene).scene : null)

  const sceneMapping = sceneKey ? SCENE_TO_PLACE[sceneKey] : undefined
  const place: Place | undefined = sceneMapping
    ? dataset.places.find((p) => p.id === sceneMapping.placeId)
    : undefined

  const age: 'child' | 'adult' | null =
    sceneAgeHint ??
    liveState.ageHint ??
    sceneMapping?.defaultAge ??
    (saveState ? 'adult' : null)

  const position = liveState.position ?? saveState?.position ?? null
  const mapId = place ? determineMapId(place, age, position?.y ?? null) : null
  const mapFraction =
    place && sceneKey && position
      ? projectToPlaceMap(sceneKey, place, mapId, position.x, position.z)
      : null
  const worldMapFraction = place ? projectToWorldMap(place, mapFraction) : null

  const skulltulaCount =
    source === 'memory'
      ? (liveState.liveSkulltulaCount ??
          (liveState.masterCollectedIds ? liveState.masterCollectedIds.length : null))
      : (saveState?.skulltulaCount ?? null)
  const lastPickedItem = deriveLastPickedItem(source, saveState?.lastPickedItem ?? null)

  let collectedSkulltulaIds: string[] = []
  let authoritativeSkulltulas = false

  if (source === 'memory' && place && liveState.masterCollectedIds !== null) {
    collectedSkulltulaIds = liveState.masterCollectedIds
    authoritativeSkulltulas = true

    const currentSet = new Set(collectedSkulltulaIds)
    if (prevMasterCollectedSet !== null) {
      const newlyAdded = collectedSkulltulaIds.filter((id) => !prevMasterCollectedSet!.has(id))
      let removedAny = false
      for (const prevId of prevMasterCollectedSet) {
        if (!currentSet.has(prevId)) {
          removedAny = true
          break
        }
      }
      if (removedAny || newlyAdded.length > 2) {
        // Reloaded a save or switched save slots: clear stale pickup badge
        stickyLastCollectedId = null
      } else if (newlyAdded.length >= 1) {
        stickyLastCollectedId = newlyAdded[newlyAdded.length - 1] ?? null
      }
    }
    prevMasterCollectedSet = currentSet
  } else {
    prevMasterCollectedSet = null
    // Fallback without master table: never mix disk progress.sav across slots when RAM is active
    const fallbackHashes =
      source === 'memory' && liveState.liveSavedHashes.size > 0
        ? liveState.liveSavedHashes
        : source === 'save' && saveState?.savedHashes
          ? saveState.savedHashes
          : null
    if (fallbackHashes) {
      const fallbackSet = new Set<string>()
      for (const entry of KNOWN_SKULLTULA_HASH_MAP) {
        if (entry.hashes.some((h) => fallbackHashes.has(h))) {
          for (const itemId of entry.itemIds) fallbackSet.add(itemId)
        }
      }
      collectedSkulltulaIds = Array.from(fallbackSet).sort()
    }
  }

  return {
    connected,
    emulatorRunning: activeEmulatorRunning,
    titleId,
    scene: sceneKey,
    placeId: place?.id ?? null,
    placeSlug: place?.slug ?? null,
    placeName: place?.name ?? null,
    mapId,
    age,
    position,
    mapFraction,
    worldMapFraction,
    skulltulaCount,
    collectedSkulltulaIds,
    authoritativeSkulltulas,
    lastCollectedSkulltulaId: stickyLastCollectedId,
    lastPickedItem,
    source,
    updatedAt: Date.now(),
  }
}

export function lichiiTelemetryPlugin(): Plugin {
  const registerMiddleware = (middlewares: {
    use: (
      route: string,
      fn: (
        req: { method?: string },
        res: {
          statusCode: number
          setHeader: (name: string, value: string) => void
          end: (body: string) => void
        },
        next: () => void,
      ) => void,
    ) => void
  }) => {
    middlewares.use('/api/lichii/state', async (req, res, next) => {
      if (req.method && req.method !== 'GET') {
        next()
        return
      }
      try {
        const state = await getLichiiTelemetryState()
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
        res.end(JSON.stringify(state))
      } catch (err) {
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const fallback: LichiiTelemetryState = {
          connected: false,
          emulatorRunning: false,
          scene: null,
          placeId: null,
          placeSlug: null,
          placeName: null,
          mapId: null,
          age: null,
          position: null,
          mapFraction: null,
          worldMapFraction: null,
          skulltulaCount: null,
          collectedSkulltulaIds: [],
          authoritativeSkulltulas: false,
          lastCollectedSkulltulaId: null,
          lastPickedItem: null,
          source: 'none',
          updatedAt: Date.now(),
        }
        res.end(JSON.stringify(fallback))
      }
    })
  }

  return {
    name: 'lichii-telemetry',
    configureServer(server) {
      registerMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      registerMiddleware(server.middlewares)
    },
  }
}
