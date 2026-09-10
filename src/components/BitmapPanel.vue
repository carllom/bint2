<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { eofByteSlots, packBitmap, rowByteSpan, toHex } from '@/core'
import type { PackedBitmap } from '@/core'
import { useBytesAt } from '@/composables/useBytesAt'
import { useBitmapStore } from '@/stores/bitmap'
import { useDocumentStore } from '@/stores/document'
import {
  BITMAP_HEIGHT_MAX,
  BITMAP_HEIGHT_MIN,
  BITMAP_ZOOM_MAX,
  BITMAP_ZOOM_MIN,
  usePreferencesStore,
} from '@/stores/preferences'

// The Bitmap Panel (CONTEXT.md, plan-phase1.75.md §4). #81 shipped Follow-mode
// render; #82 added the follow/lock **Origin** state machine (ADR-0008): `L` /
// the header toggle freezes the Origin at the Cursor, the section's arrow /
// page / Home-End keys nudge a locked Origin, and the mode + offset live in
// {@link useBitmapStore} — session-only, never persisted, and surviving the
// section's `unmount-on-hide`.
//
// #83 (this ticket) adds the honest treatments for every "no pixel here" region
// (plan §4.10, #72). The canvas is **always** `Height` rows × `Width·8` px,
// whatever fraction of the span is available. `packBitmap` stays pure (#79) — it
// packs whatever bytes it is handed — and the component paints, on top of the
// packed bits:
//   - **Past EOF** (source offset ≥ `size`): a muted, theme-toned fill,
//     `invert`-independent (chrome, not data) — computed per byte-slot by
//     {@link eofByteSlots}. A row straddling `size` is packed data before it and
//     EOF-fill after it.
//   - **Not-yet-resident** (`useBytesAt` returns `null` — always the whole span,
//     residency is all-or-nothing): plain background, no spinner; a span change
//     onto non-resident bytes clears the canvas for that frame rather than
//     holding the stale one; it repaints when the bytes arrive (ADR-0004).
//   - **Dead source** (`source-gone`): a one-time per-row `readSync` salvage
//     sweep — resident rows packed, the rest permanently plain background — plus
//     the banner {@link useBytesAt} already raises. Per-row painting happens
//     *only* in this terminal case, in both Follow and Lock.
//
// The render is `packBitmap` (the pure #79 transform) of the bytes at the
// Origin, drawn to a `<canvas>` via `putImageData` and upscaled by an **integer**
// `Zoom` in CSS (`image-rendering: pixelated`, smoothing off). The canvas is
// `Height` rows × `Width·8` px; Zoom multiplies only the rendered size.
//
// Read path (plan §4.6, #66): a normal paged `PageCache.read(origin, span)` on
// the *shared* cache, delivered through {@link useBytesAt} with `span` reactive
// (`Stride·(Height − 1) + Width`). Never a Direct read, never a prefetch;
// `PageCache` / `viewport.ts` untouched. A `source-gone` rejection raises the
// dead-source banner once — that escalation lives inside `useBytesAt`.
//
// The `.bitmap` container is the focus container from the shell migration (#80,
// plan §3.6): the Width / Stride keys are bound on it and armed only while focus
// is *within* the content, never on the accordion trigger. `unmount-on-hide`
// means a closed section has no container and the keys are inert.

const documentStore = useDocumentStore()
const preferences = usePreferencesStore()
const bitmap = useBitmapStore()

/** The Cursor's byte offset — the focus end of the one Selection, `null` before
 *  any click. In Follow mode this *is* the Origin. */
const cursorOffset = computed<number | null>(() => documentStore.selection?.focus ?? null)

/** Follow (default) ‖ Lock (plan §4.4, ADR-0008). Session-only; it lives in the
 *  store so it survives the section's `unmount-on-hide`. */
const locked = computed(() => bitmap.originLocked)

/** The document byte offset the top-left pixel maps to. Follow: the Cursor,
 *  byte-for-byte, unaligned to Width or Stride. Lock: the frozen / nudged
 *  offset, with no Cursor input. `null` before any click — the "No Cursor yet"
 *  state (plan §3.4), mirroring the Inspector. */
const origin = computed<number | null>(() =>
  locked.value ? bitmap.lockedOffset : cursorOffset.value,
)

/** There is an Origin to render — a Cursor in Follow, or a locked offset. The
 *  "No Cursor yet" hint and every fill state key off this (plan §4.4). */
