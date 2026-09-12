<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import {
  barHeight,
  entropyBlockAt,
  entropyBlockRange,
  entropyColor,
  histogramFrequencies,
  isCollapsed,
  maxFrequency,
  rangeOf,
  toHex,
} from '@/core'
import type { EntropyColorTheme } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { useEntropyStore, type EntropyScope } from '@/stores/entropy'
import { usePreferencesStore } from '@/stores/preferences'

// The Entropy Panel's Map and Histogram views (#107/#108, CONTEXT.md's
// Entropy map / Byte histogram, ADR-0012, plan-phase2.md §4). A pure
// view-swap over one computed result (ADR-0012's whole point: one Panel, one
// Compute, two renderings that land together) — the toggle never retriggers
// Compute.
//
// State lives in `useEntropyStore` (mode, scope, the last completed
// `StatsResult`, staleness inputs, the in-flight job) because the section is
// `unmount-on-hide` and an 18-24s scan (plan §2.1) must survive the reader
// collapsing the Panel to glance elsewhere. This component is the thin
// rendering/interaction layer over it: the effective (scope-resolved) range,
// the staleness comparison, the strip's canvas paint, and click-to-cursor.
//
// Scope (plan §4.3): "Whole file" | "Selection", reusing the Selection
// concept directly — no captured-once-at-toggle range the way the Find box's
// scope works (#105). Entropy's own scope is *live*: `effectiveRange` always
// reads the current Selection, so a Selection range change is exactly what
// makes the last result stale (`computedFor` no longer matches). "Selection"
// is disabled — not hidden — with no non-collapsed Selection, and both the
// button and the effective range fall back to whole file in that case.

const documentStore = useDocumentStore()
const preferences = usePreferencesStore()
const entropy = useEntropyStore()

/** "Selection" scope is disabled, not hidden, with nothing non-collapsed marked (plan §4.3, mirrors FindBox). */
const scopeSelectionDisabled = computed(() => {
  const sel = documentStore.selection
  return sel === null || isCollapsed(sel)
})

/**
 * The range Compute would run against right now: the live Selection when
 * scope is 'selection' and one exists, else the whole file — the same
 * fallback Selection-scope disabling implies (plan §4.3).
 */
const effectiveRange = computed(() => {
  const sel = documentStore.selection
  if (entropy.scope === 'selection' && sel !== null && !isCollapsed(sel)) {
    return rangeOf(sel)
  }
  return { start: 0, end: documentStore.fileSize }
})

const blockSize = computed(() => preferences.entropyBlockSize)

/**
 * Any of scope, the Selection's range, or block size drifting from what
 * `computedFor` recorded marks the last result stale — dimmed with a
 * recompute affordance, never cleared or auto-recomputed (plan §4.3).
 * `false` with no result yet — there is nothing to be stale.
 */
const stale = computed(() => {
  const cf = entropy.computedFor
  if (cf === null) {
    return false
  }
  const range = effectiveRange.value
  return cf.start !== range.start || cf.end !== range.end || cf.blockSize !== blockSize.value
})

function setScope(next: EntropyScope): void {
  if (next === 'selection' && scopeSelectionDisabled.value) {
    return // the button is disabled for this case, but guard it anyway
  }
  entropy.setScope(next)
}

function onBlockSize(event: Event): void {
  const n = Math.trunc(Number((event.target as HTMLInputElement).value))
  if (Number.isFinite(n)) {
    preferences.setEntropyBlockSize(Math.max(1, n))
  }
}

/** The Compute action (plan §4.2) — always the current effective range/block size, regardless of staleness. */
function compute(): void {
  entropy.compute(effectiveRange.value, blockSize.value)
}

function cancel(): void {
  entropy.cancel()
}

const statusText = computed(() => {
  if (entropy.pending) {
    return `Computing… ${Math.round(entropy.progressPercent * 100)}%`
  }
  if (stale.value) {
    return 'Stale — Compute to refresh.'
  }
  return ''
})

