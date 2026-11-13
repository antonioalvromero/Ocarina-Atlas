import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { LichiiTelemetryState } from '../lib/lichii-types'
import type { SkulltulaToast } from '../lib/useLichiiTracker'
import {
  buildOrbAriaLabel,
  formatOrbSkulltulaCount,
  getConnectionView,
  INITIAL_PANEL_INTERACTION,
  isPanelOpen,
  LichiiStatusPanel,
  reducePanelInteraction,
  shouldIgnoreHoverPointer,
  shouldIgnorePointerFocus,
  type LichiiStatusPanelProps,
} from './LichiiStatusPanel'

function makeState(overrides: Partial<LichiiTelemetryState> = {}): LichiiTelemetryState {
  return {
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
    updatedAt: 0,
    ...overrides,
  }
}

function makeProps(overrides: Partial<LichiiStatusPanelProps> = {}): LichiiStatusPanelProps {
  return {
    state: makeState(),
    followPlayer: true,
    onToggleFollow: vi.fn(),
    autoMarkSkulltulas: true,
    onToggleAutoMark: vi.fn(),
    toasts: [],
    onDismissToast: vi.fn(),
    ...overrides,
  }
}

function renderPanelText(props: LichiiStatusPanelProps): string {
  return renderToString(createElement(LichiiStatusPanel, props)).replace(/<!-- -->/g, '')
}

describe('getConnectionView', () => {
  it('returns live green pulse view only for live memory state', () => {
    const view = getConnectionView(
      makeState({ connected: true, emulatorRunning: true, source: 'memory' }),
    )
    expect(view.tone).toBe('live')
    expect(view.label).toBe('Lichii · Live')
    expect(view.dotClass).toBe('bg-moss')
    expect(view.pulse).toBe(true)
    expect(view.note).toBeNull()
  })

  it('returns solid amber view when connected and waiting for game', () => {
    const view = getConnectionView(
      makeState({ connected: true, emulatorRunning: false, source: 'save' }),
    )
    expect(view.tone).toBe('waiting')
    expect(view.label).toBe('Lichii · Waiting for game')
    expect(view.dotClass).toBe('bg-[#e6b450]')
    expect(view.pulse).toBe(false)
    expect(view.note).toBe('RPC connected; showing save data until in-game')
  })

  it('returns save-only amber view when disconnected with save data', () => {
    const view = getConnectionView(
      makeState({ connected: false, emulatorRunning: false, source: 'save' }),
    )
    expect(view.tone).toBe('save')
    expect(view.label).toBe('Lichii · Save only')
    expect(view.dotClass).toBe('bg-[#e6b450]/85')
    expect(view.pulse).toBe(false)
    expect(view.note).toBe('Offline (Lichii RPC :6545 closed)')
  })

  it('returns muted disconnected view when offline with no save', () => {
    const view = getConnectionView(makeState())
    expect(view.tone).toBe('disconnected')
    expect(view.label).toBe('Lichii · Disconnected')
    expect(view.dotClass).toBe('bg-parchment-600')
    expect(view.pulse).toBe(false)
    expect(view.note).toBeNull()
  })

  it('returns ember indicator without pulse when error is present', () => {
    const view = getConnectionView(
      makeState({ connected: true, emulatorRunning: true, source: 'memory' }),
      'HTTP 503',
    )
    expect(view.tone).toBe('error')
    expect(view.dotClass).toBe('bg-ember')
    expect(view.pulse).toBe(false)
  })

  it('uses Fritchii label and offline RPC note when emulator is fritchii', () => {
    const liveView = getConnectionView(
      makeState({ connected: true, emulatorRunning: true, emulator: 'fritchii', source: 'memory' }),
    )
    expect(liveView.label).toBe('Fritchii · Live')

    const saveView = getConnectionView(
      makeState({ connected: false, emulatorRunning: false, emulator: 'fritchii', source: 'save' }),
    )
    expect(saveView.label).toBe('Fritchii · Save only')
    expect(saveView.note).toBe('Offline (Fritchii RPC :6545 closed)')
    expect(buildOrbAriaLabel(makeState({ emulator: 'fritchii', source: 'save' }), saveView)).toBe(
      'Fritchii emulator tracker: Fritchii · Save only. Gold Skulltula count unavailable',
    )
  })
})