const hasOrigin = computed(() => origin.value !== null)

/** The read-only header state line (plan §4.4): "Following cursor" or
 *  "Locked · 0x…". There is no typed Origin field. `origin` is the locked
 *  offset here, so no separate null check is needed. */
const statusText = computed(() =>
  locked.value && origin.value !== null
    ? `Locked · 0x${toHex(origin.value)}`
    : 'Following cursor',
)

// ── Render parameters (plan §4.2) ──────────────────────────────────────────
// Width, Zoom and invert are the persisted values as-is. Stride is *derived* —
// `Width + bitmapStrideOffset` — so it tracks Width in both directions for free
// and `Stride < Width` is unrepresentable (plan §4.2, §4.7). The Height / Zoom
// bounds are the same constants `preferences.ts` validates a stored value
// against — imported, not re-typed.

/** Used only when `bitmapHeight` is `null` and the section body has no measurable
 *  height yet (a layout-free test DOM). */
const FALLBACK_HEIGHT = 64

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

const width = computed(() => preferences.bitmapWidth)
const stride = computed(() => width.value + preferences.bitmapStrideOffset)
const zoom = computed(() => preferences.bitmapZoom)
const invert = computed(() => preferences.bitmapInvert)

// `bitmapHeight` `null` → the Panel's content region ("the section body",
// plan §3.5 — the control strip counts) inner height in CSS px, measured once at
// first open (a fresh mount, because the section is `unmount-on-hide`), then
// sticky once the user edits it (plan §4.2).
const measuredHeight = ref<number | null>(null)
const height = computed(() => {
  if (preferences.bitmapHeight !== null) {
    return clamp(preferences.bitmapHeight, BITMAP_HEIGHT_MIN, BITMAP_HEIGHT_MAX)
  }
  return measuredHeight.value !== null
    ? clamp(measuredHeight.value, BITMAP_HEIGHT_MIN, BITMAP_HEIGHT_MAX)
    : FALLBACK_HEIGHT
})

/** The #66 read span: every row but the last consumes a full Stride, the last
 *  consumes only Width. Reactive — a Width / Stride / Height change re-issues the
 *  read at the new length, guarded against a stale span in `useBytesAt`. */
const span = computed(() => rowByteSpan({ width: width.value, stride: stride.value, height: height.value }))

// The byte run at the Origin. `readSync` serves it in-frame when the covering
// pages are resident — the Follow-mode hot path, where consecutive spans overlap
// almost entirely; otherwise the guarded async `read` fills it in. Residency is
// **all-or-nothing** (plan §4.10): `null` until the whole span is resident, then
// a `Uint8Array` — short when it crosses `size`. A span change nulls it
// synchronously, so a stale frame is cleared, never held.
const bytes = useBytesAt(
  computed(() => documentStore.source),
  origin,
  span,
)

/** The packed 1-bpp frame, or `null` with no Origin. `packBitmap` is pure and
 *  EOF-agnostic (#79) — missing bytes come back as background bits; the honest
 *  past-EOF / pending / dead-source treatments are painted over it below. Kept
 *  as the canvas's intrinsic geometry (`w` = `Width·8`, `h` = `Height`, fixed
 *  regardless of availability) and the test seam for the packed bits. */
const frame = computed<PackedBitmap | null>(() => {
  if (origin.value === null) {
    return null
  }
  return packBitmap(bytes.value ?? new Uint8Array(0), {
    width: width.value,
    stride: stride.value,
    height: height.value,
    invert: invert.value,
  })
})

// ── The "no pixel here" render model (plan §4.10, #72) ────────────────────
/**
 * Which treatment the frame gets, before the past-EOF overlay:
 * - `no-origin`  — nothing clicked / no locked offset; no canvas at all.
 * - `pending`    — the span is not yet resident: the *whole* canvas is plain
 *   background (residency is all-or-nothing, plan §4.10). Repaints on arrival.
 * - `dead-salvage` — `source-gone` and the span never went resident: the
 *   one-time per-row `readSync` sweep below.
 * - `resident`   — a `Uint8Array` is in hand (possibly short at EOF): the
 *   packed `frame`.
 */
type BitmapRenderState = 'no-origin' | 'pending' | 'dead-salvage' | 'resident'

const renderState = computed<BitmapRenderState>(() => {
  if (origin.value === null) {
    return 'no-origin'
  }
  if (bytes.value !== null) {
    return 'resident'
  }
  return documentStore.sourceHealth === 'gone' ? 'dead-salvage' : 'pending'
})

