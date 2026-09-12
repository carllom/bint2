import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

/**
 * The Search results Sidebar panel's state (#106, CONTEXT.md's Search
 * results; plan-phase2.md §3.6). A store of its own — neither the open
 * document's own state (`document.ts`) nor a persisted view-wide preference
 * (`preferences.ts`) — because it is shared between `FindBox.vue` (the only
 * writer, via Find All) and `SearchResultsPanel.vue` (the only reader),
 * which are unrelated siblings in the Sidebar.
 *
 * `mode` is captured here at the moment Find All completes — it describes
 * *what was searched*, not a live view-wide setting, so flipping the Find
 * box's own mode afterward does not repaint an already-completed result
 * set. The current Code page, by contrast, is read live by the panel
 * (view-wide, exactly like the char column) rather than captured here.
 */
export interface SearchResultsSnapshot {
  /** Ascending match offsets — the same shape `SearchResult.matches` carries. */
  readonly hits: Float64Array
  /** Bytes per match — every hit spans `[offset, offset + matchLength)`. */
  readonly matchLength: number
  /** True when Find All's cap (ADR-0014) stopped the scan early. */
  readonly partial: boolean
  /** The Find box's input mode when this result completed. */
  readonly mode: 'hex' | 'text'
}

export const useSearchResultsStore = defineStore('searchResults', () => {
  const results = shallowRef<SearchResultsSnapshot | null>(null)
  // True while a Find All job that will replace `results` is in flight. The
  // Search results panel's "stale" marking is `pending && results !== null`
  // (plan §3.6): the previous completed search's results stay visible,
  // marked stale, until the new job finishes — or, if that job is cancelled
  // instead (`clearPending` without a following `setResults`), simply
  // reverts to not-stale, since nothing new is then still coming.
  const pending = shallowRef(false)

  function markPending(): void {
    pending.value = true
  }

  function clearPending(): void {
    pending.value = false
  }

  function setResults(next: SearchResultsSnapshot): void {
    results.value = next
    pending.value = false
  }

  /** A new/closed document invalidates every previous hit offset (#106). */
  function reset(): void {
    results.value = null
    pending.value = false
  }

  return { results, pending, markPending, clearPending, setResults, reset }
})
