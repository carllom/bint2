<script setup lang="ts">
import { computed } from 'vue'
import { rowOfOffset, visibleRows } from '@/core'
import type { ViewportMetrics } from '@/core'

// The Extent marker (plan-phase1.75 §4.8, ADR-0011): a passive sibling overlay
// inside `.hex-viewer__row-area`, showing where a locked Bitmap's byte run — its
// **Extent** — sits in the grid, since those bytes are usually scrolled out of
// view. It holds no coordinate authority: it derives its geometry from
// `topByteOffset` and the same pure `viewport.ts` surface the grid uses
// (ADR-0006), so `DomHexRenderer` / `HexRowRenderer` stay frozen.
//
// Decorative — `aria-hidden`, no live region (ADR-0005). The band is
// `pointer-events: none`, so a byte click underneath still selects; the
// off-screen chevron is the overlay's only hit target and emits `reveal`.

const props = defineProps<{
  /** The Extent `[start, end)`, or `null` when the Origin is not locked / the
   *  Bitmap Panel is not mounted — the overlay renders nothing. */
  range: { start: number; end: number } | null
  /** The sole scroll coordinate (ADR-0006), passed straight through. */
  topByteOffset: number
  /** The same metrics the grid derives its rows from — `bytesPerRow`, the
   *  measured `rowPx`, and `viewportPx` for the clip / chevron edge. */
  metrics: ViewportMetrics
}>()

const emit = defineEmits<{
  /** The chevron was clicked — scroll the grid to the Extent's first row. */
  (e: 'reveal'): void
}>()

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

/**
 * The overlay's geometry, derived purely from the viewport surface:
 * - `chevron` — `'up'` / `'down'` when the Extent is *entirely* above / below
 *   what the grid paints, else `null` (fully or partly visible → a band).
 * - `top` / `height` — the band rect in CSS px, clipped to the viewport.
 * - `cappedTop` / `cappedBottom` — whether that edge is the true Extent
 *   boundary (draw an end cap) rather than a viewport clip.
 */
const geometry = computed(() => {
  const { range, topByteOffset, metrics } = props
  if (range === null || metrics.rowPx <= 0) {
    return null
  }
  const bpr = metrics.bytesPerRow
  const firstRow = rowOfOffset(range.start, bpr)
  // `end` is exclusive and `end > start` always (span ≥ Width ≥ 1), so the last
  // covered byte — and its row — is `end - 1`. A contiguous hull: the band ends
  // at the exact last rendered byte, per-row `Stride > Width` gaps not drawn.
  const lastRow = rowOfOffset(range.end - 1, bpr)
  const topRow = rowOfOffset(topByteOffset, bpr)
  // `visibleRows` is the whole rows that fit; the grid paints one extra partial
  // sliver past it (`HexViewer` syncRows), so a row at `topRow + fit` is still
  // on screen — no chevron, the band just clips at the viewport edge.
  const fit = visibleRows(metrics)

  if (lastRow < topRow) {
    return { chevron: 'up' as const }
  }
  if (firstRow > topRow + fit) {
    return { chevron: 'down' as const }
  }

  const rawTop = (firstRow - topRow) * metrics.rowPx
  const rawBottom = (lastRow - topRow + 1) * metrics.rowPx
  const top = clamp(rawTop, 0, metrics.viewportPx)
  const bottom = clamp(rawBottom, 0, metrics.viewportPx)
  return {
    chevron: null,
    top,
    height: Math.max(0, bottom - top),
    cappedTop: rawTop >= 0,
    cappedBottom: rawBottom <= metrics.viewportPx,
  }
})
</script>

<template>
  <div v-if="geometry !== null" class="extent-marker" aria-hidden="true">
    <button
      v-if="geometry.chevron !== null"
      type="button"
      tabindex="-1"
      class="extent-marker__chevron"
      :class="`extent-marker__chevron--${geometry.chevron}`"
      data-field="extent-chevron"
      title="Scroll to the locked bitmap's bytes"
      @click="emit('reveal')"
    >
      {{ geometry.chevron === 'up' ? '▲' : '▼' }}
    </button>
    <div
      v-else-if="geometry.height > 0"
      class="extent-marker__band"
      :class="{
        'extent-marker__band--cap-top': geometry.cappedTop,
        'extent-marker__band--cap-bottom': geometry.cappedBottom,
      }"
      data-field="extent-band"
      :style="{ top: `${geometry.top}px`, height: `${geometry.height}px` }"
    />
  </div>
</template>

<style scoped>
/* A passive layer over the whole row area — never in the way of a byte click. */
.extent-marker {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* The thin rule down the gutter, from the first to the last covered row. */
.extent-marker__band {
  position: absolute;
  left: 0;
  width: 3px;
  background: var(--color-bitmap-extent);
  pointer-events: none;
}

/* End caps — a short horizontal tick — only on an edge that is the real Extent
   boundary, not a viewport clip. */
.extent-marker__band--cap-top::before,
.extent-marker__band--cap-bottom::after {
  content: '';
  position: absolute;
  left: 0;
  width: 9px;
  height: 3px;
  background: var(--color-bitmap-extent);
}

.extent-marker__band--cap-top::before {
  top: 0;
}

.extent-marker__band--cap-bottom::after {
  bottom: 0;
}

/* The overlay's only hit target: shown only when the Extent is wholly
   off-screen, parked at that edge of the row area. */
.extent-marker__chevron {
  position: absolute;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.4em;
  height: 1.4em;
  padding: 0;
  border: 0;
  border-radius: 0 3px 3px 0;
  background: var(--color-bitmap-extent);
  color: var(--color-bg);
  font: inherit;
  font-size: 0.7em;
  line-height: 1;
  cursor: pointer;
  pointer-events: auto;
}

.extent-marker__chevron--up {
  top: 0;
}

.extent-marker__chevron--down {
  bottom: 0;
}
</style>
