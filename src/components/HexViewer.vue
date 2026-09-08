<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import {
  addressWidthFor,
  ByteSourceError,
  describeSelection,
  isCollapsed,
  offsetFromThumbPixel,
  offsetOfRow,
  rangeOf,
  rowCount,
  rowOfOffset,
  toByteSizeDetail,
  visibleRows,
} from '@/core'
import type { Selection, ViewportMetrics } from '@/core'
import { DomHexRenderer } from '@/rendering'
import type { HexRowView, SelectionView } from '@/rendering'
import GotoBox from '@/components/GotoBox.vue'
import VirtualScrollbar from '@/components/VirtualScrollbar.vue'
import { useByteAt } from '@/composables/useByteAt'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'

// The Viewport (CONTEXT.md): the bounded window of the document on screen. It
// never depends on a browser layout height — `topByteOffset` in the store is the
// only coordinate (ADR-0006), row height is measured from a probe glyph and fed
// to the pure viewport surface as an input, and the custom scrollbar is the only
// scrollbar at every file size.

const MIN_THUMB_PX = 24 // ADR-0006 default, pinned by the viewport spec
/**
 * Past this many consecutive `read-failed` rejections, the dead-source banner
 * escalates from silent self-healing to the same surface `source-gone` gets,
 * with different wording (#26, ADR-0004). A tuning constant, not a decision;
 * one successful read resets the count.
 */
const READ_FAILURE_ESCALATION_THRESHOLD = 3
// Pre-measurement fallbacks, from --font-size (13px) * --line-height (1.4). Used
// only until the probe renders; overwritten by the first real measurement.
const DEFAULT_ROW_PX = 18
const DEFAULT_VIEWPORT_PX = DEFAULT_ROW_PX * 40
/** Settle time for the cursor live region (ADR-0005): a held arrow key speaks
 *  the destination once it stops, never the journey through every byte. */
const CURSOR_ANNOUNCE_DEBOUNCE_MS = 200

const documentStore = useDocumentStore()
const preferences = usePreferencesStore()
const gridEl = useTemplateRef<HTMLElement>('grid')
const rowAreaEl = useTemplateRef<HTMLElement>('rowArea')
const probeEl = useTemplateRef<HTMLElement>('probe')
const hasSource = shallowRef(false)

// The byte offset the pointer is over (#30), or `null` when it is over none.
// Pure view ephemera — never a domain concept, so it stays local to the grid
// and out of the store — but it is painted down the very same offset path as
// the Selection: `paint()` hands it to the renderer as a byte index and both
// panes mark it, distinct from the Cursor and the Selection.
const hoveredByte = shallowRef<number | null>(null)

const rowPx = shallowRef(DEFAULT_ROW_PX)
const viewportPx = shallowRef(DEFAULT_VIEWPORT_PX)

const metrics = computed<ViewportMetrics>(() => ({
  size: documentStore.fileSize,
  bytesPerRow: documentStore.bytesPerRow,
  viewportPx: viewportPx.value,
  rowPx: rowPx.value,
  // The track spans the row area — one measurement feeds both.
  trackPx: viewportPx.value,
  minThumbPx: MIN_THUMB_PX,
}))

/**
 * Names the open file for the Viewport's `role="application"` (ADR-0005) — the
 * name and size read out the moment focus lands there, whether on open or from
 * a screen reader revisiting the app. No file open names the tool instead.
 */
const viewportLabel = computed(() => {
  const name = documentStore.fileName
  if (name === null) {
    return 'Hex viewer'
  }
  return `${name}, ${toByteSizeDetail(documentStore.fileSize)}, hex viewer`
})

