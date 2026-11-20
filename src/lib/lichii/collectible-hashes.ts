export type SaveBufCollectibles = {
  heartPieceIds: string[]
  beanIds: string[]
  fairyIds: string[]
  bottleIds: string[]
  thoughtIds: string[]
}

export interface GdmBoolWindowDescriptor {
  startHex: string
  size: number
  entries: Array<{ hash: number; offset: number }>
}

export const GDM_STOCK_TAG = 0x20
export const GDM_COUNT_TAG = 8
export const GDM_STOCK_TOKEN_HASH = 0x04735978
export const GDM_BOOL_CONTAINER_OFFSET = 0x170n
export const GDM_INT_CONTAINER_OFFSET = 0x230n
export const GDM_BOOL_ENTRY_STRIDE = 0x18n
export const GDM_INT_ENTRY_STRIDE = 0x28n
export const LEGACY_GDM_COUNT_VT = 0x8504de98n

export const MASTER_FLAG_ENTRY_0_HASH = 0x00006e56f79838e8n
export const MASTER_FLAG_ENTRY_1_HASH = 0x00006e56f79838ean
export const MASTER_FLAG_COLLECTED_BIT = 0x100000000n
export const MASTER_FLAG_READ_CHUNK = 32768
export const MASTER_FLAG_READ_BYTES = MASTER_FLAG_READ_CHUNK * 6
export const MASTER_FLAG_ENTRY_0_HEX = 'e83898f7566e0000'

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
  { hashes: [0x7d8ec14bdd1f6341n, 0x7d8ec14bdd1f6343n], itemIds: ['lonlon-gs-02'] },
  { hashes: [0xdc8113831c56b194n, 0xdc8113831c56b196n], itemIds: ['lonlon-gs-03'] },
  { hashes: [0x25e6072d4df023b3n, 0x25e6072d4df023b1n], itemIds: ['lonlon-gs-04'] },
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

/**
 * Known Heart Container 64-bit ActorHashes from GameDataMgr's flag table mapped to oot.json item IDs.
 */
export const KNOWN_HEART_CONTAINER_HASH_MAP: Array<{ hashes: bigint[]; itemIds: string[] }> = [
  // Inside the Deku Tree
  { hashes: [0xf914fa367471a3e3n], itemIds: ['deku-heart-01'] },
  // Dodongo's Cavern
  { hashes: [0x5262cea56c53554dn], itemIds: ['dodongos-heart-01'] },
  // Inside Jabu-Jabu's Belly
  { hashes: [0xf45f5319d88e7ac7n], itemIds: ['jabu-heart-01'] },
  // Forest Temple
  { hashes: [0xff11593a22778e7en], itemIds: ['bosque-heart-01'] },
  // Fire Temple
  { hashes: [0x8389cafb1277d318n], itemIds: ['fuego-heart-01'] },
  // Water Temple
  { hashes: [0xc835e1d03656bf46n], itemIds: ['agua-heart-01'] },
  // Shadow Temple
  { hashes: [0xf43ccb260f5576dcn], itemIds: ['sombra-heart-01'] },
  // Spirit Temple
  { hashes: [0x41811f125b1eedd5n], itemIds: ['espiritu-heart-01'] },
]

/**
 * Known Type 0 (overworld pickup) and Type 1 (treasure chest) Heart Piece 64-bit ActorHashes
 * from GameDataMgr's flag table mapped to oot.json item IDs.
 */
