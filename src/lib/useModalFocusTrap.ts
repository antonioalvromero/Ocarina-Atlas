import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ')

/** Stack of currently active modal focus traps so nested dialogs only trap/close the topmost one. */
const activeTrapStack: symbol[] = []

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return nodes.filter((el) => {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false
    if (el.closest('[inert], [hidden], [aria-hidden="true"]')) return false
    return true
  })
}

/**
 * SSR-safe focus trap for dialogs, drawers, and modal popovers:
 * - Saves `document.activeElement` before opening and restores focus on close.
 * - Moves focus into `containerRef` on open (respecting existing `autoFocus` inside the container).
 * - Traps `Tab` / `Shift+Tab` inside `containerRef` when this trap is topmost.
 * - Invokes `onClose` on `Escape` when provided and this trap is topmost.
 */
export function useModalFocusTrap(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose?: () => void,
): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return

    const container = containerRef.current
    if (!container) return

    const trapId = Symbol('modal-focus-trap')
    activeTrapStack.push(trapId)

    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    if (!container.contains(document.activeElement)) {
      const focusables = getFocusableElements(container)
      if (focusables.length > 0) {
        focusables[0]?.focus()
      } else {
        if (!container.hasAttribute('tabindex')) {
          container.setAttribute('tabindex', '-1')
        }
        container.focus()
      }
    }

    function isTopmostTrap(): boolean {
      return activeTrapStack[activeTrapStack.length - 1] === trapId
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (!isTopmostTrap()) return
      const currentContainer = containerRef.current
      if (!currentContainer) return

      if (event.key === 'Escape') {
        if (onCloseRef.current) {
          event.preventDefault()
          event.stopPropagation()
          onCloseRef.current()
        }
        return
      }

      if (event.key !== 'Tab') return

      const focusables = getFocusableElements(currentContainer)
      if (focusables.length === 0) {
        event.preventDefault()
        currentContainer.focus()
        return
      }

      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement

      if (event.shiftKey) {
        if (active === first || !currentContainer.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !currentContainer.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const idx = activeTrapStack.lastIndexOf(trapId)
      if (idx !== -1) {
        activeTrapStack.splice(idx, 1)
      }
      if (
        previousActiveElement &&
        previousActiveElement.isConnected &&
        typeof previousActiveElement.focus === 'function'
      ) {
        try {
          previousActiveElement.focus()
        } catch {
          // Ignore focus errors if element became unfocusable.
        }
      }
    }
  }, [isOpen, containerRef])
}
