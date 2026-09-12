import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { FileByteSource } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { useSearchResultsStore } from '@/stores/searchResults'
import HomeView from '@/views/HomeView.vue'

// The Search results Panel (#106, CONTEXT.md, plan-phase2.md §3.6), at the
// app-shell seam: HomeView mounted whole, a real file-backed source, the
// Search results section opened — the same seam InspectorPanel.spec.ts and
// BitmapPanel.spec.ts use. `FindBox.vue`'s own Find All dispatch (against a
// fake worker) is covered in `HexViewer.spec.ts`'s Find All describe block;
// here, the Panel's own contract against `useSearchResultsStore` directly:
// rendering, staleness, the partial label, preview bytes, and row
// click/Shift-click.

let pinia: Pinia
let wrapper: VueWrapper | null = null

function mountApp(): VueWrapper {
  wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [pinia] } })
  return wrapper
}

function fileOf(bytes: number[], name = 'test.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

async function openBytes(bytes: number[], name = 'test.bin'): Promise<void> {
  useDocumentStore(pinia).open(new FileByteSource(fileOf(bytes, name)), name)
  await flushPromises()
}

/** The Search results accordion trigger — fourth section, after Inspector/Bitmap/Entropy. */
const searchResultsTrigger = (app: VueWrapper) => app.findAll('button.accordion-trigger')[3]!

async function openSearchResultsSection(app: VueWrapper): Promise<void> {
  await searchResultsTrigger(app).trigger('click')
  await flushPromises()
}

function hitRows(app: VueWrapper) {
  return app.findAll('[data-field="search-result-hit"]')
}

function offsetsShown(app: VueWrapper): string[] {
  return app.findAll('[data-field="search-result-offset"]').map((el) => el.text())
}

function previewsShown(app: VueWrapper): string[] {
  return app.findAll('[data-field="search-result-preview"]').map((el) => el.text())
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('the Search results Panel — presence and the empty state', () => {
  it('is hidden entirely when no document is open', () => {
    const app = mountApp()
    expect(app.find('[data-region="search-results"]').exists()).toBe(false)
  })

  it('names itself a region and shows an empty-state message before any Find All', async () => {
    const app = mountApp()
    await openBytes([1, 2, 3, 4])
    await openSearchResultsSection(app)

    const panel = app.find('[data-region="search-results"]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('role')).toBe('region')
    expect(panel.attributes('aria-label')).toBe('Search results')
    expect(panel.text()).toMatch(/find all/i)
    expect(hitRows(app)).toHaveLength(0)
  })
})

describe('the Search results Panel — rendering hits', () => {
  it('lists every hit with its offset and a hex preview', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 32 }, (_u, i) => i))
    await openSearchResultsSection(app)

    useSearchResultsStore(pinia).setResults({
      hits: Float64Array.of(2, 10),
      matchLength: 2,
      partial: false,
      mode: 'hex',
    })
    await flushPromises()

    expect(offsetsShown(app)).toEqual(['0x02', '0x0A'])
    // bytes 2,3 = 02 03; bytes 10,11 = 0A 0B
    expect(previewsShown(app)).toEqual(['02 03', '0A 0B'])
  })

  it('decodes the preview through the current Code page in text mode', async () => {
    const app = mountApp()
    // "hi!!" at offset 0
    await openBytes([0x68, 0x69, 0x21, 0x21])
    await openSearchResultsSection(app)

    useSearchResultsStore(pinia).setResults({
      hits: Float64Array.of(0),
      matchLength: 2,
      partial: false,
      mode: 'text',
    })
    await flushPromises()

    expect(previewsShown(app)).toEqual(['hi'])
  })

  it('shows the pending glyph until a non-resident hit is fetched, then repaints', async () => {
    // The grid itself also pages this same source in (HomeView mounts the
    // whole app, HexViewer included) — keyed by offset/length so the hit's
    // own read (offset 4, length 1) can be picked out of whatever else the
    // grid requested, rather than assuming it is the only or the first call.
    const pendingReads: Array<{
      offset: number
      length: number
      resolve: (bytes: Uint8Array) => void
    }> = []
    const source: ByteSource = {
      size: 64,
      readSync: () => null, // nothing ever resident synchronously
      read: (offset, length) =>
        new Promise<Uint8Array>((resolve) => {
          pendingReads.push({ offset, length, resolve })
        }),
      prefetch: () => {},
      close: () => {},
    }
    const app = mountApp()
    useDocumentStore(pinia).open(source, 'deferred.bin')
    await flushPromises()
    await openSearchResultsSection(app)

    useSearchResultsStore(pinia).setResults({
      hits: Float64Array.of(4),
      matchLength: 1,
      partial: false,
      mode: 'hex',
    })
    await flushPromises()

    expect(previewsShown(app)).toEqual(['··'])

    const hitRead = pendingReads.find((r) => r.offset === 4 && r.length === 1)!
    hitRead.resolve(Uint8Array.of(0xff))
    await flushPromises()

    expect(previewsShown(app)).toEqual(['FF'])
  })
})