describe('orb helpers', () => {
  it('formats skulltula counts compactly including zero and null', () => {
    expect(formatOrbSkulltulaCount(0)).toBe('0')
    expect(formatOrbSkulltulaCount(42)).toBe('42')
    expect(formatOrbSkulltulaCount(100)).toBe('100')
    expect(formatOrbSkulltulaCount(null)).toBe('—')
  })

  it('builds English accessible orb labels with status, count, floor, and error', () => {
    const liveState = makeState({
      connected: true,
      emulatorRunning: true,
      source: 'memory',
      placeName: 'Spirit Temple',
      mapId: 'S1',
      skulltulaCount: 42,
    })
    const liveLabel = buildOrbAriaLabel(liveState, getConnectionView(liveState))
    expect(liveLabel).toBe(
      'Lichii emulator tracker: Lichii · Live. 42 of 100 Gold Skulltulas. Location: Spirit Temple (B1)',
    )

    const errorState = makeState({ mapId: 'principal', placeName: 'Kokiri Forest' })
    const errorLabel = buildOrbAriaLabel(
      errorState,
      getConnectionView(errorState, 'Connection failed'),
      'Connection failed',
    )
    expect(errorLabel).toBe(
      'Lichii emulator tracker: Lichii · Disconnected. Error: Connection failed. Gold Skulltula count unavailable. Location: Kokiri Forest',
    )
  })

  it('ignores touch pointers and synthetic hover events right after touch', () => {
    expect(shouldIgnoreHoverPointer('touch', 0, 1000)).toBe(true)
    expect(shouldIgnoreHoverPointer('mouse', 900, 1100)).toBe(true)
    expect(shouldIgnoreHoverPointer('mouse', 500, 1000)).toBe(false)
    expect(shouldIgnoreHoverPointer('mouse', 0, 1000)).toBe(false)
  })

  it('ignores delayed touch/pointer focus within the guard window so taps do not double-toggle', () => {
    expect(
      shouldIgnorePointerFocus({ pointerActive: true, lastPointerAt: 0, lastTouchAt: 0, now: 1000 }),
    ).toBe(true)
    expect(
      shouldIgnorePointerFocus({ pointerActive: false, lastPointerAt: 0, lastTouchAt: 900, now: 1050 }),
    ).toBe(true)
    expect(
      shouldIgnorePointerFocus({ pointerActive: false, lastPointerAt: 850, lastTouchAt: 0, now: 1000 }),
    ).toBe(true)
    expect(
      shouldIgnorePointerFocus({ pointerActive: false, lastPointerAt: 400, lastTouchAt: 400, now: 1000 }),
    ).toBe(false)
  })
})