export const KNOWN_HEART_PIECE_HASH_MAP: Array<{ hashes: bigint[]; itemIds: string[] }> = [
  // Type 0 (14 overworld Heart Pieces)
  { hashes: [0x88358af5b5300aa9n], itemIds: ['lonlon-heart-01'] },
  { hashes: [0xf8c7601da7dd887en], itemIds: ['kakariko-heart-01'] },
  { hashes: [0xb9d0070b468f26d2n], itemIds: ['kakariko-heart-02'] },
  { hashes: [0x1df0dbf50c1732b7n], itemIds: ['cementerio-heart-04'] },
  { hashes: [0x09ecb6a0150fee97n], itemIds: ['sendero-heart-01'] },
  { hashes: [0x8f5f3d3321aeb7cdn], itemIds: ['crater-heart-01'] },
  { hashes: [0x0a564328faf93c71n], itemIds: ['crater-heart-02'] },
  { hashes: [0x9efabd5b0516c341n], itemIds: ['rio-heart-01'] },
  { hashes: [0x3a23b59eaedc0510n], itemIds: ['rio-heart-02'] },
  { hashes: [0xac2e26b5ec7da3a2n], itemIds: ['fuente-heart-01'] },
  { hashes: [0x6f736fc80f7b0acan], itemIds: ['fuente-heart-02'] },
  { hashes: [0xbaec91d6ed8dd96bn], itemIds: ['lago-heart-02'] },
  { hashes: [0xdfd66c63357cdea7n], itemIds: ['valle-heart-01'] },
  { hashes: [0x92feab9a9810c619n], itemIds: ['coloso-heart-01'] },
]

/**
 * Known Type 1 (`IsTreasureBoxOpen.<decimal_u64_ActorHash>` chest) and Type 2 (NPC/minigame/event)
 * Heart Piece 32-bit MurmurHash3_32 bool hashes stored in GameDataMgr + 0x170 (`Data.Bool`),
 * SaveBuf Section 1, and progress.sav Section 1 mapped to oot.json item IDs.
 */
export const KNOWN_HEART_PIECE_BOOL_HASH_MAP: Array<{ hash: number; itemId: string }> = [
  // Type 1 (6 Obj_TBox_A_02 / Obj_TBox_A_01_memo11 chest Heart Pieces via IsTreasureBoxOpen.<decimal_u64_ActorHash>)
  { hash: 0xda9dff2c, itemId: 'llanura-heart-02' },
  { hash: 0x8331e107, itemId: 'cementerio-heart-02' },
  { hash: 0x9c89c565, itemId: 'cementerio-heart-03' },
  { hash: 0x7001f17c, itemId: 'valle-heart-02' },
  { hash: 0x689cebe8, itemId: 'fortaleza-heart-02' },
  { hash: 0xa1678ed9, itemId: 'dominio-heart-01' },
  // Type 2 (16 NPC/minigame/event Heart Pieces)
  { hash: 0x5ff7aa30, itemId: 'perdido-heart-01' },
  { hash: 0x1657d7d8, itemId: 'perdido-heart-02' },
  { hash: 0xe41e1597, itemId: 'llanura-heart-01' },
  { hash: 0xb599aeed, itemId: 'ciudadela-heart-01' },
  { hash: 0xf2fab510, itemId: 'ciudadela-heart-02' },
  { hash: 0x61cf7ba1, itemId: 'ciudadela-heart-03' },
  { hash: 0xa666baa8, itemId: 'kakariko-heart-03' },
  { hash: 0x85d8113a, itemId: 'kakariko-heart-04' },
  { hash: 0xb5127e75, itemId: 'cementerio-heart-01' },
  { hash: 0x1d1793e9, itemId: 'goron-heart-01' },
  { hash: 0x6b8fc751, itemId: 'crater-heart-03' },
  { hash: 0x8ffec767, itemId: 'rio-heart-03' },
  { hash: 0xd578df95, itemId: 'rio-heart-04' },
  { hash: 0xad7a21ce, itemId: 'lago-heart-01' },
  { hash: 0xf1891f6e, itemId: 'lago-heart-03' },
  { hash: 0x3f43245b, itemId: 'fortaleza-heart-01' },
]

export const KNOWN_HEART_PIECE_BOOL_HASH_TO_ITEM_ID = new Map<number, string>(
  KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((entry) => [entry.hash >>> 0, entry.itemId]),
)

/**
 * Known planted Magic Bean (`IsPlantedMagicBean_SmallFarm`) 32-bit MurmurHash3_32
 * bool hashes stored in SaveBuf Section 1 (and progress.sav) mapped to oot.json item IDs.
 */