/**
 * Dead-source salvage (plan §4.10, ADR-0004): the source is a dead source and
 * the live span never went resident, so pack whatever rows `readSync` can still
 * serve from already-resident pages and leave the rest plain background —
 * **permanently**, because a dead source's resident set never grows. Per-row
 * packing happens *only* here, in both Follow and Lock. Recomputes if a locked
 * Origin is nudged, sweeping the new rows.
 */
const salvage = computed<{ bits: Uint8Array; rows: boolean[] } | null>(() => {
  if (renderState.value !== 'dead-salvage') {
    return null
  }
  const src = documentStore.source
  const o0 = origin.value
  const w = width.value * 8
  const bits = new Uint8Array(w * height.value)
  const rows: boolean[] = []
  for (let row = 0; row < height.value; row++) {
    const rowOffset = (o0 ?? 0) + row * stride.value
    const want = Math.max(0, Math.min(width.value, documentStore.fileSize - rowOffset))
    const hit = src !== null && want > 0 ? src.readSync(rowOffset, want) : null
    rows.push(hit !== null)
    if (hit !== null) {
      const packed = packBitmap(hit, {
        width: width.value,
        stride: stride.value,
        height: 1,
        invert: invert.value,
      })
      bits.set(packed.bits, row * w)
    }
  }
  return { bits, rows }
})

/** Per-row residency from the last salvage sweep — `true` where the row was
 *  packed and painted, `false` where it stays background. `null` outside the
 *  dead-source case. Exposed for the shell test (the pixels are not observable
 *  in happy-dom). */
const salvagedRows = computed<boolean[] | null>(() => salvage.value?.rows ?? null)

/** The bits to blit *before* the past-EOF overlay. `null` ⇒ the whole canvas is
 *  plain background (pending, or no origin) — `invert` does not reach it. */
const renderBits = computed<Uint8Array | null>(() => {
  switch (renderState.value) {
    case 'resident':
      return frame.value?.bits ?? null
    case 'dead-salvage':
      return salvage.value?.bits ?? null
    default:
      return null
  }
})

/** The past-EOF byte-slots (`1` = at/past `size`), row-major `Width × Height`;
 *  `null` when there are none — no Origin, or the whole Extent sits before
 *  `size` (the Follow-mode common case: skip the allocation and the scan on the
 *  hot path). Not applied while `pending` either — that frame is wholly plain
 *  background. */
const eofMask = computed<Uint8Array | null>(() => {
  if (origin.value === null || origin.value + span.value <= documentStore.fileSize) {
    return null
  }
  return eofByteSlots({
    origin: origin.value,
    width: width.value,
    stride: stride.value,
    height: height.value,
    size: documentStore.fileSize,
  })
})

/** CSS size = intrinsic pixels × integer Zoom; `pixelated` keeps it crisp. */
const canvasStyle = computed(() => {
  const f = frame.value
  return {
    width: `${(f?.w ?? 0) * zoom.value}px`,
    height: `${(f?.h ?? 0) * zoom.value}px`,
    imageRendering: 'pixelated' as const,
  }
})

// ── Painting ──────────────────────────────────────────────────────────────
const root = useTemplateRef<HTMLElement>('root')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

type RGB = [number, number, number]
// Only reached when `getComputedStyle` can't resolve the tokens (a detached or
// test DOM); mirrors the dark `--color-fg` / `--color-bg` / `--color-bitmap-eof`
// in `src/assets/main.css`.
const FG_FALLBACK: RGB = [212, 212, 212]
const BG_FALLBACK: RGB = [30, 30, 30]
const EOF_FALLBACK: RGB = [58, 58, 58]

/** Parse a `#rgb` / `#rrggbb` custom-property value to an RGB triple. The theme
 *  tokens are always hex (`src/assets/main.css`); anything else → `null`. */
function parseColor(raw: string): RGB | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim())
  if (hex === null) {
    return null
  }
  const h = hex[1]!
  const full = h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

/** Foreground = the text colour, background = the surface (plan §4.3, ADR-0005);
 *  `eof` = the muted past-EOF fill (plan §4.10). Read live from the container's
 *  resolved custom properties, so a `prefers-color-scheme` flip is picked up on
 *  the next `paint()` (the `matchMedia` listener below forces one). Falls back to
 *  the dark palette. */
