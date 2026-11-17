import { useCallback, useMemo, useSyncExternalStore } from 'react'
import esGuidesRaw from '../data/i18n/es.json'
import frGuidesRaw from '../data/i18n/fr.json'
import ptGuidesRaw from '../data/i18n/pt.json'
import type { ItemRequirement } from './types'

type GuidePlaceTranslation = {
  intro?: string
}

type GuideItemTranslation = {
  name?: string
  desc?: string
  hint?: string | null
}

type GuideTranslationFile = {
  places: Record<string, GuidePlaceTranslation>
  items: Record<string, GuideItemTranslation>
}

const GUIDE_TRANSLATIONS: Partial<Record<Locale, GuideTranslationFile>> = {
  es: esGuidesRaw as GuideTranslationFile,
  fr: frGuidesRaw as GuideTranslationFile,
  pt: ptGuidesRaw as GuideTranslationFile,
}

export type Locale = 'en' | 'es' | 'fr' | 'pt'

export const DEFAULT_LOCALE: Locale = 'en'
export const LANG_STORAGE_KEY = 'oot-map:v1:lang'

export type LocaleOption = {
  code: Locale
  label: string
  nativeLabel: string
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
] as const

const VALID_LOCALES = new Set<string>(['en', 'es', 'fr', 'pt'])

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && VALID_LOCALES.has(value)
}

const listeners = new Set<() => void>()

function emitChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Reads the persisted locale from localStorage, falling back to 'en' on SSR or invalid values. */
export function getLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const raw = window.localStorage.getItem(LANG_STORAGE_KEY)
    return isLocale(raw) ? raw : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

function getServerLocale(): Locale {
  return DEFAULT_LOCALE
}

/** Persists the selected locale to localStorage and notifies subscribed React components. */
export function setLocale(next: Locale): void {
  if (!isLocale(next)) return
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next)
    } catch {
      // Ignore storage quota or security errors in restricted environments.
    }
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = next
  }
  emitChange()
}

function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LANG_STORAGE_KEY) {
      listener()
    }
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorage)
  }

  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

const EN_MESSAGES = {
  'app.title': 'Ocarina Atlas',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.undo': 'Undo',
  'common.dismiss': 'Dismiss',
  'common.retry': 'Retry',
  'common.rename': 'Rename',
  'common.delete': 'Delete',
  'common.on': 'On',
  'common.off': 'Off',
  'common.or': 'or',
  'common.link': 'Link',
  'common.saved': 'Saved',
  'common.live': 'Live',
  'common.language': 'Language',

  'notFound.title': 'Uncharted ground',
  'notFound.description': 'No place on the atlas matches this address.',
  'notFound.backToMap': 'Back to the map',

  'map.dragHint': '{alt}. Drag to pan, scroll to zoom, or use the arrow, plus and minus keys.',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.resetView': 'Reset view',
  'map.enterFullscreen': 'Enter fullscreen map',
  'map.fullscreenMap': 'Fullscreen map',
  'map.fullscreen': 'Fullscreen',
  'map.exitFullscreen': 'Exit fullscreen',
  'map.exitFullscreenAria': 'Exit fullscreen map',
  'map.worldMap': 'World Map',

  'world.mapAlt': 'Map of Hyrule',
  'world.stats': 'Stats',
  'world.openStats': 'Open global progress stats',
  'world.globalCompletion': 'Global completion',
  'world.zone': 'Zone',
  'world.dungeon': 'Dungeon',
  'world.noTrackedItems': 'No tracked items',
  'world.itemsCompleted': '{done} / {total} items completed',
  'world.itemsCompletedOf': '{done} of {total} items completed',
  'world.placeDetails': '{name} details',
  'world.closePlaceInfo': 'Close place info',
  'world.linkHereLive': 'Link is here (Live)',
  'world.linkHereSaved': 'Link is here (Saved)',
  'world.openMap': 'Open map',

  'stats.title': 'Global Progress',
  'stats.subtitle': 'Hyrule completion across all zones and dungeons',
  'stats.close': 'Close global progress',
  'stats.placesCompleted': '{done} / {total} places completed',
  'stats.overallCompletion': 'Overall completion',
  'stats.byCategory': 'By Category',
  'stats.clickAgainToClear': 'Click again to clear',
  'stats.selectToViewItems': 'Select to view items',
  'stats.remainingCount': '({count} remaining)',
  'stats.filterCategoryItems': 'Filter category items',
  'stats.remaining': 'Remaining',
  'stats.all': 'All',
  'stats.closeCategoryItems': 'Close {category} items',
  'stats.allCollected': 'All {category} collected!',
  'stats.noItemsInCategory': 'No items in this category.',
  'stats.collected': 'Collected',
  'stats.byLocation': 'By Location',
  'stats.placeSingular': 'place',
  'stats.placePlural': 'places',
  'stats.filterLocations': 'Filter locations',
  'stats.tabAll': 'All',
  'stats.tabIncomplete': 'Incomplete',
  'stats.tabZones': 'Zones',
  'stats.tabDungeons': 'Dungeons',
  'stats.allLocationsComplete': 'All locations are 100% complete!',
  'stats.noLocationsMatch': 'No locations match this filter.',

  'place.atlas': 'Atlas',
  'place.inRegion': '{kind} in {region}',
  'place.itemsCount': '{done}/{total} items',
  'place.hideCount': 'Hide',
  'place.showItemCount': 'Show item count',
  'place.about': 'About this place',
  'place.chooseMap': 'Choose a map',
  'place.allFloors': 'All floors',
  'place.allFloorsAlt': 'All floors of {place}',
  'place.mapAlt': 'Map of {place}, {floor}',
  'place.linkOnFloor': 'Link is on this floor',
  'place.linkOnFloorSaved': 'Link is on this floor (Saved)',
  'place.yourPins': 'Your pins',
  'place.yourPinsFloor': 'Your pins · {floor}',
  'place.clickFloorToAdd': 'Click any floor to add a pin.',
  'place.clickMapToAdd': 'Click the map to add a pin.',
  'place.officialPins': 'Official pins',
  'place.noMapTitle': 'No map for this place',
  'place.noMapWithItems': 'Show official pins to track its items from the list. Custom pins need a map.',
  'place.noMapEmpty': 'There are no tracked items here either. Custom pins need a map.',

  'panel.showOfficialPins': 'Show official pins',
  'panel.filterByAge': 'Filter by age',
  'panel.filterByCategory': 'Filter by category',
  'panel.ageChild': 'Child',
  'panel.ageAdult': 'Adult',
  'panel.ageBoth': 'Both',
  'panel.ageChildOrAdult': 'Child or adult',
  'panel.notOnMap': 'Not on a map',
  'panel.nothingToShow': 'Nothing to show on this map.',
  'panel.markCompleted': 'Mark completed',
  'panel.completed': 'Completed',
  'panel.markItemCompleted': 'Mark {name} completed',
  'panel.hideAgain': 'Hide again',
  'panel.type': 'Type',
  'panel.renameItem': 'Rename {name}',
  'panel.deleteItem': 'Delete {name}',
  'panel.closePinInfo': 'Close pin info',
  'panel.yourPin': 'your pin',

  'item.nightOnly': 'Night only',
  'item.hint': 'Hint',
  'item.requires': 'Requires',
  'item.imageAlt': '{name}, image {index}',

  'pin.whatDidYouFind': 'What did you find?',
  'pin.pinName': 'Pin name',
  'pin.addPin': 'Add pin',
  'pin.type.gs': 'Gold Skulltula',
  'pin.type.heart': 'Piece of Heart',
  'pin.type.container': 'Heart Container',
  'pin.type.bean': 'Magic Bean soil',
  'pin.type.fairy': 'Great Fairy',
  'pin.type.bottle': 'Bottle',
  'pin.type.key': 'Key',
  'pin.type.thought': 'Fairy Thought',
  'pin.type.other': 'Other',

  'merge.mergedTitle': 'Merged with official pin',
  'merge.existsTitle': 'This one already exists',
  'merge.description': 'Your pin was close enough, so the official one replaces it.',

  'tracker.live': 'Live',
  'tracker.waitingForGame': 'Waiting for game',
  'tracker.waitingNote': 'RPC connected; showing save data until in-game',
  'tracker.saveOnly': 'Save only',
  'tracker.offlineNote': 'Offline ({emulator} RPC :6545 closed)',
  'tracker.disconnected': 'Disconnected',
  'tracker.emulatorTracker': '{emulator} emulator tracker',
  'tracker.collapsePanel': 'Collapse tracker panel',
  'tracker.skulltulasTitle': 'Gold Skulltulas collected in this save',
  'tracker.errorPrefix': 'Error: {error}',
  'tracker.goToLink': 'Go to Link',
  'tracker.followLink': 'Follow Link: {state}',
  'tracker.autoTracking': 'Auto Tracking: {state}',
  'tracker.autoTrackingTitle':
    'Automatically track collected Skulltulas, Heart Containers, Heart Pieces, Magic Beans, Great Fairies, Bottles, and Fairy Thoughts',
  'tracker.skulltulaCollected': 'Gold Skulltula collected!',
  'tracker.dismissNotification': 'Dismiss notification',
  'tracker.ariaSkulltulas': '{count} of 100 Gold Skulltulas',
  'tracker.ariaSkulltulasUnavailable': 'Gold Skulltula count unavailable',
  'tracker.ariaLocation': 'Location: {location}',

  'floor.child': 'Child',
  'floor.adult': 'Adult',
  'floor.main': 'Main',

  'filter.prereqOnly': 'Only reachable',
  'filter.gearButton': 'My Gear',
  'filter.gearTitle': 'Owned Gear & Songs',
  'filter.gearSubtitle': 'Check the items, upgrades, and songs you have to filter reachable collectibles.',
  'filter.syncFromGame': 'Sync from game',
  'filter.autoSync': 'Auto-sync gear',
  'filter.clearAll': 'Clear all',
  'filter.group.tools': 'Tools & Weapons',
  'filter.group.gear': 'Gear & Upgrades',
  'filter.group.songs': 'Songs',
  'filter.group.situational': 'Situational',
  'filter.reachableCount': '{count} reachable',
  'filter.prereqNotice': 'Filtered by your owned prerequisites',
  'filter.missingReqs': 'Missing prerequisites',

  'credits.title': 'Credits & About',
  'credits.button': 'Credits',
  'credits.originalMap': 'Original Interactive Map',
  'credits.originalMapDesc': 'Created by lucasriondel (oot-remake-map)',
  'credits.atlasAuthor': 'Ocarina Atlas',
  'credits.atlasAuthorDesc': 'Live telemetry, desktop launcher, and auto-tracking by antonioalvromero',
  'credits.mapArtwork': 'Map artwork and collectible data originally attributed to Nintendúo (non-commercial fan project, not affiliated with Nintendo).',
  'credits.officialGithub': 'Official GitHub Repository',
  'credits.officialNotice': 'Free & open-source (GNU AGPL-3.0). Official releases: github.com/antonioalvromero/Ocarina-Atlas — forks must preserve credits and share source.',
  'credits.close': 'Close',
} as const