export const KNOWN_BEAN_BOOL_HASH_MAP: Array<{ hash: number; itemId: string }> = [
  { hash: 0xb55acadd, itemId: 'kokiri-bean-01' },
  { hash: 0x5ebf7c8b, itemId: 'perdido-bean-01' },
  { hash: 0x610eb13c, itemId: 'perdido-bean-02' },
  { hash: 0x274b7e3d, itemId: 'cementerio-bean-01' },
  { hash: 0xf2ceba92, itemId: 'sendero-bean-01' },
  { hash: 0x562fab76, itemId: 'crater-bean-01' },
  { hash: 0x5eea40a6, itemId: 'rio-bean-01' },
  { hash: 0xb0377637, itemId: 'lago-bean-01' },
  { hash: 0x50a1775e, itemId: 'valle-bean-01' },
  { hash: 0x2a1c58ce, itemId: 'coloso-bean-01' },
]

export const KNOWN_BEAN_BOOL_HASH_TO_ITEM_ID = new Map<number, string>(
  KNOWN_BEAN_BOOL_HASH_MAP.map((entry) => [entry.hash >>> 0, entry.itemId]),
)

/**
 * Known Great Fairy Fountain 32-bit MurmurHash3_32 bool hashes
 * stored in SaveBuf Section 1 (and progress.sav) mapped to oot.json item IDs.
 */
export const KNOWN_FAIRY_BOOL_HASH_MAP: Array<{ hash: number; itemId: string }> = [
  { hash: 0x8fa2608e, itemId: 'castillo-fairy-01' },
  { hash: 0x6d0523e3, itemId: 'sendero-fairy-01' },
  { hash: 0xe36744cf, itemId: 'crater-fairy-01' },
  { hash: 0xca320c10, itemId: 'fuente-fairy-01' },
  { hash: 0x75b6f007, itemId: 'coloso-fairy-01' },
  { hash: 0x1330a253, itemId: 'castillo-fairy-02' },
]

export const KNOWN_FAIRY_BOOL_HASH_TO_ITEM_ID = new Map<number, string>(
  KNOWN_FAIRY_BOOL_HASH_MAP.map((entry) => [entry.hash >>> 0, entry.itemId]),
)

/**
 * Known Bottle 32-bit MurmurHash3_32 bool hashes
 * stored in SaveBuf Section 1 (and progress.sav) mapped to oot.json item IDs.
 */
export const KNOWN_BOTTLE_BOOL_HASH_MAP: Array<{ hash: number; itemId: string }> = [
  { hash: 0x7a7961c3, itemId: 'kakariko-bottle-01' },
  { hash: 0x084da83f, itemId: 'lonlon-bottle-01' },
  { hash: 0x77dc0488, itemId: 'lago-bottle-01' },
  { hash: 0x4d62de75, itemId: 'ciudadela-bottle-02' },
]

export const KNOWN_BOTTLE_BOOL_HASH_TO_ITEM_ID = new Map<number, string>(
  KNOWN_BOTTLE_BOOL_HASH_MAP.map((entry) => [entry.hash >>> 0, entry.itemId]),
)

/**
 * Known Fairy Thought (HrlField_Note_* / HaveReadHrlField_Note*) 32-bit MurmurHash3_32 bool hashes
 * stored in SaveBuf Section 1 (and progress.sav) mapped to oot.json item IDs.
 */
export const KNOWN_THOUGHT_BOOL_HASH_MAP: Array<{ hash: number; itemId: string }> = [
  { hash: 0x2e9d02ca, itemId: 'cementerio-thought-01' },
  { hash: 0x444057da, itemId: 'cementerio-thought-02' },
  { hash: 0xbb7912c6, itemId: 'coloso-thought-01' },
  { hash: 0x304c49c8, itemId: 'hielo-thought-01' },
  { hash: 0x8b8f3a34, itemId: 'lago-thought-01' },
  { hash: 0xea520731, itemId: 'llanura-thought-01' },
  { hash: 0x668de3c8, itemId: 'llanura-thought-02' },
  { hash: 0x74f0b017, itemId: 'llanura-thought-03' }, // HaveReadHrlField_Note12 (Adult)
  { hash: 0x8199eea2, itemId: 'llanura-thought-03' }, // HaveReadHrlField_Note12_1 (Child)
  { hash: 0xda186a0e, itemId: 'llanura-thought-03' }, // HaveReadHrlField_Note12_2
  { hash: 0x61b1d5c1, itemId: 'llanura-thought-03' }, // HaveReadHrlField_Note12_3
  { hash: 0x8e8f3ae5, itemId: 'llanura-thought-04' },
  { hash: 0x00f5171f, itemId: 'llanura-thought-05' },
  { hash: 0x151ed981, itemId: 'llanura-thought-06' },
  { hash: 0xed1a38ad, itemId: 'llanura-thought-07' },
  { hash: 0x4ac77991, itemId: 'llanura-thought-08' },
  { hash: 0x87917159, itemId: 'llanura-thought-09' },
  { hash: 0x80dffa7d, itemId: 'llanura-thought-10' },
  { hash: 0x494cf2ac, itemId: 'lonlon-thought-01' },
  { hash: 0xd74884be, itemId: 'pozo-thought-01' },
  { hash: 0x39885d67, itemId: 'sendero-thought-01' },
  { hash: 0xa2c78425, itemId: 'sombra-thought-01' },
]