// ── Map rendering (plan §4.4) ──────────────────────────────────────────────
// A single horizontal strip, one canvas pixel per block, CSS-stretched to the
// Panel's width (`entropyBlockAt`/`entropyColor`, `src/core/entropyMap.ts`) —
// the "positional heatmap strip" ADR-0012 contrasts with the histogram's
// axis-free bar chart. Always renders the *last completed* `result`, never
// the live effective range — that is exactly the staleness dimming's job.

const STRIP_HEIGHT = 32

const numBlocks = computed(() => entropy.result?.entropy.length ?? 0)

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

function paint(): void {
  const cv = canvas.value
  const result = entropy.result
  if (cv === null || result === null) {
    return
  }
  const ctx = cv.getContext('2d')
  if (ctx === null) {
    return
  }
  const theme: EntropyColorTheme = darkQuery?.matches === false ? 'light' : 'dark'
  for (let i = 0; i < result.entropy.length; i++) {
    ctx.fillStyle = entropyColor(result.entropy[i]!, theme)
    ctx.fillRect(i, 0, 1, STRIP_HEIGHT)
  }
}

// ── Histogram rendering (plan §4.5) ────────────────────────────────────────
// A bespoke bar chart, one canvas column per byte value (always 256 — the
// alphabet size, unlike the Map's `numBlocks`), height scaled to the range's
// own max frequency rather than a fixed 0-100% axis (`histogramFrequencies`/
// `maxFrequency`/`barHeight`, `src/core/histogram.ts`). No positional axis
// and no click-to-cursor (ADR-0012/plan §4.5) — hovering a bar only shows a
// tooltip.

const HISTOGRAM_BARS = 256
const HISTOGRAM_HEIGHT = 64

const frequencies = computed(() =>
  entropy.result !== null ? histogramFrequencies(entropy.result.histogram) : null,
)

const histogramCanvas = useTemplateRef<HTMLCanvasElement>('histogramCanvas')

/** Mirrors the Map's thermal gradient in spirit but stays a single accent color — a bar chart has no scalar to color by. */
function histogramBarColor(theme: EntropyColorTheme): string {
  return theme === 'dark' ? '#6ea9ff' : '#0067c0'
}

function paintHistogram(): void {
  const cv = histogramCanvas.value
  const freqs = frequencies.value
  if (cv === null || freqs === null) {
    return
  }
  const ctx = cv.getContext('2d')
  if (ctx === null) {
    return
  }
  ctx.clearRect(0, 0, cv.width, cv.height)
  const theme: EntropyColorTheme = darkQuery?.matches === false ? 'light' : 'dark'
  ctx.fillStyle = histogramBarColor(theme)
  const max = maxFrequency(freqs)
  for (let byte = 0; byte < freqs.length; byte++) {
    const h = barHeight(freqs[byte]!, max) * HISTOGRAM_HEIGHT
    if (h > 0) {
      ctx.fillRect(byte, HISTOGRAM_HEIGHT - h, 1, h)
    }
  }
}

interface HistogramTooltip {
  readonly x: number
  readonly y: number
  readonly text: string
}

const histogramTooltip = ref<HistogramTooltip | null>(null)

/** Hover-only (plan §4.5): shows the hovered byte value's count/percentage. Clicking does nothing beyond this. */
function onHistogramPointerMove(event: PointerEvent): void {
  const cv = histogramCanvas.value
  const result = entropy.result
  const freqs = frequencies.value
  if (cv === null || result === null || freqs === null) {
    histogramTooltip.value = null
    return
  }
  const rect = cv.getBoundingClientRect()
  const byte = entropyBlockAt({
    x: event.clientX - rect.left,
    displayWidth: rect.width,
    numBlocks: HISTOGRAM_BARS,
  })
  if (byte === null) {
    histogramTooltip.value = null
    return
  }
  const count = result.histogram[byte]!
  const percent = freqs[byte]! * 100
  histogramTooltip.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    text: `0x${toHex(byte)} — ${count.toLocaleString()} (${percent.toFixed(2)}%)`,
  }
}

function onHistogramPointerLeave(): void {
  histogramTooltip.value = null
}