describe('panel expand/collapse state machine', () => {
  it('opens on desktop hover and closes on grace timeout', () => {
    const hovered = reducePanelInteraction(INITIAL_PANEL_INTERACTION, { type: 'hoverEnter' })
    expect(isPanelOpen(hovered)).toBe(true)

    const closed = reducePanelInteraction(hovered, { type: 'hoverLeaveTimeout' })
    expect(isPanelOpen(closed)).toBe(false)
  })

  it('pins on mouse click while hovered and collapses on second click', () => {
    const hovered = reducePanelInteraction(INITIAL_PANEL_INTERACTION, { type: 'hoverEnter' })
    const pinned = reducePanelInteraction(hovered, { type: 'orbActivate', mode: 'mouse' })
    const afterLeave = reducePanelInteraction(pinned, { type: 'hoverLeaveTimeout' })
    expect(isPanelOpen(afterLeave)).toBe(true)

    const unpinned = reducePanelInteraction(afterLeave, { type: 'orbActivate', mode: 'mouse' })
    expect(isPanelOpen(unpinned)).toBe(false)
  })

  it('toggles cleanly on touch taps and collapses on outside tap or collapse action', () => {
    const opened = reducePanelInteraction(INITIAL_PANEL_INTERACTION, {
      type: 'orbActivate',
      mode: 'touch',
    })
    expect(isPanelOpen(opened)).toBe(true)

    const closedBySecondTap = reducePanelInteraction(opened, {
      type: 'orbActivate',
      mode: 'touch',
    })
    expect(isPanelOpen(closedBySecondTap)).toBe(false)

    const collapsed = reducePanelInteraction(opened, { type: 'collapse' })
    expect(isPanelOpen(collapsed)).toBe(false)
  })

  it('supports keyboard focus inside, Enter/Space toggle, and Escape collapse', () => {
    const focused = reducePanelInteraction(INITIAL_PANEL_INTERACTION, { type: 'focusIn' })
    expect(isPanelOpen(focused)).toBe(true)

    const toggledClosed = reducePanelInteraction(focused, {
      type: 'orbActivate',
      mode: 'keyboard',
    })
    expect(isPanelOpen(toggledClosed)).toBe(false)

    const toggledOpen = reducePanelInteraction(toggledClosed, {
      type: 'orbActivate',
      mode: 'keyboard',
    })
    expect(isPanelOpen(toggledOpen)).toBe(true)

    const escaped = reducePanelInteraction(toggledOpen, { type: 'collapse' })
    expect(isPanelOpen(escaped)).toBe(false)

    const blurred = reducePanelInteraction(focused, { type: 'focusOut' })
    expect(isPanelOpen(blurred)).toBe(false)
  })
})

describe('LichiiStatusPanel SSR rendering', () => {
  it('renders collapsed circular orb and preserves all telemetry controls', () => {
    const html = renderPanelText(
      makeProps({
        state: makeState({
          connected: true,
          emulatorRunning: true,
          source: 'memory',
          placeName: 'Spirit Temple',
          mapId: 'S1',
          age: 'adult',
          skulltulaCount: 42,
          position: { x: 12.34, y: 45.67, z: -78.91, yaw: 90 },
        }),
        onJumpToPlayer: vi.fn(),
      }),
    )

    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls=')
    expect(html).toContain('flex-col-reverse')
    expect(html).toContain('inert=""')
    expect(html.indexOf('aria-expanded="false"')).toBeLessThan(html.indexOf('role="region"'))
    expect(html).toContain('rounded-full')
    expect(html).toContain('size-14')
    expect(html).toContain('animate-ping')
    expect(html).toContain('Lichii · Live')
    expect(html).toContain('Spirit Temple')
    expect(html).toContain('B1')
    expect(html).toContain('(adult)')
    expect(html).toContain('42/100')
    expect(html).toContain('Go to Link')
    expect(html).toContain('Follow Link: On')
    expect(html).toContain('Auto-Skulltula: On')
    expect(html).toContain('(12.3, 45.7, -78.9)')
    expect(html).toContain('Collapse tracker panel')
  })

  it('renders error retry and independent Skulltula pickup toasts', () => {
    const toast: SkulltulaToast = {
      id: 'espiritu-gs-04-1',
      itemId: 'espiritu-gs-04',
      itemName: 'West Wall Torch',
      placeName: 'Spirit Temple',
      skulltulaCount: 43,
      timestamp: 1000,
    }
    const html = renderPanelText(
      makeProps({
        state: makeState(),
        error: 'HTTP 500',
        onRetry: vi.fn(),
        toasts: [toast],
      }),
    )

    expect(html).not.toContain('animate-ping')
    expect(html).toContain('bg-ember')
    expect(html).toContain('Error: HTTP 500')
    expect(html).toContain('Retry')
    expect(html).toContain('Gold Skulltula collected!')
    expect(html).toContain('West Wall Torch')
    expect(html).toContain('(#43)')
  })
})