export const KNOWN_THOUGHT_BOOL_HASH_TO_ITEM_ID = new Map<number, string>(
  KNOWN_THOUGHT_BOOL_HASH_MAP.map((entry) => [entry.hash >>> 0, entry.itemId]),
)

/** SaveBuf Section 3 Int hash for Poe Collector points (`GhostShop_CouponNum`); >= 500 awards ciudadela-bottle-01. */
export const GHOST_SHOP_COUPON_NUM_HASH = 0xe3407cee
export const GHOST_SHOP_COUPON_BOTTLE_ITEM_ID = 'ciudadela-bottle-01'
export const GHOST_SHOP_COUPON_THRESHOLD = 500

export const ALL_SAVEBUF_SEC1_BOOL_HASHES = new Set<number>([
  ...KNOWN_HEART_PIECE_BOOL_HASH_TO_ITEM_ID.keys(),
  ...KNOWN_BEAN_BOOL_HASH_TO_ITEM_ID.keys(),
  ...KNOWN_FAIRY_BOOL_HASH_TO_ITEM_ID.keys(),
  ...KNOWN_BOTTLE_BOOL_HASH_TO_ITEM_ID.keys(),
  ...KNOWN_THOUGHT_BOOL_HASH_TO_ITEM_ID.keys(),
])

export const EXPECTED_SAVEBUF_COLLECTIBLE_HASH_COUNT = ALL_SAVEBUF_SEC1_BOOL_HASHES.size + 1

/**
 * Verified SaveBuf Section 1 / GameDataMgr + 0x170 Data.Bool MurmurHash3_32 hashes
 * for owned equipment, upgrades, songs, and situational unlocks.
 * Scanned optionally so mock saves with only collectible flags remain valid.
 */
export const KNOWN_REQUIREMENT_BOOL_HASH_MAP: Array<{ hash: number; requirementKey: string }> = [
  { hash: 0x2bb00768, requirementKey: 'bombs' },
  { hash: 0xa63f1e2d, requirementKey: 'bombs' },
  { hash: 0x5ab49c8e, requirementKey: 'bombchus' },
  { hash: 0x7f4ce38d, requirementKey: 'boomerang' },
  { hash: 0x0ec22ee1, requirementKey: 'slingshot' },
  { hash: 0x69ec28be, requirementKey: 'bow' },
  { hash: 0xff98ed58, requirementKey: 'hookshot' },
  { hash: 0x38aea3bb, requirementKey: 'longshot' },
  { hash: 0x7227efd8, requirementKey: 'megaton-hammer' },
  { hash: 0x5fa190e6, requirementKey: 'iron-boots' },
  { hash: 0x7fe2a5b2, requirementKey: 'lens-of-truth' },
  { hash: 0x1208fb3e, requirementKey: 'silver-scale' },
  { hash: 0xccc1909a, requirementKey: 'golden-scale' },
  { hash: 0x9880707e, requirementKey: 'goron-bracelet' },
  { hash: 0x87e58de3, requirementKey: 'silver-gauntlets' },
  { hash: 0x3ef15ec4, requirementKey: 'golden-gauntlets' },
  { hash: 0x75e94e42, requirementKey: 'mirror-shield' },
  { hash: 0x4f5a929c, requirementKey: 'zora-tunic' },
  { hash: 0xc4e21ac2, requirementKey: 'deku-sticks' },
  { hash: 0xfa04e611, requirementKey: 'dins-fire' },
  { hash: 0x42bd296f, requirementKey: 'ocarina' },
  { hash: 0x1da2c511, requirementKey: 'ocarina' },
  { hash: 0x0e6264c7, requirementKey: 'gerudo-card' },
  { hash: 0xcf2d3db4, requirementKey: 'bugs' },
  { hash: 0x53db16a6, requirementKey: 'blue-fire' },
  { hash: 0x01c20002, requirementKey: 'zeldas-lullaby' },
  { hash: 0xb492ac33, requirementKey: 'eponas-song' },
  { hash: 0xd3f8bfcc, requirementKey: 'sarias-song' },
  { hash: 0x165dd1ad, requirementKey: 'suns-song' },
  { hash: 0x03b3450e, requirementKey: 'song-of-time' },
  { hash: 0x2b39dd4f, requirementKey: 'song-of-storms' },
  { hash: 0x49041ab9, requirementKey: 'bolero-of-fire' },
  { hash: 0x5e86fb4d, requirementKey: 'scarecrows-song' },
  { hash: 0x64dc5440, requirementKey: 'epona' },
]

