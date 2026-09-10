import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { FileByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { PREFERENCES_STORAGE_KEY, usePreferencesStore } from '@/stores/preferences'
import SplitterPanel from '@/components/shell/SplitterPanel.vue'
import SplitterGroup from '@/components/shell/SplitterGroup.vue'
import HomeView from '@/views/HomeView.vue'
import { DEFAULT_SIDEBAR_WIDTH, gridMinPx, SIDEBAR_MIN_PX } from '@/views/sidebarLayout'

// The phase-1.75 Sidebar shell (plan-phase1.75.md §3, ADR-0010), at the
// app-shell seam: HomeView mounted whole, a real file-backed source. The
// splitter's actual pixel geometry needs real layout, which the test DOM has
// not — so the splitter *behaviour* is driven through the wrapper's own
// `resize` / `collapse` / `expand` events (the same technique the M1 wrapper
// specs use) and the *wiring* (props, persistence, DOM order) is asserted here.

let pinia: Pinia
let wrapper: VueWrapper | null = null

function mountApp(): VueWrapper {
  wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [pinia] } })
  return wrapper
}

function fileOf(bytes: number[], name = 'test.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

async function openDoc(): Promise<void> {
  useDocumentStore(pinia).open(new FileByteSource(fileOf([1, 2, 3, 4, 5, 6, 7, 8])), 'test.bin')
  await flushPromises()
}

// The Sidebar's splitter panel wrapper (`order: 2`), or `undefined` when hidden.
// Inferred return, matching the shell wrappers' own `__tests__/helpers.ts`.
function sidebarPanel(app: VueWrapper) {
  return app.findAllComponents(SplitterPanel).find((c) => c.props('order') === 2)
}

function storedPreferences(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}')
}

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the Sidebar shell — presence (plan §3.1)', () => {
  it('is hidden entirely — no panel, no handle — when no document is open', () => {
    const app = mountApp()
    expect(sidebarPanel(app)).toBeUndefined()
    expect(app.find('.splitter-resize-handle').exists()).toBe(false)
    expect(app.find('[data-region="sidebar"]').exists()).toBe(false)
  })

  it('appears with the handle the moment a document opens', async () => {
    const app = mountApp()
    await openDoc()
    expect(sidebarPanel(app)).toBeDefined()
    expect(app.find('.splitter-resize-handle').exists()).toBe(true)
    expect(app.find('[data-region="sidebar"]').exists()).toBe(true)
  })

  it('does not hand the splitter its own persistence (no auto-save-id — ADR-0009 §5)', async () => {
    const app = mountApp()
    await openDoc()
    const declared = Object.keys(app.findComponent(SplitterGroup).vm.$props)
    expect(declared).not.toContain('autoSaveId')
    expect(declared).not.toContain('storage')
  })

  it('keeps the APG window-splitter handle: a focusable role="separator"', async () => {
    const app = mountApp()
    await openDoc()
    const handle = app.find('.splitter-resize-handle')
    expect(handle.attributes('role')).toBe('separator')
    // Focusable, so the arrows / Home / End / Enter keyboard model is reachable;
    // all of it lands on the same @resize / @collapse / @expand handlers as a drag.
    expect(Number(handle.attributes('tabindex'))).toBe(0)
  })
})

