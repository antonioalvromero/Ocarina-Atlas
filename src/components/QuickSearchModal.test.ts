import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { dataset } from '../lib/data'
import {
  isEditableTarget,
  QuickSearchModal,
  shouldTriggerQuickSearch,
} from './QuickSearchModal'

describe('QuickSearchModal rendering', () => {
  it('renders nothing when closed', () => {
    const html = renderToString(
      createElement(QuickSearchModal, {
        open: false,
        onClose: vi.fn(),
        onNavigate: vi.fn(),
      }),
    )
    expect(html).toBe('')
  })

  it('renders accessible dialog attributes and quick-browse places when open', () => {
    const html = renderToString(
      createElement(QuickSearchModal, {
        open: true,
        onClose: vi.fn(),
        onNavigate: vi.fn(),
      }),
    ).replace(/<!-- -->/g, '')

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-overlay-open="true"')
    expect(html).toContain('role="listbox"')
    expect(html).toContain('Kokiri Forest')
  })

  it('renders grouped places and collectibles for a matching query and reflects done status', () => {
    const kokiriItem = dataset.items.find((item) => item.place === 'kokiri')!
    const html = renderToString(
      createElement(QuickSearchModal, {
        open: true,
        onClose: vi.fn(),
        onNavigate: vi.fn(),
        doneIds: [kokiriItem.id],
        initialQuery: 'Kokiri Forest',
      }),
    ).replace(/<!-- -->/g, '')

    expect(html).toContain('Kokiri Forest')
    expect(html).toContain(kokiriItem.name)
    expect(html).toContain('line-through')
  })

  it('renders empty state when no places or collectibles match', () => {
    const html = renderToString(
      createElement(QuickSearchModal, {
        open: true,
        onClose: vi.fn(),
        onNavigate: vi.fn(),
        initialQuery: 'zzzz-nonexistent-query',
      }),
    ).replace(/<!-- -->/g, '')

    expect(html).not.toContain('role="option"')
  })
})

describe('QuickSearchModal keyboard shortcut guards', () => {
  it('detects editable targets accurately', () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(
      isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget),
    ).toBe(true)
  })

  it('triggers toggle on Ctrl+K and Cmd+K regardless of focus or open state', () => {
    const inputTarget = { tagName: 'INPUT' } as unknown as EventTarget
    expect(
      shouldTriggerQuickSearch(
        { key: 'k', ctrlKey: true, metaKey: false, altKey: false, target: inputTarget },
        false,
      ),
    ).toBe('toggle')
    expect(
      shouldTriggerQuickSearch(
        { key: 'K', ctrlKey: false, metaKey: true, altKey: false, target: inputTarget },
        true,
      ),
    ).toBe('toggle')
  })

  it('triggers open on / only when closed and focus is not in an editable field', () => {
    const bodyTarget = { tagName: 'BODY' } as unknown as EventTarget
    const inputTarget = { tagName: 'INPUT' } as unknown as EventTarget

    expect(
      shouldTriggerQuickSearch(
        { key: '/', ctrlKey: false, metaKey: false, altKey: false, target: bodyTarget },
        false,
      ),
    ).toBe('open')

    expect(
      shouldTriggerQuickSearch(
        { key: '/', ctrlKey: false, metaKey: false, altKey: false, target: bodyTarget },
        true,
      ),
    ).toBeNull()

    expect(
      shouldTriggerQuickSearch(
        { key: '/', ctrlKey: false, metaKey: false, altKey: false, target: inputTarget },
        false,
      ),
    ).toBeNull()
  })
})