export const KNOWN_REQUIREMENT_BOOL_HASH_TO_KEY = new Map<number, string>(
  KNOWN_REQUIREMENT_BOOL_HASH_MAP.map((entry) => [entry.hash >>> 0, entry.requirementKey]),
)

export const KNOWN_REQUIREMENT_BOOL_HASHES = new Set<number>(KNOWN_REQUIREMENT_BOOL_HASH_TO_KEY.keys())

function buildHashToItemIdsMap(
  entries: Array<{ hashes: bigint[]; itemIds: string[] }>,
): Map<bigint, string[]> {
  const map = new Map<bigint, string[]>()
  for (const entry of entries) {
    for (const h of entry.hashes) {
      const existing = map.get(h)
      if (existing) {
        for (const id of entry.itemIds) {
          if (!existing.includes(id)) existing.push(id)
        }
      } else {
        map.set(h, [...entry.itemIds])
      }
    }
  }
  return map
}

// Fast lookup from known Skulltula, Heart Container, and Heart Piece 64-bit hashes to dataset item IDs
const KNOWN_HASH_TO_ITEM_IDS = buildHashToItemIdsMap(KNOWN_SKULLTULA_HASH_MAP)
const KNOWN_HEART_CONTAINER_HASH_TO_ITEM_IDS = buildHashToItemIdsMap(KNOWN_HEART_CONTAINER_HASH_MAP)
const KNOWN_HEART_PIECE_HASH_TO_ITEM_IDS = buildHashToItemIdsMap(KNOWN_HEART_PIECE_HASH_MAP)

export function collectIdsFromHashMap(
  entries: Array<{ hashes: bigint[]; itemIds: string[] }>,
  hashes: Set<bigint>,
): string[] {
  const matched = new Set<string>()
  for (const entry of entries) {
    if (entry.hashes.some((h) => hashes.has(h))) {
      for (const itemId of entry.itemIds) matched.add(itemId)
    }
  }
  return Array.from(matched).sort()
}

export function isValidMasterTableHeader(buf: Buffer | null): buf is Buffer {
  return Boolean(
    buf &&
      buf.length >= 32 &&
      buf.readBigUInt64LE(0) === MASTER_FLAG_ENTRY_0_HASH &&
      buf.readBigUInt64LE(16) === MASTER_FLAG_ENTRY_1_HASH,
  )
}