describe('the Sidebar shell — the accordion (plan §3.1)', () => {
  it('opens the Inspector and leaves the Bitmap closed by default', async () => {
    const app = mountApp()
    await openDoc()

    const states = app.findAll('.accordion-item').map((i) => i.attributes('data-state'))
    expect(states).toEqual(['open', 'closed'])
    // Fixed order: Inspector first, Bitmap second.
    const triggers = app.findAll('button.accordion-trigger').map((t) => t.text())
    expect(triggers).toEqual(['Inspector', 'Bitmap'])
  })

  it('unmounts a closed section (`unmount-on-hide`) — the Bitmap holds nothing until opened', async () => {
    const app = mountApp()
    await openDoc()
    expect(app.find('[data-region="inspector"]').exists()).toBe(true)
    expect(app.find('[data-region="bitmap"]').exists()).toBe(false)

    await app.findAll('button.accordion-trigger')[1]!.trigger('click') // open Bitmap
    expect(app.find('[data-region="bitmap"]').exists()).toBe(true)
  })

  it('bridges each section toggle to the persisted open booleans', async () => {
    const app = mountApp()
    await openDoc()
    const preferences = usePreferencesStore(pinia)

    await app.findAll('button.accordion-trigger')[1]!.trigger('click') // open Bitmap
    expect(preferences.bitmapOpen).toBe(true)
    expect(storedPreferences().bitmapOpen).toBe(true)

    await app.findAll('button.accordion-trigger')[0]!.trigger('click') // close Inspector
    expect(preferences.inspectorOpen).toBe(false)
    expect(storedPreferences().inspectorOpen).toBe(false)
  })

  it('honours a persisted open set on the next mount', async () => {
    usePreferencesStore(pinia).setInspectorOpen(false)
    usePreferencesStore(pinia).setBitmapOpen(true)

    const app = mountApp()
    await openDoc()
    expect(app.findAll('.accordion-item').map((i) => i.attributes('data-state'))).toEqual([
      'closed',
      'open',
    ])
  })
})