export type TranslationKey = keyof typeof EN_MESSAGES

const ES_MESSAGES: Record<TranslationKey, string> = {
  'app.title': 'Ocarina Atlas',
  'common.close': 'Cerrar',
  'common.cancel': 'Cancelar',
  'common.undo': 'Deshacer',
  'common.dismiss': 'Descartar',
  'common.retry': 'Reintentar',
  'common.rename': 'Renombrar',
  'common.delete': 'Eliminar',
  'common.on': 'Sí',
  'common.off': 'No',
  'common.or': 'o',
  'common.link': 'Link',
  'common.saved': 'Guardado',
  'common.live': 'En vivo',
  'common.language': 'Idioma',

  'notFound.title': 'Territorio desconocido',
  'notFound.description': 'Ningún lugar del atlas coincide con esta dirección.',
  'notFound.backToMap': 'Volver al mapa',

  'map.dragHint': '{alt}. Arrastra para mover, usa la rueda para hacer zoom o las teclas de flecha, más y menos.',
  'map.zoomIn': 'Acercar',
  'map.zoomOut': 'Alejar',
  'map.resetView': 'Restablecer vista',
  'map.enterFullscreen': 'Abrir mapa en pantalla completa',
  'map.fullscreenMap': 'Mapa en pantalla completa',
  'map.fullscreen': 'Pantalla completa',
  'map.exitFullscreen': 'Salir de pantalla completa',
  'map.exitFullscreenAria': 'Salir del mapa en pantalla completa',
  'map.worldMap': 'Mapa mundial',

  'world.mapAlt': 'Mapa de Hyrule',
  'world.stats': 'Progreso',
  'world.openStats': 'Abrir estadísticas de progreso global',
  'world.globalCompletion': 'Progreso global',
  'world.zone': 'Zona',
  'world.dungeon': 'Mazmorra',
  'world.noTrackedItems': 'Sin objetos rastreados',
  'world.itemsCompleted': '{done} / {total} objetos completados',
  'world.itemsCompletedOf': '{done} de {total} objetos completados',
  'world.placeDetails': 'Detalles de {name}',
  'world.closePlaceInfo': 'Cerrar información del lugar',
  'world.linkHereLive': 'Link está aquí (En vivo)',
  'world.linkHereSaved': 'Link está aquí (Guardado)',
  'world.openMap': 'Abrir mapa',

  'stats.title': 'Progreso global',
  'stats.subtitle': 'Completado de Hyrule en todas las zonas y mazmorras',
  'stats.close': 'Cerrar progreso global',
  'stats.placesCompleted': '{done} / {total} lugares completados',
  'stats.overallCompletion': 'Progreso total',
  'stats.byCategory': 'Por categoría',
  'stats.clickAgainToClear': 'Haz clic de nuevo para limpiar',
  'stats.selectToViewItems': 'Selecciona para ver objetos',
  'stats.remainingCount': '({count} restantes)',
  'stats.filterCategoryItems': 'Filtrar objetos de la categoría',
  'stats.remaining': 'Restantes',
  'stats.all': 'Todos',
  'stats.closeCategoryItems': 'Cerrar objetos de {category}',
  'stats.allCollected': '¡Todos los objetos de {category} recogidos!',
  'stats.noItemsInCategory': 'No hay objetos en esta categoría.',
  'stats.collected': 'Recogido',
  'stats.byLocation': 'Por ubicación',
  'stats.placeSingular': 'lugar',
  'stats.placePlural': 'lugares',
  'stats.filterLocations': 'Filtrar ubicaciones',
  'stats.tabAll': 'Todo',
  'stats.tabIncomplete': 'Incompletos',
  'stats.tabZones': 'Zonas',
  'stats.tabDungeons': 'Mazmorras',
  'stats.allLocationsComplete': '¡Todas las ubicaciones están al 100%!',
  'stats.noLocationsMatch': 'Ninguna ubicación coincide con este filtro.',

  'place.atlas': 'Atlas',
  'place.inRegion': '{kind} en {region}',
  'place.itemsCount': '{done}/{total} objetos',
  'place.hideCount': 'Ocultar',
  'place.showItemCount': 'Mostrar contador',
  'place.about': 'Acerca de este lugar',
  'place.chooseMap': 'Elegir un mapa',
  'place.allFloors': 'Todas las plantas',
  'place.allFloorsAlt': 'Todas las plantas de {place}',
  'place.mapAlt': 'Mapa de {place}, {floor}',
  'place.linkOnFloor': 'Link está en esta planta',
  'place.linkOnFloorSaved': 'Link está en esta planta (Guardado)',
  'place.yourPins': 'Tus pines',
  'place.yourPinsFloor': 'Tus pines · {floor}',
  'place.clickFloorToAdd': 'Haz clic en cualquier planta para añadir un pin.',
  'place.clickMapToAdd': 'Haz clic en el mapa para añadir un pin.',
  'place.officialPins': 'Pines oficiales',
  'place.noMapTitle': 'Sin mapa para este lugar',
  'place.noMapWithItems': 'Muestra los pines oficiales para seguir sus objetos en la lista. Los pines personalizados necesitan un mapa.',
  'place.noMapEmpty': 'Tampoco hay objetos rastreados aquí. Los pines personalizados necesitan un mapa.',

  'panel.showOfficialPins': 'Mostrar pines oficiales',
  'panel.filterByAge': 'Filtrar por edad',
  'panel.filterByCategory': 'Filtrar por categoría',
  'panel.ageChild': 'Niño',
  'panel.ageAdult': 'Adulto',
  'panel.ageBoth': 'Ambos',
  'panel.ageChildOrAdult': 'Niño o adulto',
  'panel.notOnMap': 'Fuera del mapa',
  'panel.nothingToShow': 'Nada que mostrar en este mapa.',
  'panel.markCompleted': 'Marcar como completado',
  'panel.completed': 'Completado',
  'panel.markItemCompleted': 'Marcar {name} como completado',
  'panel.hideAgain': 'Ocultar de nuevo',
  'panel.type': 'Tipo',
  'panel.renameItem': 'Renombrar {name}',
  'panel.deleteItem': 'Eliminar {name}',
  'panel.closePinInfo': 'Cerrar información del pin',
  'panel.yourPin': 'tu pin',

  'item.nightOnly': 'Solo de noche',
  'item.hint': 'Pista',
  'item.requires': 'Requiere',
  'item.imageAlt': '{name}, imagen {index}',

  'pin.whatDidYouFind': '¿Qué encontraste?',
  'pin.pinName': 'Nombre del pin',
  'pin.addPin': 'Añadir pin',
  'pin.type.gs': 'Skulltula Dorada',
  'pin.type.heart': 'Pieza de Corazón',
  'pin.type.container': 'Contenedor de Corazón',
  'pin.type.bean': 'Tierra para Judía Mágica',
  'pin.type.fairy': 'Gran Hada',
  'pin.type.bottle': 'Botella',
  'pin.type.key': 'Llave',
  'pin.type.thought': 'Pensamiento de Hada',
  'pin.type.other': 'Otro',

  'merge.mergedTitle': 'Fusionado con pin oficial',
  'merge.existsTitle': 'Este ya existe',
  'merge.description': 'Tu pin estaba lo bastante cerca, así que el pin oficial lo reemplaza.',

  'tracker.live': 'En vivo',
  'tracker.waitingForGame': 'Esperando al juego',
  'tracker.waitingNote': 'RPC conectado; mostrando datos guardados hasta entrar al juego',
  'tracker.saveOnly': 'Solo guardado',
  'tracker.offlineNote': 'Sin conexión (RPC de {emulator} :6545 cerrado)',
  'tracker.disconnected': 'Desconectado',
  'tracker.emulatorTracker': 'Rastreador de {emulator}',
  'tracker.collapsePanel': 'Contraer panel de rastreo',
  'tracker.skulltulasTitle': 'Skulltulas Doradas recogidas en esta partida',
  'tracker.errorPrefix': 'Error: {error}',
  'tracker.goToLink': 'Ir a Link',
  'tracker.followLink': 'Seguir a Link: {state}',
  'tracker.autoTracking': 'Autorrastreo: {state}',
  'tracker.autoTrackingTitle':
    'Rastrear automáticamente Skulltulas, Contenedores de Corazón, Piezas de Corazón, Judías Mágicas, Grandes Hadas, Botellas y Pensamientos de Hada recogidos',
  'tracker.skulltulaCollected': '¡Skulltula Dorada recogida!',
  'tracker.dismissNotification': 'Descartar notificación',
  'tracker.ariaSkulltulas': '{count} de 100 Skulltulas Doradas',
  'tracker.ariaSkulltulasUnavailable': 'Contador de Skulltulas Doradas no disponible',
  'tracker.ariaLocation': 'Ubicación: {location}',

  'floor.child': 'Niño',
  'floor.adult': 'Adulto',
  'floor.main': 'Principal',

  'filter.prereqOnly': 'Solo alcanzables',
  'filter.gearButton': 'Mi equipo',
  'filter.gearTitle': 'Equipo y canciones',
  'filter.gearSubtitle': 'Marca los objetos, mejoras y canciones que tienes para filtrar los coleccionables alcanzables.',
  'filter.syncFromGame': 'Sincronizar del juego',
  'filter.autoSync': 'Sincronización automática',
  'filter.clearAll': 'Limpiar todo',
  'filter.group.tools': 'Objetos y armas',
  'filter.group.gear': 'Equipo y mejoras',
  'filter.group.songs': 'Canciones',
  'filter.group.situational': 'Situacional',
  'filter.reachableCount': '{count} alcanzables',
  'filter.prereqNotice': 'Filtrado por tus requisitos actuales',
  'filter.missingReqs': 'Requisitos faltantes',

  'credits.title': 'Créditos e información',
  'credits.button': 'Créditos',
  'credits.originalMap': 'Mapa interactivo original',
  'credits.originalMapDesc': 'Creado por lucasriondel (oot-remake-map)',
  'credits.atlasAuthor': 'Ocarina Atlas',
  'credits.atlasAuthorDesc': 'Telemetría en vivo, lanzador de escritorio y autorrastreo por antonioalvromero',
  'credits.mapArtwork': 'Ilustraciones de mapas y datos de coleccionables atribuidos originalmente a Nintendúo (proyecto fan sin fines de lucro, no afiliado a Nintendo).',
  'credits.officialGithub': 'Repositorio oficial en GitHub',
  'credits.officialNotice': 'Gratuito y de código abierto (GNU AGPL-3.0). Versiones oficiales en github.com/antonioalvromero/Ocarina-Atlas — los forks deben conservar créditos y compartir su código.',
  'credits.close': 'Cerrar',
}