export function parseMasterFlagTableChunks(chunks: Buffer[]): {
  presentItemIds: Set<string>
  collectedItemIds: string[]
  collectedHeartContainerIds: string[]
  collectedHeartPieceIds: string[]
} | null {
  const first = chunks[0]
  if (
    !first ||
    first.length < 32 ||
    first.readBigUInt64LE(0) !== MASTER_FLAG_ENTRY_0_HASH ||
    first.readBigUInt64LE(16) !== MASTER_FLAG_ENTRY_1_HASH
  ) {
    return null
  }
  const presentItemIds = new Set<string>()
  const collectedSet = new Set<string>()
  const collectedHeartContainerSet = new Set<string>()
  const collectedHeartPieceSet = new Set<string>()
  let prevHash = 0n
  let isFirstEntry = true
  let stopped = false

  const processEntry = (buf: Buffer, off: number): boolean => {
    const h = buf.readBigUInt64LE(off)
    if (h === 0n || (!isFirstEntry && h <= prevHash)) return false
    isFirstEntry = false
    prevHash = h
    const skulltulaIds = KNOWN_HASH_TO_ITEM_IDS.get(h)
    const heartIds = KNOWN_HEART_CONTAINER_HASH_TO_ITEM_IDS.get(h)
    const heartPieceIds = KNOWN_HEART_PIECE_HASH_TO_ITEM_IDS.get(h)
    if (!skulltulaIds && !heartIds && !heartPieceIds) return true
    const flags = buf.readBigUInt64LE(off + 8)
    const isCollected = (flags & MASTER_FLAG_COLLECTED_BIT) !== 0n
    if (skulltulaIds) {
      for (const id of skulltulaIds) {
        presentItemIds.add(id)
        if (isCollected) collectedSet.add(id)
      }
    }
    if (heartIds && isCollected) {
      for (const id of heartIds) {
        collectedHeartContainerSet.add(id)
      }
    }
    if (heartPieceIds && isCollected) {
      for (const id of heartPieceIds) {
        collectedHeartPieceSet.add(id)
      }
    }
    return true
  }

  let carry: Buffer | null = null
  for (const chunk of chunks) {
    if (stopped) break
    let off = 0
    if (carry) {
      const needed = 16 - carry.length
      if (chunk.length < needed) {
        carry = Buffer.concat([carry, chunk])
        continue
      }
      const stitched = Buffer.concat([carry, chunk.subarray(0, needed)])
      carry = null
      off = needed
      if (!processEntry(stitched, 0)) {
        stopped = true
        break
      }
    }
    for (; off + 16 <= chunk.length; off += 16) {
      if (!processEntry(chunk, off)) {
        stopped = true
        break
      }
    }
    if (!stopped && off < chunk.length) {
      carry = chunk.subarray(off)
    }
  }

  if (presentItemIds.size < KNOWN_SKULLTULA_HASH_MAP.length) {
    return null
  }
  return {
    presentItemIds,
    collectedItemIds: Array.from(collectedSet).sort(),
    collectedHeartContainerIds: Array.from(collectedHeartContainerSet).sort(),
    collectedHeartPieceIds: Array.from(collectedHeartPieceSet).sort(),
  }
}

/**
 * Parses GameDataMgr's sorted (uint64 InstanceID, uint64 flags) table.
 * Returns null unless the header matches and all known Skulltulas are present.
 */
export function parseMasterFlagTableBuffer(buf: Buffer): {
  presentItemIds: Set<string>
  collectedItemIds: string[]
  collectedHeartContainerIds: string[]
  collectedHeartPieceIds: string[]
} | null {
  return parseMasterFlagTableChunks([buf])
}

/** Scans a GameDataMgr `(u32 hash, u32 idx)` hash table buffer and maps target hashes to entry addresses. */
export function scanGdmContainerHashTableBuffer(
  hashBuf: Buffer,
  cnt: number,
  targetHashes: ReadonlySet<number>,
  entriesPtr: bigint,
  stride: bigint,
  out = new Map<number, bigint>(),
): Map<number, bigint> {
  for (let off = 0; off + 8 <= hashBuf.length; off += 8) {
    const h = hashBuf.readUInt32LE(off)
    if (!targetHashes.has(h)) continue
    const idx = hashBuf.readUInt32LE(off + 4)
    if (idx >= cnt) continue
    out.set(h, entriesPtr + BigInt(idx) * stride)
  }
  return out
}

/** Validates a GameDataMgr `Bool` container entry (`0x18` bytes, vtable `gdmBoolVt`) and returns `u8` at `+0x16`. */
export function parseGdmBoolEntryBuffer(
  buf: Buffer | null,
  expectedVt: bigint,
  offset = 0,
): boolean | null {
  if (!buf || offset < 0 || offset + 0x18 > buf.length) return null
  if (buf.readBigUInt64LE(offset) !== expectedVt) return null
  return buf.readUInt8(offset + 0x16) !== 0
}