let renderer: DomHexRenderer | null = null
let rows: HexRowView[] = []
let addressWidth = 8
// Bumped on every document change; a read resolving against a stale generation
// is dropped rather than painted (plan §4).
let generation = 0
let paintQueued = false
// Rows whose async `read` is outstanding — deduplicates requests within a burst
// of settling scrolls. Bytes the reader returns to are served synchronously by
// the page cache's `readSync` below the ByteSource seam (#20), not held here.
const inFlight = new Set<number>()
// Consecutive `read-failed` rejections since the last success — the
// escalation counter (#26, ADR-0004). Reset on a new source and on success.
let consecutiveReadFailures = 0

function paint(): void {
  renderer?.render({
    rows,
    bytesPerRow: documentStore.bytesPerRow,
    addressWidth,
    codePage: preferences.codePage,
    selection: selectionView(),
    hoveredByte: hoveredByte.value,
  })
}

/**
 * Resolve the store's one Selection (CONTEXT.md, ADR-0003) to what the grid
 * paints: a half-open byte range and the focus byte. Both panes highlight from
 * this range — the linked hex↔ASCII highlight is a consequence, not a feature.
 */
function selectionView(): SelectionView | null {
  const sel = documentStore.selection
  if (sel === null) {
    return null
  }
  // A collapsed Selection is the Cursor: an empty fill range `[focus, focus)`,
  // with the marker still on `focus`.
  if (isCollapsed(sel)) {
    return { start: sel.focus, end: sel.focus, cursor: sel.focus }
  }
  const { start, end } = rangeOf(sel)
  return { start, end, cursor: sel.focus }
}

/** Coalesce a burst of settling reads into one repaint per tick. */
function schedulePaint(): void {
  if (paintQueued) {
    return
  }
  paintQueued = true
  queueMicrotask(() => {
    paintQueued = false
    paint()
  })
}

// The cursor live region (#27, ADR-0005): a visually-hidden, polite sentence
// keyed off the Selection alone, never the view — wheel and thumb-drag
// scrolling touch none of this. Debounced so a held arrow key speaks only the
// destination it settles on, not the journey through every byte along the way.
//
// `settledSelection` is the debounce's output: it holds the Selection only
// once ~200 ms have passed with no further move. The byte it names is read
// through `settledFocus` -> `useByteAt` (shared with the status bar's byte
// fields, #23) so the point read itself only fires once per settle, same as
// before, while `cursorAnnouncement` stays a plain computed over both — a
// byte that resolves after the settle still lands in the right sentence
// instead of being stuck unspoken, since the computed re-runs when it arrives.
const settledSelection = shallowRef<Selection | null>(null)
let announceTimer: ReturnType<typeof setTimeout> | null = null

const settledFocus = computed(() => {
  const sel = settledSelection.value
  return sel !== null && isCollapsed(sel) ? sel.focus : null
})
const settledByte = useByteAt(
  computed(() => documentStore.source),
  settledFocus,
)

const cursorAnnouncement = computed(() => {
  const sel = settledSelection.value
  return sel === null ? '' : (describeSelection(sel, settledByte.value) ?? '')
})

/** Debounce a Selection change to the ~200 ms settle the ADR calls for. */
function scheduleAnnounce(sel: Selection | null): void {
  if (announceTimer !== null) {
    clearTimeout(announceTimer)
    announceTimer = null
  }
  if (sel === null) {
    settledSelection.value = null // nothing to announce
    return
  }
  announceTimer = setTimeout(() => {
    announceTimer = null
    settledSelection.value = sel
  }, CURSOR_ANNOUNCE_DEBOUNCE_MS)
}

function measure(): void {
  const probeHeight = probeEl.value?.getBoundingClientRect().height ?? 0
  if (probeHeight > 0) {
    rowPx.value = probeHeight
  }
  const areaHeight = rowAreaEl.value?.getBoundingClientRect().height ?? 0
  if (areaHeight > 0) {
    viewportPx.value = areaHeight
  }
}

function applyBytes(offset: number, bytes: Uint8Array, gen: number): void {
  if (gen !== generation) {
    return // a newer document opened; this read is stale
  }
  const index = rows.findIndex((row) => row.offset === offset)
  if (index !== -1) {
    rows[index] = { offset, bytes }
  }
  schedulePaint()
}