const FR_MESSAGES: Record<TranslationKey, string> = {
  'app.title': 'Ocarina Atlas',
  'common.close': 'Fermer',
  'common.cancel': 'Annuler',
  'common.undo': 'Annuler',
  'common.dismiss': 'Fermer',
  'common.retry': 'Réessayer',
  'common.rename': 'Renommer',
  'common.delete': 'Supprimer',
  'common.on': 'Activé',
  'common.off': 'Désactivé',
  'common.or': 'ou',
  'common.link': 'Link',
  'common.saved': 'Sauvegardé',
  'common.live': 'En direct',
  'common.language': 'Langue',

  'notFound.title': 'Terre inconnue',
  'notFound.description': 'Aucun lieu de l’atlas ne correspond à cette adresse.',
  'notFound.backToMap': 'Retour à la carte',

  'map.dragHint': '{alt}. Glissez pour déplacer, faites défiler pour zoomer ou utilisez les flèches, plus et moins.',
  'map.zoomIn': 'Zoomer',
  'map.zoomOut': 'Dézoomer',
  'map.resetView': 'Réinitialiser la vue',
  'map.enterFullscreen': 'Passer la carte en plein écran',
  'map.fullscreenMap': 'Carte en plein écran',
  'map.fullscreen': 'Plein écran',
  'map.exitFullscreen': 'Quitter le plein écran',
  'map.exitFullscreenAria': 'Quitter la carte en plein écran',
  'map.worldMap': 'Carte du monde',

  'world.mapAlt': 'Carte d’Hyrule',
  'world.stats': 'Stats',
  'world.openStats': 'Ouvrir les statistiques globales',
  'world.globalCompletion': 'Progression globale',
  'world.zone': 'Zone',
  'world.dungeon': 'Donjon',
  'world.noTrackedItems': 'Aucun objet suivi',
  'world.itemsCompleted': '{done} / {total} objets complétés',
  'world.itemsCompletedOf': '{done} sur {total} objets complétés',
  'world.placeDetails': 'Détails de {name}',
  'world.closePlaceInfo': 'Fermer les infos du lieu',
  'world.linkHereLive': 'Link est ici (En direct)',
  'world.linkHereSaved': 'Link est ici (Sauvegardé)',
  'world.openMap': 'Ouvrir la carte',

  'stats.title': 'Progression globale',
  'stats.subtitle': 'Avancement d’Hyrule dans toutes les zones et donjons',
  'stats.close': 'Fermer la progression globale',
  'stats.placesCompleted': '{done} / {total} lieux complétés',
  'stats.overallCompletion': 'Progression totale',
  'stats.byCategory': 'Par catégorie',
  'stats.clickAgainToClear': 'Cliquer à nouveau pour effacer',
  'stats.selectToViewItems': 'Sélectionner pour voir les objets',
  'stats.remainingCount': '({count} restants)',
  'stats.filterCategoryItems': 'Filtrer les objets de la catégorie',
  'stats.remaining': 'Restants',
  'stats.all': 'Tous',
  'stats.closeCategoryItems': 'Fermer les objets {category}',
  'stats.allCollected': 'Tous les objets {category} récupérés !',
  'stats.noItemsInCategory': 'Aucun objet dans cette catégorie.',
  'stats.collected': 'Récupéré',
  'stats.byLocation': 'Par lieu',
  'stats.placeSingular': 'lieu',
  'stats.placePlural': 'lieux',
  'stats.filterLocations': 'Filtrer les lieux',
  'stats.tabAll': 'Tout',
  'stats.tabIncomplete': 'Incomplets',
  'stats.tabZones': 'Zones',
  'stats.tabDungeons': 'Donjons',
  'stats.allLocationsComplete': 'Tous les lieux sont complétés à 100 % !',
  'stats.noLocationsMatch': 'Aucun lieu ne correspond à ce filtre.',

  'place.atlas': 'Atlas',
  'place.inRegion': '{kind} · {region}',
  'place.itemsCount': '{done}/{total} objets',
  'place.hideCount': 'Masquer',
  'place.showItemCount': 'Afficher le compteur',
  'place.about': 'À propos de ce lieu',
  'place.chooseMap': 'Choisir une carte',
  'place.allFloors': 'Tous les étages',
  'place.allFloorsAlt': 'Tous les étages de {place}',
  'place.mapAlt': 'Carte de {place}, {floor}',
  'place.linkOnFloor': 'Link est à cet étage',
  'place.linkOnFloorSaved': 'Link est à cet étage (Sauvegardé)',
  'place.yourPins': 'Vos repères',
  'place.yourPinsFloor': 'Vos repères · {floor}',
  'place.clickFloorToAdd': 'Cliquez sur un étage pour ajouter un repère.',
  'place.clickMapToAdd': 'Cliquez sur la carte pour ajouter un repère.',
  'place.officialPins': 'Repères officiels',
  'place.noMapTitle': 'Aucune carte pour ce lieu',
  'place.noMapWithItems': 'Affichez les repères officiels pour suivre ses objets dans la liste. Les repères personnalisés nécessitent une carte.',
  'place.noMapEmpty': 'Il n’y a aucun objet suivi ici non plus. Les repères personnalisés nécessitent une carte.',

  'panel.showOfficialPins': 'Afficher les repères officiels',
  'panel.filterByAge': 'Filtrer par âge',
  'panel.filterByCategory': 'Filtrer par catégorie',
  'panel.ageChild': 'Enfant',
  'panel.ageAdult': 'Adulte',
  'panel.ageBoth': 'Les deux',
  'panel.ageChildOrAdult': 'Enfant ou adulte',
  'panel.notOnMap': 'Hors carte',
  'panel.nothingToShow': 'Rien à afficher sur cette carte.',
  'panel.markCompleted': 'Marquer comme terminé',
  'panel.completed': 'Terminé',
  'panel.markItemCompleted': 'Marquer {name} comme terminé',
  'panel.hideAgain': 'Masquer à nouveau',
  'panel.type': 'Type',
  'panel.renameItem': 'Renommer {name}',
  'panel.deleteItem': 'Supprimer {name}',
  'panel.closePinInfo': 'Fermer les infos du repère',
  'panel.yourPin': 'votre repère',

  'item.nightOnly': 'De nuit uniquement',
  'item.hint': 'Indice',
  'item.requires': 'Requis',
  'item.imageAlt': '{name}, image {index}',

  'pin.whatDidYouFind': 'Qu’avez-vous trouvé ?',
  'pin.pinName': 'Nom du repère',
  'pin.addPin': 'Ajouter le repère',
  'pin.type.gs': 'Skulltula d’Or',
  'pin.type.heart': 'Quart de Cœur',
  'pin.type.container': 'Réceptacle de Cœur',
  'pin.type.bean': 'Sol pour Haricot Magique',
  'pin.type.fairy': 'Grande Fée',
  'pin.type.bottle': 'Flacon',
  'pin.type.key': 'Clé',
  'pin.type.thought': 'Pensée de Fée',
  'pin.type.other': 'Autre',

  'merge.mergedTitle': 'Fusionné avec un repère officiel',
  'merge.existsTitle': 'Celui-ci existe déjà',
  'merge.description': 'Votre repère était assez proche, le repère officiel le remplace donc.',

  'tracker.live': 'En direct',
  'tracker.waitingForGame': 'En attente du jeu',
  'tracker.waitingNote': 'RPC connecté ; affichage de la sauvegarde en attendant le jeu',
  'tracker.saveOnly': 'Sauvegarde seule',
  'tracker.offlineNote': 'Hors ligne (RPC {emulator} :6545 fermé)',
  'tracker.disconnected': 'Déconnecté',
  'tracker.emulatorTracker': 'Suivi {emulator}',
  'tracker.collapsePanel': 'Réduire le panneau de suivi',
  'tracker.skulltulasTitle': 'Skulltulas d’Or collectées dans cette sauvegarde',
  'tracker.errorPrefix': 'Erreur : {error}',
  'tracker.goToLink': 'Aller à Link',
  'tracker.followLink': 'Suivre Link : {state}',
  'tracker.autoTracking': 'Suivi auto : {state}',
  'tracker.autoTrackingTitle':
    'Suivre automatiquement les Skulltulas, Réceptacles de Cœur, Quarts de Cœur, Haricots Magiques, Grandes Fées, Flacons et Pensées de Fée collectés',
  'tracker.skulltulaCollected': 'Skulltula d’Or collectée !',
  'tracker.dismissNotification': 'Fermer la notification',
  'tracker.ariaSkulltulas': '{count} sur 100 Skulltulas d’Or',
  'tracker.ariaSkulltulasUnavailable': 'Compteur de Skulltulas d’Or indisponible',
  'tracker.ariaLocation': 'Lieu : {location}',

  'floor.child': 'Enfant',
  'floor.adult': 'Adulte',
  'floor.main': 'Principal',

  'filter.prereqOnly': 'Accessibles uniquement',
  'filter.gearButton': 'Équipement',
  'filter.gearTitle': 'Équipement et chants',
  'filter.gearSubtitle': 'Cochez les objets, améliorations et chants possédés pour filtrer les objets accessibles.',
  'filter.syncFromGame': 'Synchroniser depuis le jeu',
  'filter.autoSync': 'Synchro auto',
  'filter.clearAll': 'Tout effacer',
  'filter.group.tools': 'Outils et armes',
  'filter.group.gear': 'Équipement et améliorations',
  'filter.group.songs': 'Chants',
  'filter.group.situational': 'Situationnel',
  'filter.reachableCount': '{count} accessibles',
  'filter.prereqNotice': 'Filtré selon vos prérequis possédés',
  'filter.missingReqs': 'Prérequis manquants',

  'credits.title': 'Crédits et à propos',
  'credits.button': 'Crédits',
  'credits.originalMap': 'Carte interactive d’origine',
  'credits.originalMapDesc': 'Créé par lucasriondel (oot-remake-map)',
  'credits.atlasAuthor': 'Ocarina Atlas',
  'credits.atlasAuthorDesc': 'Télémétrie en direct, lanceur Windows et suivi automatique par antonioalvromero',
  'credits.mapArtwork': 'Cartes et données des objets attribuées à l’origine à Nintendúo (projet amateur non commercial, non affilié à Nintendo).',
  'credits.officialGithub': 'Dépôt GitHub officiel',
  'credits.officialNotice': 'Gratuit et open-source (GNU AGPL-3.0). Versions officielles sur github.com/antonioalvromero/Ocarina-Atlas — les forks doivent conserver les crédits et publier leur source.',
  'credits.close': 'Fermer',
}