/** Validates a GameDataMgr `Int` container entry (`0x28` bytes, vtable `gdmStockVt`) and returns `i32` at `+0x1c`. */
export function parseGdmIntEntryBuffer(
  buf: Buffer | null,
  expectedVt: bigint,
  offset = 0,
): number | null {
  if (!buf || offset < 0 || offset + 0x28 > buf.length) return null
  if (buf.readBigUInt64LE(offset) !== expectedVt) return null
  return buf.readInt32LE(offset + 0x1c)
}

/** Classifies live `gdm + 0x170` Bool values and `GhostShop_CouponNum` (`gdm + 0x230`) into collectible IDs. */
export function classifyGdmCollectibles(
  boolValues: ReadonlyMap<number, boolean>,
  couponCount: number | null,
): SaveBufCollectibles | null {
  if (boolValues.size < ALL_SAVEBUF_SEC1_BOOL_HASHES.size || couponCount === null) {
    return null
  }
  for (const requiredHash of ALL_SAVEBUF_SEC1_BOOL_HASHES) {
    if (!boolValues.has(requiredHash)) return null
  }
  const heartPieceIds: string[] = []
  const beanIds: string[] = []
  const fairyIds: string[] = []
  const bottleIds: string[] = []
  const thoughtIds: string[] = []

  for (const [hash, collected] of boolValues) {
    if (!collected) continue
    const hpId = KNOWN_HEART_PIECE_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (hpId) {
      heartPieceIds.push(hpId)
      continue
    }
    const beanId = KNOWN_BEAN_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (beanId) {
      beanIds.push(beanId)
      continue
    }
    const fairyId = KNOWN_FAIRY_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (fairyId) {
      fairyIds.push(fairyId)
      continue
    }
    const bottleId = KNOWN_BOTTLE_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (bottleId) {
      bottleIds.push(bottleId)
      continue
    }
    const thoughtId = KNOWN_THOUGHT_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (thoughtId) {
      thoughtIds.push(thoughtId)
    }
  }

  if (couponCount >= GHOST_SHOP_COUPON_THRESHOLD) {
    bottleIds.push(GHOST_SHOP_COUPON_BOTTLE_ITEM_ID)
  }

  return {
    heartPieceIds: heartPieceIds.sort(),
    beanIds: beanIds.sort(),
    fairyIds: fairyIds.sort(),
    bottleIds: bottleIds.sort(),
    thoughtIds: Array.from(new Set(thoughtIds)).sort(),
  }
}