function themeColors(): { fg: RGB; bg: RGB; eof: RGB } {
  const el = root.value
  if (el === null) {
    return { fg: FG_FALLBACK, bg: BG_FALLBACK, eof: EOF_FALLBACK }
  }
  const cs = getComputedStyle(el)
  return {
    fg: parseColor(cs.getPropertyValue('--color-fg')) ?? FG_FALLBACK,
    bg: parseColor(cs.getPropertyValue('--color-bg')) ?? BG_FALLBACK,
    eof: parseColor(cs.getPropertyValue('--color-bitmap-eof')) ?? EOF_FALLBACK,
  }
}

/**
 * Draw the current frame (plan §4.10). Two passes onto one `ImageData`:
 *
 * 1. **Base** — `renderBits` mapped `1` → foreground, `0` → background.
 *    `packBitmap` has already swapped the bit values for `invert`, so this never
 *    branches on it. `renderBits === null` (pending / no bits) paints the whole
 *    canvas plain background — `invert` does not reach it.
 * 2. **Past-EOF overlay** — every byte-slot at/past `size` (from `eofByteSlots`)
 *    is repainted the muted `eof` fill, all eight of its pixels, *ignoring* the
 *    base pass and `invert`: it is chrome, not data. Skipped entirely while
 *    `pending`, so that frame stays wholly plain background.
 *
 * No-op when there is no 2-D context (a test DOM) or no Origin.
 */
