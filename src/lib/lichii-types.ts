export type LichiiTelemetryState = {
  connected: boolean
  emulatorRunning: boolean
  titleId?: string
  scene: string | null          // e.g. "SpiritTemple"
  placeId: string | null        // e.g. "espiritu"
  placeSlug: string | null      // e.g. "spirit-temple"
  placeName: string | null      // e.g. "Spirit Temple"
  mapId: string | null          // e.g. "1F" | "principal" | "nino" | "adulto"
  age: 'child' | 'adult' | null
  position: {
    x: number
    y: number
    z: number
    yaw: number                 // degrees (0..360)
  } | null
  /** Normalized 0..1 coordinates on the active PlaceMap (PlaceView) */
  mapFraction: { x: number; y: number } | null
  /** Normalized 0..1 coordinates on the Hyrule WorldMap */
  worldMapFraction: { x: number; y: number } | null
  skulltulaCount: number | null
  /** List of oot.json Gold Skulltula item IDs confirmed collected (e.g. ["espiritu-gs-04"]) */
  collectedSkulltulaIds: string[]
  /** True when collectedSkulltulaIds reflects the complete active save/live flag state in RAM */
  authoritativeSkulltulas: boolean
  /** Most recently collected Gold Skulltula item ID if just picked up */
  lastCollectedSkulltulaId: string | null
  lastPickedItem: string | null
  source: 'memory' | 'save' | 'none'
  updatedAt: number
}