/** Extracts sorted owned prerequisite keys from `gdm + 0x170` Bool values and planted bean IDs. */
export function classifyGdmRequirements(
  boolValues: ReadonlyMap<number, boolean>,
  beanIds: readonly string[],
): string[] {
  const owned = new Set<string>()
  for (const [hash, value] of boolValues) {
    if (!value) continue
    const key = KNOWN_REQUIREMENT_BOOL_HASH_TO_KEY.get(hash)
    if (key) owned.add(key)
  }
  if (beanIds.length > 0) {
    owned.add('planted-bean')
  }
  return Array.from(owned).sort()
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

export function buildGdmBoolWindows(boolAddrs: Map<number, bigint>): GdmBoolWindowDescriptor[] {
  const sortedEntries = [...boolAddrs.entries()].sort((a, b) =>
    a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  )
  const windows: GdmBoolWindowDescriptor[] = []
  let idx = 0
  while (idx < sortedEntries.length) {
    const first = sortedEntries[idx]
    if (!first) break
    const windowStart = first[1]
    let windowEnd = windowStart + GDM_BOOL_ENTRY_STRIDE
    const entries: Array<{ hash: number; offset: number }> = [{ hash: first[0], offset: 0 }]
    idx++

    while (idx < sortedEntries.length) {
      const next = sortedEntries[idx]
      if (!next) break
      const nextEnd = next[1] + GDM_BOOL_ENTRY_STRIDE
      if (Number(nextEnd - windowStart) > MASTER_FLAG_READ_CHUNK) break
      windowEnd = nextEnd
      entries.push({ hash: next[0], offset: Number(next[1] - windowStart) })
      idx++
    }

    windows.push({
      startHex: '0x' + windowStart.toString(16),
      size: Number(windowEnd - windowStart),
      entries,
    })
  }
  return windows
}

/**
 * Verifies cached u32 hashes at their relative SaveBuf Section 1 & Section 3 offsets and extracts
 * collected Type 2 Heart Pieces, Beans, Great Fairies, and Bottles. Returns null if any hash mismatches.
 */
export function parseSaveBufCollectibleRange(
  rangeBuf: Buffer,
  minOff: number,
  offsets: Map<number, number>,
): SaveBufCollectibles | null {
  if (offsets.size < EXPECTED_SAVEBUF_COLLECTIBLE_HASH_COUNT) return null
  const heartPieceIds: string[] = []
  const beanIds: string[] = []
  const fairyIds: string[] = []
  const bottleIds: string[] = []
  const thoughtIds: string[] = []

  for (const [hash, dirOff] of offsets) {
    const rel = dirOff - minOff
    if (rel < 0 || rel + 8 > rangeBuf.length) return null
    if (rangeBuf.readUInt32LE(rel) !== hash) return null
    const val = rangeBuf.readUInt32LE(rel + 4)
    if (hash === GHOST_SHOP_COUPON_NUM_HASH) {
      if (rangeBuf.readInt32LE(rel + 4) >= GHOST_SHOP_COUPON_THRESHOLD) {
        bottleIds.push(GHOST_SHOP_COUPON_BOTTLE_ITEM_ID)
      }
      continue
    }
    if (val === 0) continue
    const hpId = KNOWN_HEART_PIECE_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (hpId) {
      heartPieceIds.push(hpId)
      continue
    }
    const beanId = KNOWN_BEAN_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (beanId) {
      beanIds.push(beanId)
      continue
    }
    const fairyId = KNOWN_FAIRY_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (fairyId) {
      fairyIds.push(fairyId)
      continue
    }
    const bottleId = KNOWN_BOTTLE_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (bottleId) {
      bottleIds.push(bottleId)
      continue
    }
    const thoughtId = KNOWN_THOUGHT_BOOL_HASH_TO_ITEM_ID.get(hash)
    if (thoughtId) {
      thoughtIds.push(thoughtId)
    }
  }

  return {
    heartPieceIds: heartPieceIds.sort(),
    beanIds: beanIds.sort(),
    fairyIds: fairyIds.sort(),
    bottleIds: bottleIds.sort(),
    thoughtIds: Array.from(new Set(thoughtIds)).sort(),
  }
}

/**
 * Verifies cached u32 hashes at their relative SaveBuf Section 1 offsets and extracts
 * collected Type 2 Heart Piece item IDs. Returns null if any hash mismatches.
 */
export function parseSaveBufHeartPieceBoolRange(
  rangeBuf: Buffer,
  minOff: number,
  offsets: Map<number, number>,
): string[] | null {
  if (offsets.size < KNOWN_HEART_PIECE_BOOL_HASH_MAP.length) return null
  const collected: string[] = []
  for (const [hash, dirOff] of offsets) {
    const rel = dirOff - minOff
    if (rel < 0 || rel + 8 > rangeBuf.length) return null
    if (rangeBuf.readUInt32LE(rel) !== hash) return null
    if (rangeBuf.readUInt32LE(rel + 4) !== 0) {
      const itemId = KNOWN_HEART_PIECE_BOOL_HASH_TO_ITEM_ID.get(hash)
      if (itemId) collected.push(itemId)
    }
  }
  return collected.sort()
}

export function parseSaveBufRequirementRange(
  rangeBuf: Buffer,
  minOff: number,
  offsets: ReadonlyMap<number, number>,
  beanIds: readonly string[],
): string[] {
  const owned = new Set<string>()
  for (const [hash, dirOff] of offsets) {
    const reqKey = KNOWN_REQUIREMENT_BOOL_HASH_TO_KEY.get(hash)
    if (!reqKey) continue
    const rel = dirOff - minOff
    if (rel < 0 || rel + 8 > rangeBuf.length) continue
    if (rangeBuf.readUInt32LE(rel) !== hash) continue
    if (rangeBuf.readUInt32LE(rel + 4) !== 0) {
      owned.add(reqKey)
    }
  }
  if (beanIds.length > 0) {
    owned.add('planted-bean')
  }
  return Array.from(owned).sort()
}
