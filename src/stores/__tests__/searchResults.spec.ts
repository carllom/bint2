import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSearchResultsStore } from '../searchResults'

// The Search results panel's own state (#106, CONTEXT.md's Search results;
// plan-phase2.md §3.6) — separate from `document` (not the open document's
// own state) and `preferences` (not a persisted view-wide setting). The
// component wiring (row click/Shift-click, preview rendering, the accordion
// section) is covered at the app-shell seam in
// `components/__tests__/SearchResultsPanel.spec.ts`; here, the store's own
// contract: what a Find All completion, an in-flight one, and a document
// change each do to it.

describe('the Search results store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with no results and not pending', () => {
    const store = useSearchResultsStore()
    expect(store.results).toBeNull()
    expect(store.pending).toBe(false)
  })

  it('markPending flags a Find All dispatch in flight, without touching any existing results', () => {
    const store = useSearchResultsStore()
    store.setResults({ hits: Float64Array.of(1, 2), matchLength: 1, partial: false, mode: 'hex' })

    store.markPending()

    expect(store.pending).toBe(true)
    expect(store.results).toEqual({
      hits: Float64Array.of(1, 2),
      matchLength: 1,
      partial: false,
      mode: 'hex',
    })
  })

  it('setResults replaces the results and clears pending', () => {
    const store = useSearchResultsStore()
    store.markPending()

    store.setResults({ hits: Float64Array.of(5), matchLength: 2, partial: true, mode: 'text' })

    expect(store.pending).toBe(false)
    expect(store.results).toEqual({
      hits: Float64Array.of(5),
      matchLength: 2,
      partial: true,
      mode: 'text',
    })
  })

  it('clearPending drops the in-flight flag without discarding the previous results (a cancelled Find All)', () => {
    const store = useSearchResultsStore()
    store.setResults({ hits: Float64Array.of(1), matchLength: 1, partial: false, mode: 'hex' })
    store.markPending()

    store.clearPending()

    expect(store.pending).toBe(false)
    expect(store.results).not.toBeNull()
  })

  it('reset drops both results and pending — a new/closed document invalidates every hit offset', () => {
    const store = useSearchResultsStore()
    store.setResults({ hits: Float64Array.of(1), matchLength: 1, partial: false, mode: 'hex' })
    store.markPending()

    store.reset()

    expect(store.results).toBeNull()
    expect(store.pending).toBe(false)
  })
})