/** Fetch bytes for every visible row that has none yet. */
function requestRows(gen: number): void {
  const source = documentStore.source
  if (!source) {
    return
  }
  const bytesPerRow = documentStore.bytesPerRow
  for (const row of rows) {
    if (row.bytes !== null || inFlight.has(row.offset)) {
      continue
    }
    const offset = row.offset
    const length = Math.min(bytesPerRow, source.size - offset)

    const hit = source.readSync(offset, length)
    if (hit) {
      applyBytes(offset, hit, gen)
      continue
    }

    inFlight.add(offset)
    source
      .read(offset, length)
      .then((bytes) => {
        if (gen === generation) {
          consecutiveReadFailures = 0
          documentStore.setSourceHealth('ok') // one success resets the escalation
        }
        applyBytes(offset, bytes, gen)
      })
      .catch((error: unknown) => {
        if (gen !== generation) {
          return // stale generation — the reader opened another document
        }
        if (!(error instanceof ByteSourceError)) {
          return
        }
        if (error.code === 'source-gone') {
          documentStore.setSourceHealth('gone') // the one visible, persistent case
        } else if (error.code === 'read-failed') {
          consecutiveReadFailures += 1
          if (consecutiveReadFailures >= READ_FAILURE_ESCALATION_THRESHOLD) {
            documentStore.setSourceHealth('failing')
          }
        }
        // source-closed, or anything else: leave the row as ·· (ADR-0004) —
        // no chrome, and never user-visible.
      })
      .finally(() => {
        // Only clear our own entry — a stale read from a previous document must
        // not delete an offset a newer document's read now owns.
        if (gen === generation) {
          inFlight.delete(offset)
        }
      })
  }
}

let syncQueued = false

/**
 * Opening a document mutates `source`, `fileSize` and `topByteOffset` in one
 * tick, and a resize can change several metrics at once. Coalesce the resulting
 * {@link syncRows} calls into one per tick; the first paint on open goes through
 * `syncRows` directly.
 */
function scheduleSync(): void {
  if (syncQueued) {
    return
  }
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    syncRows()
  })
}

/** Rebuild the visible row set from `topByteOffset` and repaint. */
function syncRows(): void {
  const source = documentStore.source
  if (!source) {
    rows = []
    paint()
    return
  }

  const m = metrics.value
  const bytesPerRow = m.bytesPerRow
  const firstRow = rowOfOffset(documentStore.topByteOffset, bytesPerRow)
  // One row past what fits, so a viewport that is not an exact multiple of the
  // row height still has its last sliver filled (it is clipped by overflow).
  const count = Math.max(0, Math.min(rowCount(m) - firstRow, visibleRows(m) + 1))

  rows = Array.from({ length: count }, (_unused, index) => {
    const offset = offsetOfRow(firstRow + index, bytesPerRow)
    const length = Math.min(bytesPerRow, source.size - offset)
    // `readSync` is the page cache's fast path (#20): a scroll back over bytes
    // already visited paints from resident Pages in this same frame, no `··`.
    return { offset, bytes: source.readSync(offset, length) }
  })
  paint() // resident rows and placeholders now; arrivals repaint

  // One prefetch per scroll settle with the visible span; the cache expands it
  // to covering Pages ±1, clamped to size (ADR-0002).
  if (count > 0) {
    const last = rows[count - 1]!
    const spanEnd = last.offset + Math.min(bytesPerRow, source.size - last.offset)
    source.prefetch(rows[0]!.offset, spanEnd - rows[0]!.offset)
  }

  requestRows(generation)
}