describe('the Sidebar shell — the splitter (plan §3.2, §3.3)', () => {
  it('persists any committed width from a resize — including a keyboard Home to the 200 floor', async () => {
    const app = mountApp()
    await openDoc()
    const panel = sidebarPanel(app)!
    const preferences = usePreferencesStore(pinia)

    panel.vm.$emit('resize', 264, DEFAULT_SIDEBAR_WIDTH)
    expect(preferences.sidebarWidth).toBe(264)
    expect(storedPreferences().sidebarWidth).toBe(264)

    panel.vm.$emit('resize', SIDEBAR_MIN_PX, 264) // Home → min: still a committed width
    expect(preferences.sidebarWidth).toBe(SIDEBAR_MIN_PX)
    expect(storedPreferences().sidebarWidth).toBe(SIDEBAR_MIN_PX)
  })

  it('ignores the resize(0) that rides along with a collapse — the width to restore survives', async () => {
    const app = mountApp()
    await openDoc()
    const panel = sidebarPanel(app)!
    const preferences = usePreferencesStore(pinia)
    preferences.setSidebarWidth(264)

    panel.vm.$emit('resize', 0, 264)
    expect(preferences.sidebarWidth).toBe(264)
  })

  it('persists whole-Sidebar collapse and restore, without touching the width', async () => {
    const app = mountApp()
    await openDoc()
    const panel = sidebarPanel(app)!
    const preferences = usePreferencesStore(pinia)
    preferences.setSidebarWidth(280)

    panel.vm.$emit('collapse')
    expect(preferences.sidebarCollapsed).toBe(true)
    expect(preferences.sidebarWidth).toBe(280) // untouched — expanding returns here
    expect(storedPreferences().sidebarCollapsed).toBe(true)

    panel.vm.$emit('expand')
    expect(preferences.sidebarCollapsed).toBe(false)
    expect(preferences.sidebarWidth).toBe(280)
  })

  it('starts collapsed (default-size 0) when `sidebarCollapsed` was persisted', async () => {
    usePreferencesStore(pinia).setSidebarCollapsed(true)
    const app = mountApp()
    await openDoc()
    expect(sidebarPanel(app)!.props('defaultSize')).toBe(0)
  })

  it('starts at the persisted width when not collapsed', async () => {
    usePreferencesStore(pinia).setSidebarWidth(275)
    const app = mountApp()
    await openDoc()
    expect(sidebarPanel(app)!.props('defaultSize')).toBe(275)
  })

  it('does not flip `sidebarCollapsed` just by mounting and opening a document', async () => {
    mountApp()
    await openDoc()
    await flushPromises()
    expect(usePreferencesStore(pinia).sidebarCollapsed).toBe(false)
    expect(storedPreferences().sidebarCollapsed ?? false).toBe(false)
  })

  it('double-clicking the handle resets the width to the default 320', async () => {
    const app = mountApp()
    await openDoc()
    const preferences = usePreferencesStore(pinia)
    preferences.setSidebarWidth(240)

    await app.find('.splitter-resize-handle').trigger('dblclick')

    expect(preferences.sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(storedPreferences().sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})

describe('the Sidebar shell — the dynamic grid minimum (plan §3.2)', () => {
  it("sets the Sidebar panel's max-size to container width − the bytesPerRow-driven grid minimum", async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 2000,
      height: 0,
      top: 0,
      left: 0,
      right: 2000,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const app = mountApp()
    await openDoc()
    const documentStore = useDocumentStore(pinia)

    documentStore.setBytesPerRow(16)
    await flushPromises()
    expect(sidebarPanel(app)!.props('maxSize')).toBe(2000 - gridMinPx(16))

    // A wider row raises the grid minimum, so the Sidebar's ceiling drops.
    documentStore.setBytesPerRow(32)
    await flushPromises()
    expect(sidebarPanel(app)!.props('maxSize')).toBe(2000 - gridMinPx(32))
    expect(gridMinPx(32)).toBeGreaterThan(gridMinPx(16))
  })

  it('never lets the max-size fall below the 200 px Sidebar floor', async () => {
    // No layout in the test DOM → container width 0 → the floor wins.
    const app = mountApp()
    await openDoc()
    expect(sidebarPanel(app)!.props('maxSize')).toBe(SIDEBAR_MIN_PX)
  })
})

describe('the Sidebar shell — tab order (plan §3.6)', () => {
  it('is toolbar → grid → resize handle → Sidebar (triggers/contents) → status bar', async () => {
    const app = mountApp()
    await openDoc()
    // Open the Bitmap too so both trigger/content pairs are in the DOM.
    await app.findAll('button.accordion-trigger')[1]!.trigger('click')

    const order = [
      app.find('[data-region="toolbar"]').element,
      app.find('.hex-viewer__row-area').element,
      app.find('.splitter-resize-handle').element,
      app.find('[data-region="sidebar"]').element,
      app.findAll('button.accordion-trigger')[0]!.element,
      app.findAll('.accordion-content')[0]!.element,
      app.findAll('button.accordion-trigger')[1]!.element,
      app.findAll('.accordion-content')[1]!.element,
      app.find('[data-region="status-bar"]').element,
    ]

    for (let i = 0; i < order.length - 1; i++) {
      expect(
        !!(order[i]!.compareDocumentPosition(order[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true)
    }
  })
})

describe('the Sidebar shell — the phase-1.5 dock / collapsed keys (plan §3.4)', () => {
  it('ignores a stored `dock` / `collapsed` on load and drops them on the next write', async () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ dock: 'right', collapsed: true, sidebarWidth: 300, inspectorOpen: true }),
    )
    // Fresh pinia so the store re-reads the seeded value.
    setActivePinia((pinia = createPinia()))

    const app = mountApp()
    await openDoc()

    // The stray keys never became state.
    const preferences = usePreferencesStore(pinia)
    expect(preferences.sidebarWidth).toBe(300)
    expect((preferences as unknown as Record<string, unknown>).dock).toBeUndefined()
    expect((preferences as unknown as Record<string, unknown>).collapsed).toBeUndefined()

    // Any write rewrites the whole object without them (end-to-end via the shell).
    await app.findAll('button.accordion-trigger')[1]!.trigger('click')
    const stored = storedPreferences()
    expect(stored).not.toHaveProperty('dock')
    expect(stored).not.toHaveProperty('collapsed')
    expect(stored.sidebarWidth).toBe(300)
  })
})