const PT_MESSAGES: Record<TranslationKey, string> = {
  'app.title': 'Ocarina Atlas',
  'common.close': 'Fechar',
  'common.cancel': 'Cancelar',
  'common.undo': 'Desfazer',
  'common.dismiss': 'Dispensar',
  'common.retry': 'Tentar novamente',
  'common.rename': 'Renomear',
  'common.delete': 'Excluir',
  'common.on': 'Ligado',
  'common.off': 'Desligado',
  'common.or': 'ou',
  'common.link': 'Link',
  'common.saved': 'Salvo',
  'common.live': 'Ao vivo',
  'common.language': 'Idioma',

  'notFound.title': 'Terra desconhecida',
  'notFound.description': 'Nenhum lugar no atlas corresponde a este endereço.',
  'notFound.backToMap': 'Voltar ao mapa',

  'map.dragHint': '{alt}. Arraste para mover, role para dar zoom ou use as teclas de seta, mais e menos.',
  'map.zoomIn': 'Aumentar zoom',
  'map.zoomOut': 'Diminuir zoom',
  'map.resetView': 'Redefinir visualização',
  'map.enterFullscreen': 'Abrir mapa em tela cheia',
  'map.fullscreenMap': 'Mapa em tela cheia',
  'map.fullscreen': 'Tela cheia',
  'map.exitFullscreen': 'Sair da tela cheia',
  'map.exitFullscreenAria': 'Sair do mapa em tela cheia',
  'map.worldMap': 'Mapa-múndi',

  'world.mapAlt': 'Mapa de Hyrule',
  'world.stats': 'Progresso',
  'world.openStats': 'Abrir estatísticas globais',
  'world.globalCompletion': 'Progresso global',
  'world.zone': 'Zona',
  'world.dungeon': 'Masmorra',
  'world.noTrackedItems': 'Sem itens rastreados',
  'world.itemsCompleted': '{done} / {total} itens concluídos',
  'world.itemsCompletedOf': '{done} de {total} itens concluídos',
  'world.placeDetails': 'Detalhes de {name}',
  'world.closePlaceInfo': 'Fechar informações do local',
  'world.linkHereLive': 'Link está aqui (Ao vivo)',
  'world.linkHereSaved': 'Link está aqui (Salvo)',
  'world.openMap': 'Abrir mapa',

  'stats.title': 'Progresso global',
  'stats.subtitle': 'Conclusão de Hyrule em todas as zonas e masmorras',
  'stats.close': 'Fechar progresso global',
  'stats.placesCompleted': '{done} / {total} locais concluídos',
  'stats.overallCompletion': 'Conclusão geral',
  'stats.byCategory': 'Por categoria',
  'stats.clickAgainToClear': 'Clique novamente para limpar',
  'stats.selectToViewItems': 'Selecione para ver os itens',
  'stats.remainingCount': '({count} restantes)',
  'stats.filterCategoryItems': 'Filtrar itens da categoria',
  'stats.remaining': 'Restantes',
  'stats.all': 'Todos',
  'stats.closeCategoryItems': 'Fechar itens de {category}',
  'stats.allCollected': 'Todos os itens de {category} coletados!',
  'stats.noItemsInCategory': 'Nenhum item nesta categoria.',
  'stats.collected': 'Coletado',
  'stats.byLocation': 'Por localização',
  'stats.placeSingular': 'local',
  'stats.placePlural': 'locais',
  'stats.filterLocations': 'Filtrar localizações',
  'stats.tabAll': 'Tudo',
  'stats.tabIncomplete': 'Incompletos',
  'stats.tabZones': 'Zonas',
  'stats.tabDungeons': 'Masmorras',
  'stats.allLocationsComplete': 'Todas as localizações estão 100% concluídas!',
  'stats.noLocationsMatch': 'Nenhuma localização corresponde a este filtro.',

  'place.atlas': 'Atlas',
  'place.inRegion': '{kind} em {region}',
  'place.itemsCount': '{done}/{total} itens',
  'place.hideCount': 'Ocultar',
  'place.showItemCount': 'Mostrar contagem',
  'place.about': 'Sobre este lugar',
  'place.chooseMap': 'Escolher um mapa',
  'place.allFloors': 'Todos os andares',
  'place.allFloorsAlt': 'Todos os andares de {place}',
  'place.mapAlt': 'Mapa de {place}, {floor}',
  'place.linkOnFloor': 'Link está neste andar',
  'place.linkOnFloorSaved': 'Link está neste andar (Salvo)',
  'place.yourPins': 'Seus marcadores',
  'place.yourPinsFloor': 'Seus marcadores · {floor}',
  'place.clickFloorToAdd': 'Clique em qualquer andar para adicionar um marcador.',
  'place.clickMapToAdd': 'Clique no mapa para adicionar um marcador.',
  'place.officialPins': 'Marcadores oficiais',
  'place.noMapTitle': 'Sem mapa para este local',
  'place.noMapWithItems': 'Mostre os marcadores oficiais para acompanhar os itens na lista. Marcadores personalizados precisam de um mapa.',
  'place.noMapEmpty': 'Também não há itens rastreados aqui. Marcadores personalizados precisam de um mapa.',

  'panel.showOfficialPins': 'Mostrar marcadores oficiais',
  'panel.filterByAge': 'Filtrar por idade',
  'panel.filterByCategory': 'Filtrar por categoria',
  'panel.ageChild': 'Criança',
  'panel.ageAdult': 'Adulto',
  'panel.ageBoth': 'Ambos',
  'panel.ageChildOrAdult': 'Criança ou adulto',
  'panel.notOnMap': 'Fora do mapa',
  'panel.nothingToShow': 'Nada para mostrar neste mapa.',
  'panel.markCompleted': 'Marcar como concluído',
  'panel.completed': 'Concluído',
  'panel.markItemCompleted': 'Marcar {name} como concluído',
  'panel.hideAgain': 'Ocultar novamente',
  'panel.type': 'Tipo',
  'panel.renameItem': 'Renomear {name}',
  'panel.deleteItem': 'Excluir {name}',
  'panel.closePinInfo': 'Fechar informações do marcador',
  'panel.yourPin': 'seu marcador',

  'item.nightOnly': 'Somente à noite',
  'item.hint': 'Dica',
  'item.requires': 'Requer',
  'item.imageAlt': '{name}, imagem {index}',

  'pin.whatDidYouFind': 'O que você encontrou?',
  'pin.pinName': 'Nome do marcador',
  'pin.addPin': 'Adicionar marcador',
  'pin.type.gs': 'Skulltula Dourada',
  'pin.type.heart': 'Pedaço de Coração',
  'pin.type.container': 'Recipiente de Coração',
  'pin.type.bean': 'Solo de Feijão Mágico',
  'pin.type.fairy': 'Grande Fada',
  'pin.type.bottle': 'Garrafa',
  'pin.type.key': 'Chave',
  'pin.type.thought': 'Pensamento de Fada',
  'pin.type.other': 'Outro',

  'merge.mergedTitle': 'Mesclado com marcador oficial',
  'merge.existsTitle': 'Este já existe',
  'merge.description': 'Seu marcador estava perto o suficiente, então o oficial o substituiu.',

  'tracker.live': 'Ao vivo',
  'tracker.waitingForGame': 'Aguardando o jogo',
  'tracker.waitingNote': 'RPC conectado; exibindo dados salvos até entrar no jogo',
  'tracker.saveOnly': 'Apenas salvo',
  'tracker.offlineNote': 'Offline (RPC do {emulator} :6545 fechado)',
  'tracker.disconnected': 'Desconectado',
  'tracker.emulatorTracker': 'Rastreador do {emulator}',
  'tracker.collapsePanel': 'Recolher painel de rastreamento',
  'tracker.skulltulasTitle': 'Skulltulas Douradas coletadas neste save',
  'tracker.errorPrefix': 'Erro: {error}',
  'tracker.goToLink': 'Ir para Link',
  'tracker.followLink': 'Seguir Link: {state}',
  'tracker.autoTracking': 'Rastreamento automático: {state}',
  'tracker.autoTrackingTitle':
    'Rastrear automaticamente Skulltulas, Recipientes de Coração, Pedaços de Coração, Feijões Mágicos, Grandes Fadas, Garrafas e Pensamentos de Fada coletados',
  'tracker.skulltulaCollected': 'Skulltula Dourada coletada!',
  'tracker.dismissNotification': 'Dispensar notificação',
  'tracker.ariaSkulltulas': '{count} de 100 Skulltulas Douradas',
  'tracker.ariaSkulltulasUnavailable': 'Contagem de Skulltulas Douradas indisponível',
  'tracker.ariaLocation': 'Localização: {location}',

  'floor.child': 'Criança',
  'floor.adult': 'Adulto',
  'floor.main': 'Principal',

  'filter.prereqOnly': 'Apenas alcançáveis',
  'filter.gearButton': 'Meu equipamento',
  'filter.gearTitle': 'Equipamentos e canções',
  'filter.gearSubtitle': 'Marque os itens, melhorias e canções que você possui para filtrar os coletáveis alcançáveis.',
  'filter.syncFromGame': 'Sincronizar do jogo',
  'filter.autoSync': 'Sincronização automática',
  'filter.clearAll': 'Limpar tudo',
  'filter.group.tools': 'Ferramentas e armas',
  'filter.group.gear': 'Equipamentos e melhorias',
  'filter.group.songs': 'Canções',
  'filter.group.situational': 'Situacional',
  'filter.reachableCount': '{count} alcançáveis',
  'filter.prereqNotice': 'Filtrado pelos seus pré-requisitos atuais',
  'filter.missingReqs': 'Pré-requisitos faltando',

  'credits.title': 'Créditos e sobre',
  'credits.button': 'Créditos',
  'credits.originalMap': 'Mapa interativo original',
  'credits.originalMapDesc': 'Criado por lucasriondel (oot-remake-map)',
  'credits.atlasAuthor': 'Ocarina Atlas',
  'credits.atlasAuthorDesc': 'Telemetria ao vivo, inicializador e rastreamento automático por antonioalvromero',
  'credits.mapArtwork': 'Arte dos mapas e dados de coletáveis originalmente atribuídos a Nintendúo (projeto de fãs sem fins lucrativos, não afiliado à Nintendo).',
  'credits.officialGithub': 'Repositório oficial no GitHub',
  'credits.officialNotice': 'Gratuito e de código aberto (GNU AGPL-3.0). Lançamentos oficiais em github.com/antonioalvromero/Ocarina-Atlas — forks devem preservar os créditos e compartilhar o código-fonte.',
  'credits.close': 'Fechar',
}