function onSourceChange(): void {
  generation += 1
  inFlight.clear()
  consecutiveReadFailures = 0
  hoveredByte.value = null // last document's hovered byte does not carry over
  const source = documentStore.source
  hasSource.value = source !== null
  addressWidth = source ? addressWidthFor(source.size) : 8
  measure()
  syncRows()

  // A successful open moves focus to the Viewport (ADR-0005): `role="application"`
  // plus `aria-label` (`viewportLabel`) announces the file's name and size the
  // moment it lands there. Deferred a tick so the label has already re-rendered
  // with the new file before a screen reader reads it off the focused element.
  if (source !== null) {
    void nextTick(() => rowAreaEl.value?.focus())
  }
}

/**
 * A bytes-per-row change reshapes the grid (#19). Old-width rows sit at offsets
 * the new row boundaries no longer hit, so bump the generation and drop the
 * in-flight set — rows repaint at the new column count, served from the page
 * cache by byte range (the cache is width-agnostic). The metrics watcher
 * realigns `topByteOffset` through `clampTopOffset` and schedules the repaint.
 */
function onBytesPerRowChange(): void {
  generation += 1
  inFlight.clear()
  // consecutiveReadFailures is deliberately NOT reset: it tracks the source's
  // demonstrated reliability, which a cosmetic reshape does not change (#26).
}

let wheelAccum = 0

function wheelRows(event: WheelEvent): number {
  switch (event.deltaMode) {
    case 1: // DOM_DELTA_LINE
      return event.deltaY
    case 2: // DOM_DELTA_PAGE — a screen, minus a row of overlap
      return event.deltaY * Math.max(1, visibleRows(metrics.value) - 1)
    default: // DOM_DELTA_PIXEL
      return event.deltaY / Math.max(rowPx.value, 1)
  }
}

function onWheel(event: WheelEvent): void {
  if (!hasSource.value) {
    return
  }
  wheelAccum += wheelRows(event)
  const deltaRows = Math.trunc(wheelAccum)
  if (deltaRows === 0) {
    return
  }
  wheelAccum -= deltaRows
  documentStore.scrollTo(
    documentStore.topByteOffset + deltaRows * documentStore.bytesPerRow,
    metrics.value,
  )
}

function onScrollToPixel(thumbTopPx: number): void {
  // `offsetFromThumbPixel` already aligns and clamps; funnelling through
  // `scrollTo` keeps `clampTopOffset` the one and only choke point (ADR-0006).
  documentStore.scrollTo(offsetFromThumbPixel(thumbTopPx, metrics.value), metrics.value)
}

// The pointer drives the Selection only, never the view (ADR-0003). A plain
// press puts the Cursor; Shift+press extends the current Selection to the
// pressed byte. Either way the press starts a drag that keeps extending.
// `byteAtPoint` returns a byte index, so half a byte can never be selected.
let selecting = false

function byteUnder(event: PointerEvent): number | null {
  return renderer?.byteAtPoint(event.clientX, event.clientY) ?? null
}

function onPointerDown(event: PointerEvent): void {
  if (!hasSource.value || event.button !== 0) {
    return
  }
  rowAreaEl.value?.focus()
  const byte = byteUnder(event)
  if (byte === null) {
    return // pressed the gutter or a gap — nothing to point at
  }
  event.preventDefault()
  if (event.shiftKey) {
    documentStore.extendSelectionTo(byte)
  } else {
    documentStore.setCursor(byte) // a plain click replaces the Selection
  }
  hoveredByte.value = null // the drag's own fill takes over from the hover mark
  selecting = true // and a drag from here keeps moving the same grabbed end
  try {
    rowAreaEl.value?.setPointerCapture(event.pointerId)
  } catch {
    // No pointer-capture support here — the drag still works via bubbling.
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!selecting) {
    // Not dragging: track the byte under the pointer for the hover mark (#30).
    // `byteUnder` returns a byte index or `null` over a gap or the gutter, so
    // the mark clears itself the moment the pointer leaves a byte.
    hoveredByte.value = byteUnder(event)
    return
  }
  const byte = byteUnder(event)
  if (byte !== null) {
    documentStore.extendSelectionTo(byte)
  }
}