const repaintOnThemeChange = (): void => {
  paint()
  paintHistogram()
}

watch(
  [() => entropy.result, () => entropy.mode],
  () => {
    histogramTooltip.value = null
    paint()
    paintHistogram()
  },
  { flush: 'post' },
)

onMounted(() => {
  darkQuery?.addEventListener('change', repaintOnThemeChange)
  paint()
  paintHistogram()
})

onBeforeUnmount(() => {
  darkQuery?.removeEventListener('change', repaintOnThemeChange)
})

/**
 * Click-to-cursor on the strip (plan §4.4): plain click -> `setCursor` at the
 * block's first byte; Shift-click -> `extendSelectionTo` the block's last
 * byte, selecting the whole block — both start from `setCursor` so the
 * anchor is always the block's own first byte, mirroring
 * `SearchResultsPanel`'s row click rather than the Bitmap's
 * extend-from-whatever-anchor convention, since "select the whole block" is
 * explicit here. Both followed by `requestReveal` at the block's first byte.
 * Reads geometry from `computedFor`, not the live scope/range — the block a
 * reader clicks is a block of the *rendered* (possibly stale) result.
 */
function onCanvasPointerDown(event: PointerEvent): void {
  const cf = entropy.computedFor
  const cv = canvas.value
  if (event.button !== 0 || cf === null || cv === null) {
    return
  }
  const rect = cv.getBoundingClientRect()
  const blockIndex = entropyBlockAt({
    x: event.clientX - rect.left,
    displayWidth: rect.width,
    numBlocks: numBlocks.value,
  })
  if (blockIndex === null) {
    return
  }
  const range = entropyBlockRange({
    rangeStart: cf.start,
    rangeEnd: cf.end,
    blockSize: cf.blockSize,
    blockIndex,
  })
  documentStore.setCursor(range.start)
  if (event.shiftKey) {
    documentStore.extendSelectionTo(range.end - 1)
  }
  documentStore.requestReveal(range.start)
}

// Test seam — `numBlocks`/`stale`/`effectiveRange`/`frequencies` are not
// otherwise observable from the DOM alone (the canvas paints happy-dom can't
// read back).
defineExpose({ numBlocks, stale, effectiveRange, frequencies })
</script>

