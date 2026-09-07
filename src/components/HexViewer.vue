<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import {
  addressWidthFor,
  offsetFromThumbPixel,
  offsetOfRow,
  rowCount,
  rowOfOffset,
  visibleRows,
} from '@/core'
import type { ViewportMetrics } from '@/core'
import { DomHexRenderer } from '@/rendering'
import type { HexRowView } from '@/rendering'
import VirtualScrollbar from '@/components/VirtualScrollbar.vue'
import { useDocumentStore } from '@/stores/document'

// The Viewport (CONTEXT.md): the bounded window of the document on screen. It
// never depends on a browser layout height — `topByteOffset` in the store is the
// only coordinate (ADR-0006), row height is measured from a probe glyph and fed
// to the pure viewport surface as an input, and the custom scrollbar is the only
// scrollbar at every file size.

const MIN_THUMB_PX = 24 // ADR-0006 default, pinned by the viewport spec
// Pre-measurement fallbacks, from --font-size (13px) * --line-height (1.4). Used
// only until the probe renders; overwritten by the first real measurement.
const DEFAULT_ROW_PX = 18
const DEFAULT_VIEWPORT_PX = DEFAULT_ROW_PX * 40

const documentStore = useDocumentStore()
const gridEl = useTemplateRef<HTMLElement>('grid')
const rowAreaEl = useTemplateRef<HTMLElement>('rowArea')
const probeEl = useTemplateRef<HTMLElement>('probe')
const hasSource = shallowRef(false)

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

function paint(): void {
  renderer?.render({ rows, bytesPerRow: documentStore.bytesPerRow, addressWidth })
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
      .then((bytes) => applyBytes(offset, bytes, gen))
      .catch(() => {
        // read-failed / source-closed: leave the row as ·· (ADR-0004).
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
  const source = documentStore.source
  hasSource.value = source !== null
  addressWidth = source ? addressWidthFor(source.size) : 8
  measure()
  syncRows()
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
  watch(() => documentStore.topByteOffset, scheduleSync) // repaint on scroll
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
})
</script>

<template>
  <div class="hex-viewer">
    <p v-if="!hasSource" class="hex-viewer__empty">
      No file open. Use “Open file…” or drop a file onto the window.
    </p>
    <div ref="rowArea" class="hex-viewer__row-area" @wheel.prevent="onWheel">
      <span ref="probe" class="hex-viewer__probe" aria-hidden="true">00</span>
      <div ref="grid" class="hex-viewer__grid" />
    </div>
    <VirtualScrollbar
      v-if="hasSource"
      :metrics="metrics"
      :top-byte-offset="documentStore.topByteOffset"
      @scroll-to-pixel="onScrollToPixel"
    />
  </div>
</template>

<style scoped>
.hex-viewer {
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
</style>