/** Pointer left the grid entirely — no byte is hovered any more (#30). */
function onPointerLeave(): void {
  hoveredByte.value = null
}

function onPointerUp(event: PointerEvent): void {
  if (!selecting) {
    return
  }
  selecting = false
  try {
    rowAreaEl.value?.releasePointerCapture(event.pointerId)
  } catch {
    // as above
  }
}

// The keyboard drives the Cursor; the view then follows minimally (ADR-0003).
// Wheel and thumb drag stay view-only and may leave the Cursor off-screen.
const CURSOR_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])

/** The byte a cursor key walks to, given the current focus `from`. */
function cursorTarget(event: KeyboardEvent, from: number): number {
  const bpr = documentStore.bytesPerRow
  const rowStart = from - (from % bpr)
  const toDocument = event.ctrlKey || event.metaKey
  switch (event.key) {
    case 'ArrowLeft':
      return from - 1
    case 'ArrowRight':
      return from + 1
    case 'ArrowUp':
      return from - bpr
    case 'ArrowDown':
      return from + bpr
    case 'PageUp':
      return from - visibleRows(metrics.value) * bpr
    case 'PageDown':
      return from + visibleRows(metrics.value) * bpr
    case 'Home':
      return toDocument ? 0 : rowStart
    case 'End':
      return toDocument ? documentStore.fileSize - 1 : rowStart + bpr - 1
    default:
      return from
  }
}

/**
 * The copy chords: `Ctrl+C` / `Cmd+C` copies the Selection as hex (#25),
 * `Ctrl+Alt+C` / `Cmd+Alt+C` copies it as raw text (#30). `Shift` on either is
 * not a copy chord. Returns which copy to run, or `null`.
 *
 * `Alt` rather than `Shift` for the text chord because `Ctrl+Shift+C` is the
 * browsers' own devtools binding, which a page cannot override. Holding `Alt` /
 * `Option` rewrites `event.key` to another glyph on some layouts (macOS
 * `Option+C` → `ç`), so the text chord also accepts the physical `event.code`.
 */
function copyChordKind(event: KeyboardEvent): 'hex' | 'text' | null {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey) {
    return null
  }
  if (event.altKey) {
    return event.key.toLowerCase() === 'c' || event.code === 'KeyC' ? 'text' : null
  }
  return event.key.toLowerCase() === 'c' ? 'hex' : null
}

function onKeyDown(event: KeyboardEvent): void {
  if (!hasSource.value || documentStore.fileSize === 0) {
    return
  }

  // Copy the Selection — as hex, or as raw text on the Alt chord (#25, #30).
  // Native copy is useless here — `user-select: none` over the grid means the
  // browser has nothing to take — so intercept it and serve the byte range
  // instead. With no Selection there is nothing to copy; leave the event alone.
  const copyKind = copyChordKind(event)
  if (copyKind !== null) {
    if (documentStore.selection !== null) {
      event.preventDefault()
      void (copyKind === 'hex'
        ? documentStore.copySelectionAsHex()
        : documentStore.copySelectionAsText())
    }
    return
  }

  // Plain `b` flips the view-wide byte order (#55, plan §4.2) — no modifier, and
  // only while the grid has focus, so it never fires from the Goto box. No
  // conflict with the taken chords (arrows / PageUp·Down / Home·End / Ctrl+G /
  // Ctrl+C / Ctrl+Alt+C / Ctrl+Shift+*).
  if (
    event.key === 'b' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  ) {
    event.preventDefault()
    const next = preferences.byteOrder === 'le' ? 'be' : 'le'
    preferences.setByteOrder(next)
    documentStore.announceByteOrder(next)
    return
  }

  if (!CURSOR_KEYS.has(event.key)) {
    return
  }
  event.preventDefault()

  // With no Selection yet, the first cursor key only reveals the Cursor on the
  // first visible byte — it does not walk. Plain and Shift behave the same way,
  // so a following Shift+arrow extends from a real anchor.
  if (documentStore.selection === null) {
    documentStore.setCursor(documentStore.topByteOffset)
    return
  }

  const m = metrics.value
  const from = documentStore.selection.focus
  const target = cursorTarget(event, from)
  if (event.shiftKey) {
    documentStore.extendSelectionTo(target) // Shift+arrows extend the grabbed end
  } else {
    documentStore.setCursor(target)
  }

  // PageUp/PageDown are a page jump, not a nudge — carry the view with the
  // Cursor so it keeps its place on screen. Every other key lets the view
  // follow minimally, or not at all if the Cursor stays visible.
  if (event.key === 'PageDown' || event.key === 'PageUp') {
    const pageRows = event.key === 'PageDown' ? visibleRows(m) : -visibleRows(m)
    documentStore.scrollTo(documentStore.topByteOffset + pageRows * m.bytesPerRow, m)
  }
  revealOffset(documentStore.selection.focus)
}