<template>
  <div class="entropy" role="group" aria-label="Entropy" data-region="entropy">
    <div class="entropy__header">
      <span class="entropy__group" role="group" aria-label="Entropy view">
        <button
          type="button"
          class="entropy__mode-map"
          :aria-pressed="entropy.mode === 'map'"
          :class="{ 'entropy__toggle--active': entropy.mode === 'map' }"
          @click="entropy.setMode('map')"
        >
          Map
        </button>
        <button
          type="button"
          class="entropy__mode-histogram"
          :aria-pressed="entropy.mode === 'histogram'"
          :class="{ 'entropy__toggle--active': entropy.mode === 'histogram' }"
          @click="entropy.setMode('histogram')"
        >
          Histogram
        </button>
      </span>
    </div>

    <div class="entropy__controls">
      <span class="entropy__group" role="group" aria-label="Scope">
        <button
          type="button"
          class="entropy__scope-file"
          :aria-pressed="entropy.scope === 'file'"
          :class="{ 'entropy__toggle--active': entropy.scope === 'file' }"
          @click="setScope('file')"
        >
          Whole file
        </button>
        <button
          type="button"
          class="entropy__scope-selection"
          :aria-pressed="entropy.scope === 'selection'"
          :class="{ 'entropy__toggle--active': entropy.scope === 'selection' }"
          :disabled="scopeSelectionDisabled"
          @click="setScope('selection')"
        >
          Selection
        </button>
      </span>
      <label class="entropy__ctl">
        <span>Block size</span>
        <input
          type="number"
          min="1"
          :value="blockSize"
          data-field="entropy-block-size"
          @change="onBlockSize"
        />
      </label>
      <button
        v-if="!entropy.pending"
        type="button"
        class="entropy__compute"
        data-field="entropy-compute"
        @click="compute"
      >
        {{ stale ? 'Recompute' : 'Compute' }}
      </button>
      <button
        v-else
        type="button"
        class="entropy__cancel"
        data-field="entropy-cancel"
        @click="cancel"
      >
        Cancel
      </button>
    </div>

    <p
      v-if="statusText"
      class="entropy__status"
      role="status"
      data-field="entropy-status"
      :class="{ 'entropy__status--stale': stale && !entropy.pending }"
    >
      {{ statusText }}
    </p>

    <p v-if="entropy.result === null" class="entropy__hint" data-field="entropy-no-result">
      No result yet — Compute to scan the file.
    </p>
    <template v-else-if="entropy.mode === 'map'">
      <div class="entropy__map" :class="{ 'entropy__map--stale': stale }">
        <canvas
          ref="canvas"
          class="entropy__canvas"
          data-field="entropy-canvas"
          aria-hidden="true"
          :width="numBlocks"
          :height="STRIP_HEIGHT"
          @pointerdown="onCanvasPointerDown"
        ></canvas>
      </div>
    </template>
    <div v-else class="entropy__histogram" :class="{ 'entropy__histogram--stale': stale }">
      <canvas
        ref="histogramCanvas"
        class="entropy__canvas"
        data-field="entropy-histogram-canvas"
        aria-hidden="true"
        :width="HISTOGRAM_BARS"
        :height="HISTOGRAM_HEIGHT"
        @pointermove="onHistogramPointerMove"
        @pointerleave="onHistogramPointerLeave"
      ></canvas>
      <div
        v-if="histogramTooltip"
        class="entropy__tooltip"
        data-field="entropy-histogram-tooltip"
        :style="{ left: `${histogramTooltip.x}px`, top: `${histogramTooltip.y}px` }"
      >
        {{ histogramTooltip.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.entropy {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 2rem;
  font-family: var(--font-mono);
  color: var(--color-fg);
}

.entropy__header,
.entropy__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75ch;
}

.entropy__group {
  display: inline-flex;
  gap: 1px;
}

.entropy__mode-map,
.entropy__mode-histogram,
.entropy__scope-file,
.entropy__scope-selection,
.entropy__compute,
.entropy__cancel {
  padding: 0.15rem 0.6rem;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font: inherit;
  cursor: pointer;
}

.entropy__group .entropy__mode-map,
.entropy__group .entropy__scope-file {
  border-radius: 3px 0 0 3px;
}

.entropy__group .entropy__mode-histogram,
.entropy__group .entropy__scope-selection {
  border-radius: 0 3px 3px 0;
}

.entropy__toggle--active {
  background: var(--color-border);
}

.entropy__scope-selection:disabled {
  color: var(--color-fg-dim);
  cursor: default;
}

.entropy__ctl {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5ch;
}

.entropy__ctl > span {
  color: var(--color-fg-dim);
}

.entropy__ctl input[type='number'] {
  flex: none;
  width: 7ch;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: none;
  color: var(--color-fg);
  font: inherit;
  padding: 0.1em 0.3em;
}

.entropy__status {
  margin: 0;
  color: var(--color-fg-dim);
  font-size: 0.9em;
}

.entropy__status--stale {
  color: var(--color-fg-dim);
  font-style: italic;
}

.entropy__hint {
  margin: 0;
  color: var(--color-fg-dim);
}

.entropy__map {
  width: 100%;
}

.entropy__map--stale {
  opacity: 0.55;
}

.entropy__canvas {
  display: block;
  width: 100%;
  height: 32px;
  image-rendering: pixelated;
  background: var(--color-bg);
}

.entropy__histogram {
  position: relative;
  width: 100%;
}

.entropy__histogram--stale {
  opacity: 0.55;
}

.entropy__histogram .entropy__canvas {
  height: 64px;
}

.entropy__tooltip {
  position: absolute;
  transform: translate(-50%, -100%);
  padding: 0.15rem 0.5ch;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: 0.85em;
  white-space: nowrap;
  pointer-events: none;
}
</style>
