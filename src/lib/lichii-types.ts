export type EmulatorKind = 'lichii' | 'fritchii' | 'eden' | 'cheezyemu' | 'longshot' | 'relink' | 'triforce' | 'nx2saria'

export type LichiiTelemetryState = {
  connected: boolean
  emulatorRunning: boolean
  emulator?: EmulatorKind
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
  /** List of oot.json Heart Container item IDs confirmed collected (e.g. ["espiritu-heart-01"]) */
  collectedHeartContainerIds?: string[]
  /** True when collectedHeartContainerIds reflects the complete active save/live flag state in RAM */
  authoritativeHeartContainers?: boolean
  /** List of oot.json Piece of Heart item IDs confirmed collected (e.g. ["kakariko-heart-01"]) */
  collectedHeartPieceIds?: string[]
  /** True when collectedHeartPieceIds reflects the complete active save/live flag state in RAM */
  authoritativeHeartPieces?: boolean
  /** List of oot.json Magic Bean spot item IDs confirmed planted (e.g. ["kokiri-bean-01"]) */
  collectedBeanIds?: string[]
  /** True when collectedBeanIds reflects the complete active save/live flag state in RAM */
  authoritativeBeans?: boolean
  /** List of oot.json Great Fairy item IDs confirmed visited (e.g. ["castillo-fairy-01"]) */
  collectedFairyIds?: string[]
  /** True when collectedFairyIds reflects the complete active save/live flag state in RAM */
  authoritativeFairies?: boolean
  /** List of oot.json Bottle item IDs confirmed collected (e.g. ["kakariko-bottle-01"]) */
  collectedBottleIds?: string[]
  /** True when collectedBottleIds reflects the complete active save/live flag state in RAM */
  authoritativeBottles?: boolean
  /** List of oot.json Fairy Thought item IDs confirmed read (e.g. ["cementerio-thought-01"]) */
  collectedThoughtIds?: string[]
  /** True when collectedThoughtIds reflects the complete active save/live flag state in RAM */
  authoritativeThoughts?: boolean
  /** List of prerequisite equipment/song keys detected as owned from live RAM or save data */
  ownedRequirements?: string[]
  /** Most recently collected Gold Skulltula item ID if just picked up */
  lastCollectedSkulltulaId: string | null
  lastPickedItem: string | null
  /** Resolved profile save directory currently active for offline/fallback save reading */
  activeSaveDir?: string | null
  /** Active save slot directory name (e.g. "slot_00") */
  activeSaveSlot?: string | null
  /** Sorted list of valid save slot names (e.g. ["slot_00", "slot_01"]) in the active profile */
  availableSaveSlots?: string[]
  source: 'memory' | 'save' | 'none'
  updatedAt: number
}