describe('the Search results Panel — the partial label (ADR-0014)', () => {
  it('shows the labeled-partial note only when the result was capped', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 32 }, (_u, i) => i))
    await openSearchResultsSection(app)
    const store = useSearchResultsStore(pinia)

    store.setResults({ hits: Float64Array.of(0, 1), matchLength: 1, partial: false, mode: 'hex' })
    await flushPromises()
    expect(app.find('[data-field="search-results-partial"]').exists()).toBe(false)

    store.setResults({ hits: Float64Array.of(0, 1), matchLength: 1, partial: true, mode: 'hex' })
    await flushPromises()
    const note = app.find('[data-field="search-results-partial"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toMatch(/first 2 shown — narrow your search/i)
  })
})

describe('the Search results Panel — staleness while a new Find All runs (plan §3.6)', () => {
  it('keeps the previous hits visible, marked stale, while pending — and un-stales if cancelled instead', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 32 }, (_u, i) => i))
    await openSearchResultsSection(app)
    const store = useSearchResultsStore(pinia)
    store.setResults({ hits: Float64Array.of(5), matchLength: 1, partial: false, mode: 'hex' })
    await flushPromises()

    store.markPending()
    await flushPromises()
    expect(hitRows(app)).toHaveLength(1) // still showing the previous hit
    expect(app.find('[data-field="search-results-stale"]').exists()).toBe(true)

    store.clearPending() // the in-flight job was cancelled, nothing new landed
    await flushPromises()
    expect(app.find('[data-field="search-results-stale"]').exists()).toBe(false)
    expect(hitRows(app)).toHaveLength(1)
  })
})

describe('the Search results Panel — row click / Shift-click (plan §3.6)', () => {
  it('click sets the Cursor at the hit, collapsing the Selection, and requests a reveal', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 32 }, (_u, i) => i))
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    store.extendSelectionTo(20) // a non-collapsed Selection, to prove the click collapses it
    await openSearchResultsSection(app)

    useSearchResultsStore(pinia).setResults({
      hits: Float64Array.of(10),
      matchLength: 3,
      partial: false,
      mode: 'hex',
    })
    await flushPromises()

    await hitRows(app)[0]!.trigger('click')

    expect(store.selection).toEqual({ anchor: 10, focus: 10 })
    expect(store.revealRequest).toEqual({ offset: 10 })
  })

  it('Shift-click selects the full matched range regardless of the prior Selection anchor', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 32 }, (_u, i) => i))
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    store.extendSelectionTo(2) // an unrelated prior Selection/anchor elsewhere
    await openSearchResultsSection(app)

    useSearchResultsStore(pinia).setResults({
      hits: Float64Array.of(10),
      matchLength: 3, // range [10, 13)
      partial: false,
      mode: 'hex',
    })
    await flushPromises()

    await hitRows(app)[0]!.trigger('click', { shiftKey: true })

    expect(store.selection).toEqual({ anchor: 10, focus: 12 })
    expect(store.revealRequest).toEqual({ offset: 10 })
  })
})