function paint(): void {
  const cv = canvas.value
  if (cv === null || origin.value === null) {
    return
  }
  const ctx = cv.getContext('2d')
  if (ctx === null) {
    return
  }
  ctx.imageSmoothingEnabled = false
  const { fg, bg, eof } = themeColors()
  const w = width.value * 8
  const h = height.value
  const bits = renderBits.value
  const mask = renderState.value === 'pending' ? null : eofMask.value
  const img = ctx.createImageData(w, h)
  for (let row = 0; row < h; row++) {
    for (let px = 0; px < w; px++) {
      const i = row * w + px
      let c: RGB
      if (mask !== null && mask[row * width.value + (px >> 3)] === 1) {
        c = eof
      } else if (bits === null) {
        c = bg
      } else {
        c = bits[i] === 1 ? fg : bg
      }
      const o = i * 4
      img.data[o] = c[0]
      img.data[o + 1] = c[1]
      img.data[o + 2] = c[2]
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
}

// Repaint after the DOM has the new intrinsic canvas size (`flush: 'post'`).
// `renderBits` covers the packed / salvaged / pending bits, `eofMask` the
// past-EOF region, `renderState` the transitions where neither identity changes.
watch([renderBits, eofMask, renderState], () => paint(), { flush: 'post' })

// A live OS light/dark switch restyles the rest of the app through CSS, but the
// canvas is painted pixels — repaint it so the theme colours follow (plan §4.3).
const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const repaintOnThemeChange = (): void => paint()

onMounted(() => {
  const h = root.value?.clientHeight
  measuredHeight.value = typeof h === 'number' && h > 0 ? h : null
  darkQuery?.addEventListener('change', repaintOnThemeChange)
  paint()
})

onBeforeUnmount(() => {
  darkQuery?.removeEventListener('change', repaintOnThemeChange)
})

// ── Controls (plan §4.2) — in the Panel's own body, never the toolbar ─────
/** Read an integer off a control and hand it to `apply`; a non-numeric entry is
 *  ignored (the field re-binds to the model on the next render). */
function commitInt(event: Event, apply: (n: number) => void): void {
  const n = Math.trunc(Number((event.target as HTMLInputElement).value))
  if (Number.isFinite(n)) {
    apply(n)
  }
}

const onWidth = (e: Event): void => commitInt(e, (n) => preferences.setBitmapWidth(Math.max(1, n)))

/** The Stride field takes an absolute value; it is stored as the offset over
 *  Width, clamped so Stride ≥ Width (plan §4.2). */
const onStride = (e: Event): void =>
  commitInt(e, (n) => preferences.setBitmapStrideOffset(Math.max(0, n - width.value)))

const onHeight = (e: Event): void =>
  commitInt(e, (n) => preferences.setBitmapHeight(clamp(n, BITMAP_HEIGHT_MIN, BITMAP_HEIGHT_MAX)))

const onZoom = (e: Event): void =>
  commitInt(e, (n) => preferences.setBitmapZoom(clamp(n, BITMAP_ZOOM_MIN, BITMAP_ZOOM_MAX)))

function onInvert(event: Event): void {
  preferences.setBitmapInvert((event.target as HTMLInputElement).checked)
}

// ── Follow / Lock the Origin (plan §4.4, ADR-0008) ────────────────────────
/** `L` and the header toggle. Lock freezes the Origin at the current Cursor
 *  offset; toggling back snaps the Origin to the Cursor's *current* offset — the
 *  `origin` computed re-reads `cursorOffset`, so "snap back" is automatic — and
 *  resumes tracking. Inert with no Cursor (`toggleLock` is only reachable while
 *  `hasOrigin`). */
function toggleLock(): void {
  if (locked.value) {
    bitmap.followCursor()
  } else if (cursorOffset.value !== null) {
    bitmap.lockOrigin(cursorOffset.value)
  }
}

// ── Keys (plan §4.5, bound by `KeyboardEvent.code`, layout-independent) ────
// Either mode: `Comma` / `Period` = Width ∓ 1; `Shift` for Stride ∓ 1 (steps
// `bitmapStrideOffset`, clamped ≥ 0); `KeyL` toggles Lock / Follow. Locked only:
// `←→` = Origin ∓ 1 byte, `↑↓` = ∓ one Stride (a bitmap row), `PageUp`/`Down` =
// ∓ one canvas (Stride × the Height rows it always draws, plan §4.10), `Home` /
// `End` = Origin → 0 / `size`. Armed only while the content is focused and an
// Origin exists; inert when a control has focus so `.` typed in a number field
// is not stolen.
function onKeydown(event: KeyboardEvent): void {
  if (!hasOrigin.value) {
    return
  }
  const tag = (event.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    return
  }

  if (event.code === 'Comma' || event.code === 'Period') {
    event.preventDefault()
    const delta = event.code === 'Comma' ? -1 : 1
    if (event.shiftKey) {
      preferences.setBitmapStrideOffset(Math.max(0, preferences.bitmapStrideOffset + delta))
    } else {
      preferences.setBitmapWidth(Math.max(1, preferences.bitmapWidth + delta))
    }
    return
  }

  if (event.code === 'KeyL') {
    event.preventDefault()
    toggleLock()
    return
  }

  // Origin nudges — locked mode only; in Follow the Cursor is the linkage and
  // these keys are inert (plan §4.4). One row is a Stride; one page is the whole
  // bitmap — Stride × the Height rows the canvas always draws (plan §4.10). The
  // offset arithmetic and the `[0, size]` clamp live on the store.
  if (!locked.value) {
    return
  }
  switch (event.code) {
    case 'ArrowLeft':
      bitmap.nudgeOrigin(-1)
      break
    case 'ArrowRight':
      bitmap.nudgeOrigin(1)
      break
    case 'ArrowUp':
      bitmap.nudgeOrigin(-stride.value)
      break
    case 'ArrowDown':
      bitmap.nudgeOrigin(stride.value)
      break
    case 'PageUp':
      bitmap.nudgeOrigin(-stride.value * height.value)
      break
    case 'PageDown':
      bitmap.nudgeOrigin(stride.value * height.value)
      break
    case 'Home':
      bitmap.jumpOrigin(0)
      break
    case 'End':
      bitmap.jumpOrigin(documentStore.fileSize)
      break
    default:
      return
  }
  event.preventDefault()
}

function focusSelf(event: PointerEvent): void {
  ;(event.currentTarget as HTMLElement).focus()
}

// Test seam — the packed frame plus the #83 render model, because none of it is
// observable from the DOM (happy-dom gives `<canvas>` no 2-D context, plan §7):
// `renderState` (pending / dead-salvage / resident / no-origin), `eofMask` (the
// past-EOF byte-slots), and `salvagedRows` (which rows the dead-source sweep
// filled). Geometry, Zoom, invert and the Origin are read from the controls /
// canvas attributes / the store in the shell test.
defineExpose({ frame, renderState, eofMask, salvagedRows })
</script>

<template>
  <div
    ref="root"
    class="bitmap"
    role="group"
    aria-label="Bitmap"
    tabindex="0"
    data-region="bitmap"
    @pointerdown="focusSelf"
    @keydown="onKeydown"
  >
    <p v-if="!hasOrigin" class="bitmap__hint" data-field="bitmap-no-cursor">
      No Cursor yet — click a byte in the grid to point the bitmap.
    </p>

    <template v-else>
      <!-- The header: the Lock Origin / Follow Cursor toggle (mirrored by `L`)
           and the read-only state line (plan §4.4). No typed Origin field. -->
      <div class="bitmap__header">
        <button
          type="button"
          class="bitmap__lock"
          :aria-pressed="locked"
          data-field="bitmap-lock-toggle"
          @click="toggleLock"
        >
          {{ locked ? 'Follow Cursor' : 'Lock Origin' }}
        </button>
        <p class="bitmap__status" data-field="bitmap-status">{{ statusText }}</p>
      </div>

      <div class="bitmap__controls">
        <label class="bitmap__ctl">
          <span>Width</span>
          <input
            type="number"
            min="1"
            :value="width"
            data-field="bitmap-width"
            @change="onWidth"
          />
        </label>
        <label class="bitmap__ctl">
          <span>Stride</span>
          <input
            type="number"
            :min="width"
            :value="stride"
            data-field="bitmap-stride"
            title="Stride — Shift+, / Shift+. step it by 1 while the bitmap is focused"
            @change="onStride"
          />
        </label>
        <label class="bitmap__ctl">
          <span>Height</span>
          <input
            type="number"
            :min="BITMAP_HEIGHT_MIN"
            :max="BITMAP_HEIGHT_MAX"
            :value="height"
            data-field="bitmap-height"
            @change="onHeight"
          />
        </label>
        <label class="bitmap__ctl">
          <span>Zoom</span>
          <input
            type="number"
            :min="BITMAP_ZOOM_MIN"
            :max="BITMAP_ZOOM_MAX"
            :value="zoom"
            data-field="bitmap-zoom"
            @change="onZoom"
          />
        </label>
        <label class="bitmap__ctl bitmap__ctl--check">
          <input type="checkbox" :checked="invert" data-field="bitmap-invert" @change="onInvert" />
          <span>invert</span>
        </label>
      </div>

      <!-- Decorative: the pixels are a rendering of bytes shown elsewhere, and
           the Cursor live region already speaks the Follow-mode linkage
           (ADR-0005, mirroring the Extent marker). -->
      <div class="bitmap__scroll">
        <canvas
          ref="canvas"
          class="bitmap__canvas"
          data-field="bitmap-canvas"
          aria-hidden="true"
          :width="frame?.w ?? 0"
          :height="frame?.h ?? 0"
          :style="canvasStyle"
        ></canvas>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Natural content height — the whole Sidebar scrolls if the stack overflows,
   the section never gets a scrollbar of its own (plan §3.1). The visible focus
   ring is the cue that the Width / Stride keys are armed. */
.bitmap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 2rem;
  font-family: var(--font-mono);
  color: var(--color-fg);
}

.bitmap:focus-visible {
  outline: 1px solid var(--color-cursor);
  outline-offset: -1px;
}

.bitmap__hint {
  color: var(--color-fg-dim);
}

.bitmap__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 1ch;
}