export const MESSAGES: Record<Locale, Record<TranslationKey, string>> = {
  en: EN_MESSAGES,
  es: ES_MESSAGES,
  fr: FR_MESSAGES,
  pt: PT_MESSAGES,
}

export const CATEGORY_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    gs: 'Gold Skulltulas',
    heart: 'Pieces of Heart',
    container: 'Heart Containers',
    bean: 'Magic Beans',
    fairy: 'Great Fairies',
    bottle: 'Bottles',
    thought: 'Fairy Thoughts',
  },
  es: {
    gs: 'Skulltulas Doradas',
    heart: 'Piezas de Corazón',
    container: 'Contenedores de Corazón',
    bean: 'Judías Mágicas',
    fairy: 'Grandes Hadas',
    bottle: 'Botellas',
    thought: 'Pensamientos de Hada',
  },
  fr: {
    gs: 'Skulltulas d’Or',
    heart: 'Quarts de Cœur',
    container: 'Réceptacles de Cœur',
    bean: 'Haricots Magiques',
    fairy: 'Grandes Fées',
    bottle: 'Flacons',
    thought: 'Pensées de Fée',
  },
  pt: {
    gs: 'Skulltulas Douradas',
    heart: 'Pedaços de Coração',
    container: 'Recipientes de Coração',
    bean: 'Feijões Mágicos',
    fairy: 'Grandes Fadas',
    bottle: 'Garrafas',
    thought: 'Pensamentos de Fada',
  },
}