/**
 * Goto closed (confirm or `Esc`): focus returns to the Viewport so keyboard
 * navigation carries straight on (#24, ADR-0005). The jump itself, when there
 * was one, already went through the store.
 */
function onGotoClose(): void {
  rowAreaEl.value?.focus()
}

/** Scroll the least amount that brings `offset`'s row fully into view (ADR-0003). */
function revealOffset(offset: number): void {
  const m = metrics.value
  const bpr = m.bytesPerRow
  const targetRow = rowOfOffset(offset, bpr)
  const firstRow = rowOfOffset(documentStore.topByteOffset, bpr)
  const fit = visibleRows(m)
  let newFirst = firstRow
  if (targetRow < firstRow) {
    newFirst = targetRow
  } else if (targetRow >= firstRow + fit) {
    newFirst = targetRow - fit + 1
  }
  if (newFirst !== firstRow) {
    documentStore.scrollTo(offsetOfRow(newFirst, bpr), m)
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  renderer = new DomHexRenderer(gridEl.value!)

  resizeObserver = new ResizeObserver(() => {
    measure()
  })
  if (probeEl.value) {
    resizeObserver.observe(probeEl.value)
  }
  if (rowAreaEl.value) {
    resizeObserver.observe(rowAreaEl.value)
  }
  window.addEventListener('resize', measure)

  watch(() => documentStore.source, onSourceChange, { immediate: true })
  watch(() => documentStore.bytesPerRow, onBytesPerRowChange)
  watch(
    () => documentStore.topByteOffset,
    () => {
      // The rows under the (still) pointer have changed, so the byte it was over
      // no longer holds — drop the mark rather than leave it glued to an offset
      // the pointer has scrolled off (#30). A real pointer move re-establishes it.
      hoveredByte.value = null
      scheduleSync() // repaint on scroll
    },
  )
  watch(
    () => documentStore.selection,
    (sel) => {
      schedulePaint() // repaint on Cursor / Selection move
      scheduleAnnounce(sel) // speak it, debounced (#27)
    },
  )
  watch(hoveredByte, schedulePaint) // repaint as the hover mark moves (#30)
  watch(() => preferences.codePage, schedulePaint) // repaint the char column on a code-page change (#56)
  watch(metrics, (m) => {
    // A grown viewport or a shorter row (zoom-out) lowers maxFirstRow — pull a
    // near-EOF top back through the choke point before repainting.
    documentStore.scrollTo(documentStore.topByteOffset, m)
    scheduleSync() // repaint on resize / zoom / bytes-per-row
  })
})

onBeforeUnmount(() => {
  generation += 1 // abandon in-flight reads
  renderer = null // and any queued repaint
  resizeObserver?.disconnect()
  window.removeEventListener('resize', measure)
  if (announceTimer !== null) {
    clearTimeout(announceTimer)
  }
})
</script>

