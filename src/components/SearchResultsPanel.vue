<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { charFor, toHex, toHexString } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'
import { useSearchResultsStore } from '@/stores/searchResults'

// The Search results Panel (#106, CONTEXT.md, plan-phase2.md §3.6): a
// persistent Sidebar panel Find All (`FindBox.vue`) populates once it
// completes — or hits ADR-0014's 500-result cap — reading
// `useSearchResultsStore` directly rather than a prop, since it must stay
// showing the previous completed search's hits, marked stale, after the
// Find box itself closes and while a new Find All runs
// (`searchResultsStore.pending`).
//
// Every hit's preview is read fresh from the open document here, never from
// the pattern bytes Find All searched for: a case-insensitive text-mode
// match can differ from the typed term by letter case, and the preview
// should show what is actually in the file, exactly like the char column
// does. `mode` (hex/text) is the one piece the store captures at Find All
// completion time — the Code page, by contrast, is read live here, exactly
// like the char column.

const documentStore = useDocumentStore()
const preferencesStore = usePreferencesStore()
const searchResultsStore = useSearchResultsStore()

const hasSource = computed(() => documentStore.source !== null)

interface Hit {
  readonly offset: number
  /** Last byte of the match, inclusive — `extendSelectionTo`'s target on Shift-click. */
  readonly lastByte: number
}

const hits = computed<Hit[]>(() => {
  const results = searchResultsStore.results
  if (results === null) {
    return []
  }
  return Array.from(results.hits, (offset) => ({
    offset,
    lastByte: offset + results.matchLength - 1,
  }))
})

/** The previous completed search's hits stay visible while a new Find All runs (plan §3.6). */
const stale = computed(() => searchResultsStore.pending && searchResultsStore.results !== null)

const PENDING_PREVIEW = '··' // the Inspector's own pending glyph (InspectorPanel.vue)

/**
 * Resident-first, async-fallback preview bytes per hit offset — the same
 * residency-first shape the Inspector reads the Cursor's bytes with, just
 * run once per hit rather than for a single reactive point. Rebuilt
 * wholesale whenever the result set itself changes (a new completed Find
 * All, or a reset); a read that resolves after its result set or document
 * has since moved on is dropped by the guard inside `.then`.
 */
const previewBytes = shallowRef<Map<number, Uint8Array>>(new Map())

watch(
  () => searchResultsStore.results,
  (results) => {
    previewBytes.value = new Map()
    if (results === null) {
      return
    }
    const src = documentStore.source
    if (src === null) {
      return
    }
    for (const offset of results.hits) {
      const resident = src.readSync(offset, results.matchLength)
      if (resident !== null) {
        previewBytes.value.set(offset, resident)
        continue
      }
      src
        .read(offset, results.matchLength)
        .then((bytes) => {
          if (searchResultsStore.results !== results || documentStore.source !== src) {
            return // a different result set or document is current now
          }
          const next = new Map(previewBytes.value)
          next.set(offset, bytes)
          previewBytes.value = next
        })
        .catch(() => {
          // Left pending — a read failure here is not this panel's concern to
          // surface; HexViewer already escalates the dead-source banner.
        })
    }
  },
  { immediate: true },
)

function previewFor(offset: number): string {
  const bytes = previewBytes.value.get(offset)
  if (bytes === undefined) {
    return PENDING_PREVIEW
  }
  if (searchResultsStore.results?.mode === 'hex') {
    return toHexString(bytes)
  }
  let glyphs = ''
  for (const byte of bytes) {
    glyphs += charFor(byte, preferencesStore.codePage)
  }
  return glyphs
}

/**
 * Click → `setCursor` at the hit (collapsing the Selection); Shift-click →
 * the full matched range. Both start from `setCursor` — Shift-click does
 * not extend whatever the existing Selection anchor happens to be, the way
 * the Bitmap's own Shift-click does (plan §3.6 reuses that convention's
 * *primitives*, ADR-0008/ADR-0011, not its single-point-extend behaviour) —
 * so the result is always exactly the matched range, independent of
 * whatever the Selection was before the click. Both followed by
 * `requestReveal` to scroll the hex grid to that row.
 */
function onRowClick(hit: Hit, event: MouseEvent): void {
  documentStore.setCursor(hit.offset)
  if (event.shiftKey) {
    documentStore.extendSelectionTo(hit.lastByte)
  }
  documentStore.requestReveal(hit.offset)
}
</script>

<template>
  <section
    v-if="hasSource"
    class="search-results"
    role="region"
    aria-label="Search results"
    data-region="search-results"
  >
    <p v-if="searchResultsStore.results === null" class="search-results__empty">
      Find All (in the Find box) populates this panel with every hit.
    </p>
    <template v-else>
      <p v-if="stale" class="search-results__note" data-field="search-results-stale">
        Showing previous results — a new search is running…
      </p>
      <p
        v-else-if="searchResultsStore.results.partial"
        class="search-results__note"
        data-field="search-results-partial"
      >
        First {{ hits.length }} shown — narrow your search.
      </p>
      <ul class="search-results__list" :class="{ 'search-results__list--stale': stale }">
        <li v-for="hit in hits" :key="hit.offset" class="search-results__row">
          <button
            type="button"
            class="search-results__hit"
            data-field="search-result-hit"
            @click="onRowClick(hit, $event)"
          >
            <span class="search-results__offset" data-field="search-result-offset"
              >0x{{ toHex(hit.offset) }}</span
            >
            <span class="search-results__preview" data-field="search-result-preview">{{
              previewFor(hit.offset)
            }}</span>
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
/* The Search results accordion section's content (plan §3.6): natural
   height, no scrollbar of its own — the whole Sidebar scrolls, same as every
   other Panel. */
.search-results {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
  font-family: var(--font-mono);
  color: var(--color-fg);
}

.search-results__empty,
.search-results__note {
  margin: 0;
  color: var(--color-fg-dim);
  font-size: 0.9em;
}

.search-results__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.search-results__list--stale {
  opacity: 0.55;
}

.search-results__row + .search-results__row {
  border-top: 1px solid var(--color-border);
}

.search-results__hit {
  display: flex;
  align-items: baseline;
  gap: 1ch;
  width: 100%;
  padding: 0.2rem 0.1rem;
  background: none;
  border: none;
  color: var(--color-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.search-results__hit:hover {
  background: var(--color-hover);
}

.search-results__offset {
  flex: none;
  color: var(--color-fg-dim);
}

.search-results__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