export const PLACE_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    kokiri: 'Kokiri Forest',
    perdido: 'Lost Woods',
    prado: 'Sacred Forest Meadow',
    llanura: 'Hyrule Field',
    lonlon: 'Lon Lon Ranch',
    ciudadela: 'Hyrule Castle Town',
    castillo: 'Hyrule Castle',
    kakariko: 'Kakariko Village',
    cementerio: 'Graveyard',
    sendero: 'Death Mountain Trail',
    goron: 'Goron City',
    crater: 'Death Mountain Crater',
    rio: "Zora's River",
    dominio: "Zora's Domain",
    fuente: "Zora's Fountain",
    lago: 'Lake Hylia',
    valle: 'Gerudo Valley',
    fortaleza: "Gerudo's Fortress",
    desierto: 'Haunted Wasteland',
    coloso: 'Desert Colossus',
    deku: 'Inside the Deku Tree',
    dodongos: "Dodongo's Cavern",
    jabu: "Inside Jabu-Jabu's Belly",
    bosque: 'Forest Temple',
    fuego: 'Fire Temple',
    agua: 'Water Temple',
    sombra: 'Shadow Temple',
    espiritu: 'Spirit Temple',
    pozo: 'Bottom of the Well',
    hielo: 'Ice Cavern',
    gerudo: 'Gerudo Training Ground',
    ganon: "Ganon's Castle",
  },
  es: {
    kokiri: 'Bosque Kokiri',
    perdido: 'Bosque Perdido',
    prado: 'Prado Sagrado del Bosque',
    llanura: 'Pradera de Hyrule',
    lonlon: 'Rancho Lon Lon',
    ciudadela: 'Ciudadela de Hyrule',
    castillo: 'Castillo de Hyrule',
    kakariko: 'Aldea Kakariko',
    cementerio: 'Cementerio',
    sendero: 'Senda de la Montaña de la Muerte',
    goron: 'Ciudad Goron',
    crater: 'Cráter de la Montaña de la Muerte',
    rio: 'Río Zora',
    dominio: 'Dominio de los Zora',
    fuente: 'Fuente Zora',
    lago: 'Lago Hylia',
    valle: 'Valle Gerudo',
    fortaleza: 'Fortaleza Gerudo',
    desierto: 'Yermo Encantado',
    coloso: 'Coloso del Desierto',
    deku: 'Interior del Árbol Deku',
    dodongos: 'Cueva de los Dodongos',
    jabu: 'Tripa de Jabu-Jabu',
    bosque: 'Templo del Bosque',
    fuego: 'Templo del Fuego',
    agua: 'Templo del Agua',
    sombra: 'Templo de las Sombras',
    espiritu: 'Templo del Espíritu',
    pozo: 'Fondo del Pozo',
    hielo: 'Caverna de Hielo',
    gerudo: 'Centro de Instrucción Gerudo',
    ganon: 'Castillo de Ganon',
  },
  fr: {
    kokiri: 'Forêt Kokiri',
    perdido: 'Bois Perdus',
    prado: 'Bosquet Sacré',
    llanura: 'Plaine d’Hyrule',
    lonlon: 'Ranch Lon Lon',
    ciudadela: 'Bourg d’Hyrule',
    castillo: 'Château d’Hyrule',
    kakariko: 'Village Cocorico',
    cementerio: 'Cimetière',
    sendero: 'Chemin du Péril',
    goron: 'Village Goron',
    crater: 'Cratère du Péril',
    rio: 'Rivière Zora',
    dominio: 'Domaine Zora',
    fuente: 'Fontaine Zora',
    lago: 'Lac Hylia',
    valle: 'Vallée Gerudo',
    fortaleza: 'Forteresse Gerudo',
    desierto: 'Désert Hanté',
    coloso: 'Colosse du Désert',
    deku: 'Arbre Mojo',
    dodongos: 'Caverne Dodongo',
    jabu: 'Ventre de Jabu-Jabu',
    bosque: 'Temple de la Forêt',
    fuego: 'Temple du Feu',
    agua: 'Temple de l’Eau',
    sombra: 'Temple de l’Ombre',
    espiritu: 'Temple de l’Esprit',
    pozo: 'Puits',
    hielo: 'Caverne Polaire',
    gerudo: 'Gymnase Gerudo',
    ganon: 'Château de Ganon',
  },
  pt: {
    kokiri: 'Floresta Kokiri',
    perdido: 'Bosque Perdido',
    prado: 'Campina Sagrada da Floresta',
    llanura: 'Campos de Hyrule',
    lonlon: 'Rancho Lon Lon',
    ciudadela: 'Cidade do Castelo de Hyrule',
    castillo: 'Castelo de Hyrule',
    kakariko: 'Vila Kakariko',
    cementerio: 'Cemitério',
    sendero: 'Trilha da Montanha da Morte',
    goron: 'Cidade Goron',
    crater: 'Cratera da Montanha da Morte',
    rio: 'Rio Zora',
    dominio: 'Domínio dos Zora',
    fuente: 'Fonte Zora',
    lago: 'Lago Hylia',
    valle: 'Vale Gerudo',
    fortaleza: 'Fortaleza Gerudo',
    desierto: 'Deserto Assombrado',
    coloso: 'Colosso do Deserto',
    deku: 'Interior da Árvore Deku',
    dodongos: 'Caverna dos Dodongos',
    jabu: 'Barriga de Jabu-Jabu',
    bosque: 'Templo da Floresta',
    fuego: 'Templo do Fogo',
    agua: 'Templo da Água',
    sombra: 'Templo das Sombras',
    espiritu: 'Templo do Espírito',
    pozo: 'Fundo do Poço',
    hielo: 'Caverna de Gelo',
    gerudo: 'Campo de Treinamento Gerudo',
    ganon: 'Castelo de Ganon',
  },
}