<template>
  <div class="hex-viewer">
    <p v-if="!hasSource" class="hex-viewer__empty">
      No file open. Use “Open file…” or drop a file onto the window.
    </p>
    <div
      ref="rowArea"
      class="hex-viewer__row-area"
      tabindex="0"
      role="application"
      :aria-label="viewportLabel"
      aria-describedby="hex-viewer-usage"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerLeave"
      @keydown="onKeyDown"
    >
      <span ref="probe" class="hex-viewer__probe" aria-hidden="true">00</span>
      <div ref="grid" class="hex-viewer__grid" />
      <!-- Reading the grid as a document is a non-goal (ADR-0005): rows are
           aria-hidden (DomHexRenderer) and never focusable. These two elements
           are the entire accessibility surface for the byte grid itself. -->
      <p id="hex-viewer-usage" class="visually-hidden">
        Arrow keys move the byte cursor. Ctrl+G jumps to an offset. Press B to switch byte
        order. Tab leaves this view.
      </p>
      <div
        class="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-field="cursor-live-region"
      >
        {{ cursorAnnouncement }}
      </div>
    </div>
    <VirtualScrollbar
      v-if="hasSource"
      :metrics="metrics"
      :top-byte-offset="documentStore.topByteOffset"
      @scroll-to-pixel="onScrollToPixel"
    />
    <GotoBox v-if="hasSource" :metrics="metrics" @close="onGotoClose" />
  </div>
</template>

<style scoped>
.hex-viewer {
  position: relative; /* the Goto box positions against this */
  display: flex;
  height: 100%;
  /* No native scrollbar anywhere — the custom row-space bar is the only one. */
  overflow: hidden;
  /* ADR-0003: native text selection is unusable over the grid. */
  user-select: none;
}

.hex-viewer__row-area {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  /* Heavy zoom widens a row past the viewport (ADR-0005): scroll it sideways.
     The vertical axis is the custom scrollbar's, never the browser's. */
  overflow-x: auto;
  overflow-y: hidden;
}

/* `.visually-hidden` (the usage note and the cursor live region) is the shared
   global utility in assets/main.css — scoped styles can't reach it. */

.hex-viewer__empty {
  padding: 0.5rem;
  color: var(--color-fg-dim);
}

.hex-viewer__grid {
  padding: 0 0.5rem;
}

/* Laid out (so it can be measured) but not shown, and never in the way. */
.hex-viewer__probe {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  white-space: pre;
  visibility: hidden;
  pointer-events: none;
}

/* `:not([hidden])` so this rule does not out-specify the UA `[hidden]` rule and
   leave surplus recycled rows on screen (DomHexRenderer hides them by attribute). */
.hex-viewer :deep(.hex-row:not([hidden])) {
  display: flex;
  gap: 2ch;
  white-space: pre;
}

.hex-viewer :deep(.hex-row__addr) {
  color: var(--color-fg-dim);
}

.hex-viewer :deep(.hex-row__hex) {
  display: inline-flex;
  gap: 1ch;
}

.hex-viewer :deep(.hex-row__ascii) {
  display: inline-flex;
}

.hex-viewer :deep(.hex-row--pending) {
  color: var(--color-fg-dim);
}

/* The byte under the pointer (#30), painted in both panes off the same byte
   offset as the Selection. Listed before `--selected` so that when a byte is
   both, the Selection's fill wins at equal specificity. */
.hex-viewer :deep(.hex-row__byte--hovered),
.hex-viewer :deep(.hex-row__char--hovered) {
  background: var(--color-hover);
}

/* One range, painted in both panes from the same byte offsets (ADR-0003). */
.hex-viewer :deep(.hex-row__byte--selected),
.hex-viewer :deep(.hex-row__char--selected) {
  background: var(--color-selection);
  color: var(--color-selection-fg);
}

/* The focus byte — the Cursor, whether or not the range spans bytes. */
.hex-viewer :deep(.hex-row__byte--cursor),
.hex-viewer :deep(.hex-row__char--cursor) {
  outline: 1px solid var(--color-cursor);
  outline-offset: -1px;
}
</style>
