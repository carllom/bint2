<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import { addressWidthFor } from '@/core'
import type { ByteSource } from '@/core'
import { DomHexRenderer } from '@/rendering'
import type { HexRowView } from '@/rendering'
import { useDocumentStore } from '@/stores/document'

// The tracer bullet (plan M3, trimmed): the first screen of the document, no
// scrolling. `bytesPerRow` presets and a measured row height arrive with the
// scrollbar milestone (M4) behind viewport.ts; until then the row width is
// fixed and the screenful is a constant.
const BYTES_PER_ROW = 16
const VISIBLE_ROWS = 48

const documentStore = useDocumentStore()
const gridEl = useTemplateRef<HTMLElement>('grid')
const hasSource = shallowRef(false)

let renderer: DomHexRenderer | null = null
let rows: HexRowView[] = []
let addressWidth = 8
// Bumped on every document change; a read that resolves against a stale
// generation is dropped rather than painted (plan §4).
let generation = 0
let paintQueued = false

function paint(): void {
  renderer?.render({ rows, bytesPerRow: BYTES_PER_ROW, addressWidth })
}

/**
 * Coalesce the repaints from a screenful of reads settling into one per tick —
 * otherwise opening a file triggers a full-grid re-render per row.
 */
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

function load(source: ByteSource | null): void {
  generation += 1
  const thisGeneration = generation
  hasSource.value = source !== null

  if (!source) {
    rows = []
    addressWidth = 8
    paint()
    return
  }

  addressWidth = addressWidthFor(source.size)
  const totalRows = Math.ceil(source.size / BYTES_PER_ROW)
  const rowCount = Math.min(VISIBLE_ROWS, totalRows)

  rows = Array.from({ length: rowCount }, (_unused, index) => ({
    offset: index * BYTES_PER_ROW,
    bytes: null as Uint8Array | null,
  }))
  paint() // placeholders first

  rows.forEach((row, index) => {
    const length = Math.min(BYTES_PER_ROW, source.size - row.offset)
    const hit = source.readSync(row.offset, length)
    if (hit) {
      rows[index] = { offset: row.offset, bytes: hit }
      schedulePaint()
      return
    }
    source
      .read(row.offset, length)
      .then((bytes) => {
        if (thisGeneration !== generation) {
          return // a newer document opened; this read is stale
        }
        rows[index] = { offset: row.offset, bytes }
        schedulePaint()
      })
      .catch(() => {
        // read-failed / source-closed: leave the row as ·· (ADR-0004).
      })
  })
}

onMounted(() => {
  renderer = new DomHexRenderer(gridEl.value!)
  watch(() => documentStore.source, load, { immediate: true })
})

onBeforeUnmount(() => {
  generation += 1 // abandon in-flight reads
  renderer = null // and any queued repaint
})
</script>

<template>
  <div class="hex-viewer">
    <p v-if="!hasSource" class="hex-viewer__empty">
      No file open. Use “Open file…” or drop a file onto the window.
    </p>
    <div ref="grid" class="hex-viewer__grid" />
  </div>
</template>

<style scoped>
.hex-viewer {
  height: 100%;
  overflow: auto;
  /* ADR-0003: native text selection is unusable over the grid. */
  user-select: none;
}

.hex-viewer__empty {
  padding: 0.5rem;
  color: var(--color-fg-dim);
}

.hex-viewer__grid {
  padding: 0.25rem 0.5rem;
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