export const REGION_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    Forest: 'Forest',
    'Central Hyrule': 'Central Hyrule',
    Castle: 'Castle',
    Kakariko: 'Kakariko',
    'Death Mountain': 'Death Mountain',
    Zora: 'Zora',
    'Lake Hylia': 'Lake Hylia',
    Gerudo: 'Gerudo',
  },
  es: {
    Forest: 'Bosque',
    'Central Hyrule': 'Hyrule Central',
    Castle: 'Castillo',
    Kakariko: 'Kakariko',
    'Death Mountain': 'Montaña de la Muerte',
    Zora: 'Zora',
    'Lake Hylia': 'Lago Hylia',
    Gerudo: 'Gerudo',
  },
  fr: {
    Forest: 'Forêt',
    'Central Hyrule': 'Hyrule central',
    Castle: 'Château',
    Kakariko: 'Cocorico',
    'Death Mountain': 'Mont du Péril',
    Zora: 'Zora',
    'Lake Hylia': 'Lac Hylia',
    Gerudo: 'Gerudo',
  },
  pt: {
    Forest: 'Floresta',
    'Central Hyrule': 'Hyrule Central',
    Castle: 'Castelo',
    Kakariko: 'Kakariko',
    'Death Mountain': 'Montanha da Morte',
    Zora: 'Zora',
    'Lake Hylia': 'Lago Hylia',
    Gerudo: 'Gerudo',
  },
}