/* The lock toggle: a pressed-state button on the shared control tokens, in the
   spirit of the Inspector's `hex` control strip (plan §3.5). */
.bitmap__lock {
  padding: 0.1em 0.4em;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: none;
  color: var(--color-fg);
  font: inherit;
  cursor: pointer;
}

.bitmap__lock[aria-pressed='true'] {
  background: var(--color-selection);
  color: var(--color-selection-fg);
}

.bitmap__status {
  color: var(--color-fg-dim);
}

.bitmap__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75ch;
}

.bitmap__ctl {
  display: inline-flex;
  align-items: baseline;
  gap: 0.5ch;
}

.bitmap__ctl > span {
  color: var(--color-fg-dim);
}

/* Wide enough that at least 3 digits stay visible past the native spinner
   buttons (Height reaches 4096); `flex: none` so the wrapping control strip
   never shrinks it back below that. */
.bitmap__ctl input[type='number'] {
  flex: none;
  width: 7ch;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: none;
  color: var(--color-fg);
  font: inherit;
  padding: 0.1em 0.3em;
}

.bitmap__ctl--check {
  align-items: center;
}

/* Horizontal-only inner scroll for image-width overflow (plan §3.1); never
   clipped vertically — a tall image just makes the Sidebar scroll. */
.bitmap__scroll {
  overflow-x: auto;
  overflow-y: hidden;
}

.bitmap__canvas {
  display: block;
  image-rendering: pixelated;
  background: var(--color-bg);
}
</style>