export const REQUIREMENT_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    bugs: 'Bottled Bug',
    bombs: 'Bombs',
    boomerang: 'Boomerang',
    slingshot: 'Fairy Slingshot',
    bow: 'Fairy Bow',
    hookshot: 'Hookshot',
    longshot: 'Longshot',
    'megaton-hammer': 'Megaton Hammer',
    'iron-boots': 'Iron Boots',
    'golden-scale': 'Golden Scale',
    'silver-gauntlets': 'Silver Gauntlets',
    'lens-of-truth': 'Lenses of Truth',
    ocarina: 'Ocarina',
    'sarias-song': "Saria's Song",
    'song-of-storms': 'Song of Storms',
    epona: 'Epona',
    'planted-bean': 'Planted Magic Bean',
    bombchus: 'Bombchus',
    'fire-arrows': 'Fire Arrows',
    'hover-boots': 'Hover Boots',
    'silver-scale': 'Silver Scale',
    'goron-bracelet': "Goron's Bracelet",
    'golden-gauntlets': 'Golden Gauntlets',
    'mirror-shield': 'Mirror Shield',
    'zora-tunic': 'Zora Tunic',
    'deku-sticks': 'Deku Sticks',
    'dins-fire': "Din's Fire",
    'blue-fire': 'Blue Fire',
    'zeldas-lullaby': "Zelda's Lullaby",
    'eponas-song': "Epona's Song",
    'suns-song': "Sun's Song",
    'song-of-time': 'Song of Time',
    'scarecrows-song': "Scarecrow's Song",
    'bolero-of-fire': 'Bolero of Fire',
    'gerudo-card': 'Gerudo Token',
  },
  es: {
    bugs: 'Bicho en botella',
    bombs: 'Bombas',
    boomerang: 'Bumerán',
    slingshot: 'Tirachinas de las Hadas',
    bow: 'Arco de las Hadas',
    hookshot: 'Gancho',
    longshot: 'Supergancho',
    'megaton-hammer': 'Martillo Megatón',
    'iron-boots': 'Botas de Hierro',
    'golden-scale': 'Escama Dorada',
    'silver-gauntlets': 'Guanteletes Plateados',
    'lens-of-truth': 'Lente de la Verdad',
    ocarina: 'Ocarina',
    'sarias-song': 'Canción de Saria',
    'song-of-storms': 'Canción de la Tormenta',
    epona: 'Epona',
    'planted-bean': 'Judía Mágica plantada',
    bombchus: 'Bombchus',
    'fire-arrows': 'Flechas de Fuego',
    'hover-boots': 'Botas Flotadoras',
    'silver-scale': 'Escama Plateada',
    'goron-bracelet': 'Brazalete Goron',
    'golden-gauntlets': 'Guanteletes Dorados',
    'mirror-shield': 'Escudo Espejo',
    'zora-tunic': 'Túnica Zora',
    'deku-sticks': 'Palos Deku',
    'dins-fire': 'Fuego de Din',
    'blue-fire': 'Fuego Azul',
    'zeldas-lullaby': 'Nana de Zelda',
    'eponas-song': 'Canción de Epona',
    'suns-song': 'Canción del Sol',
    'song-of-time': 'Canción del Tiempo',
    'scarecrows-song': 'Canción del Espantapájaros',
    'bolero-of-fire': 'Bolero del Fuego',
    'gerudo-card': 'Pase Gerudo',
  },
  fr: {
    bugs: 'Insecte en flacon',
    bombs: 'Bombes',
    boomerang: 'Boomerang',
    slingshot: 'Lance-Pierre des Fées',
    bow: 'Arc des Fées',
    hookshot: 'Grappin',
    longshot: 'Super Grappin',
    'megaton-hammer': 'Masse des Titans',
    'iron-boots': 'Bottes de Plomb',
    'golden-scale': 'Écaille d’Or',
    'silver-gauntlets': 'Gantelets d’Argent',
    'lens-of-truth': 'Monocle de Vérité',
    ocarina: 'Ocarina',
    'sarias-song': 'Chant de Saria',
    'song-of-storms': 'Chant des Tempêtes',
    epona: 'Epona',
    'planted-bean': 'Haricot Magique planté',
    bombchus: 'Bombchus',
    'fire-arrows': 'Flèches de Feu',
    'hover-boots': 'Bottes des Airs',
    'silver-scale': 'Écaille d’Argent',
    'goron-bracelet': 'Bracelet Goron',
    'golden-gauntlets': 'Gantelets d’Or',
    'mirror-shield': 'Bouclier Miroir',
    'zora-tunic': 'Tunique Zora',
    'deku-sticks': 'Bâtons Mojo',
    'dins-fire': 'Feu de Din',
    'blue-fire': 'Flamme Bleue',
    'zeldas-lullaby': 'Berceuse de Zelda',
    'eponas-song': 'Chant d’Epona',
    'suns-song': 'Chant du Soleil',
    'song-of-time': 'Chant du Temps',
    'scarecrows-song': 'Chant de l’Épouvantail',
    'bolero-of-fire': 'Boléro du Feu',
    'gerudo-card': 'Carte Gerudo',
  },
  pt: {
    bugs: 'Inseto na garrafa',
    bombs: 'Bombas',
    boomerang: 'Bumerangue',
    slingshot: 'Estilingue das Fadas',
    bow: 'Arco das Fadas',
    hookshot: 'Gancho',
    longshot: 'Supergancho',
    'megaton-hammer': 'Martelo Megaton',
    'iron-boots': 'Botas de Ferro',
    'golden-scale': 'Escama Dourada',
    'silver-gauntlets': 'Manoplas de Prata',
    'lens-of-truth': 'Lentes da Verdade',
    ocarina: 'Ocarina',
    'sarias-song': 'Canção de Saria',
    'song-of-storms': 'Canção das Tempestades',
    epona: 'Epona',
    'planted-bean': 'Feijão Mágico plantado',
    bombchus: 'Bombchus',
    'fire-arrows': 'Flechas de Fogo',
    'hover-boots': 'Botas Flutuantes',
    'silver-scale': 'Escama de Prata',
    'goron-bracelet': 'Bracelete Goron',
    'golden-gauntlets': 'Manoplas Douradas',
    'mirror-shield': 'Escudo Espelho',
    'zora-tunic': 'Túnica Zora',
    'deku-sticks': 'Gravetos Deku',
    'dins-fire': 'Fogo de Din',
    'blue-fire': 'Fogo Azul',
    'zeldas-lullaby': 'Canção de Ninar de Zelda',
    'eponas-song': 'Canção de Epona',
    'suns-song': 'Canção do Sol',
    'song-of-time': 'Canção do Tempo',
    'scarecrows-song': 'Canção do Espantalho',
    'bolero-of-fire': 'Bolero do Fogo',
    'gerudo-card': 'Passe Gerudo',
  },
}

export type TranslationParams = Record<string, string | number>

export function formatMessage(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}

export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const dict = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE]
  const template = dict[key] ?? MESSAGES[DEFAULT_LOCALE][key]
  return formatMessage(template, params)
}

export function translateCategory(locale: Locale, key: string, fallback?: string): string {
  return CATEGORY_LABELS[locale]?.[key] ?? CATEGORY_LABELS[DEFAULT_LOCALE][key] ?? fallback ?? key
}

export function translatePlace(locale: Locale, id: string, fallback?: string): string {
  return PLACE_LABELS[locale]?.[id] ?? PLACE_LABELS[DEFAULT_LOCALE][id] ?? fallback ?? id
}

export function translateRegion(locale: Locale, region: string): string {
  return REGION_LABELS[locale]?.[region] ?? REGION_LABELS[DEFAULT_LOCALE][region] ?? region
}

export function translateRequirement(locale: Locale, requirement: ItemRequirement): string {
  const keys = typeof requirement === 'string' ? [requirement] : requirement
  const labels = REQUIREMENT_LABELS[locale] ?? REQUIREMENT_LABELS[DEFAULT_LOCALE]
  const joiner = ` ${translate(locale, 'common.or')} `
  return keys.map((key) => labels[key] ?? REQUIREMENT_LABELS[DEFAULT_LOCALE][key] ?? key).join(joiner)
}

export function translatePlaceIntro(placeId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.places?.[placeId]?.intro
  return translated && translated.length > 0 ? translated : fallback
}

export function translateItemName(itemId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.items?.[itemId]?.name
  return translated && translated.length > 0 ? translated : fallback
}

export function translateItemDesc(itemId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.items?.[itemId]?.desc
  return translated && translated.length > 0 ? translated : fallback
}

export function translateItemHint(itemId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.items?.[itemId]?.hint
  return translated && translated.length > 0 ? translated : fallback
}

export type I18nApi = {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
  tCategory: (key: string, fallback?: string) => string
  tPlace: (id: string, fallback?: string) => string
  tRegion: (region: string) => string
  tRequirement: (requirement: ItemRequirement) => string
  tPlaceIntro: (placeId: string, fallback: string) => string
  tItemName: (itemId: string, fallback: string) => string
  tItemDesc: (itemId: string, fallback: string) => string
  tItemHint: (itemId: string, fallback: string) => string
}

/**
 * React hook subscribing to the active locale via useSyncExternalStore.
 * Server snapshot always returns 'en' for SSR hydration safety.
 */
export function useI18n(): I18nApi {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getServerLocale)

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  )
  const tCategory = useCallback(
    (key: string, fallback?: string) => translateCategory(locale, key, fallback),
    [locale],
  )
  const tPlace = useCallback(
    (id: string, fallback?: string) => translatePlace(locale, id, fallback),
    [locale],
  )
  const tRegion = useCallback(
    (region: string) => translateRegion(locale, region),
    [locale],
  )
  const tRequirement = useCallback(
    (requirement: ItemRequirement) => translateRequirement(locale, requirement),
    [locale],
  )
  const tPlaceIntro = useCallback(
    (placeId: string, fallback: string) => translatePlaceIntro(placeId, fallback, locale),
    [locale],
  )
  const tItemName = useCallback(
    (itemId: string, fallback: string) => translateItemName(itemId, fallback, locale),
    [locale],
  )
  const tItemDesc = useCallback(
    (itemId: string, fallback: string) => translateItemDesc(itemId, fallback, locale),
    [locale],
  )
  const tItemHint = useCallback(
    (itemId: string, fallback: string) => translateItemHint(itemId, fallback, locale),
    [locale],
  )

  return useMemo(
    () => ({
      locale,
      setLocale,
      t,
      tCategory,
      tPlace,
      tRegion,
      tRequirement,
      tPlaceIntro,
      tItemName,
      tItemDesc,
      tItemHint,
    }),
    [locale, t, tCategory, tPlace, tRegion, tRequirement, tPlaceIntro, tItemName, tItemDesc, tItemHint],
  )
}
