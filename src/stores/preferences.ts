import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { CODE_PAGES } from '@/core'
import type { CodePage } from '@/core'

/**
 * The shared phase-1.5 seam (plan §2): a Pinia store persisting one JSON object
 * to **one `localStorage` key** — namespaced because GitHub Pages serves every
 * project from the shared `carllom.github.io` origin.
 *
 * Phase 1.75 (`plan-phase1.75.md` §3.4, §4.2) grows the field set: the Inspector
 * dock is gone; `collapsed` becomes the Sidebar-wide `sidebarCollapsed`; the
 * Sidebar width and the two Panel open-states join; the five Bitmap render
 * params join. Still **one key, one JSON object, per-field load validation, no
 * version stamp, no migration machinery** — per-field validation already covers
 * both a key a later version removes (the phase-1.5 `dock` / `collapsed`) and one
 * it adds. Versioning is added later only for a real migration.
 *
 * Explicit named setters, each rewriting the whole object. Load-time validation
 * falls anything invalid *or missing* back to its default; the next `persist()`
 * rewrites the object without the strays.
 */
export const PREFERENCES_STORAGE_KEY = 'bint2:preferences'

/**
 * The Bitmap render-param bounds (plan-phase1.75 §4.2). Exported so the one place
 * that validates a stored value and the one place that clamps a live edit
 * (`BitmapPanel.vue`) share a single source of truth.
 */
export const BITMAP_HEIGHT_MIN = 32
export const BITMAP_HEIGHT_MAX = 4096
export const BITMAP_ZOOM_MIN = 1
export const BITMAP_ZOOM_MAX = 3

/** The view-wide byte order every multi-byte numeric decode obeys (#55, ADR-0007). */
export type ByteOrder = 'le' | 'be'

// The six code pages that ship (#56, plan §5.1) — string literals rather than
// an enum so the stored JSON and a bug report read plainly. The list and the
// `CodePage` type are owned by `src/core` (the tables live there); the store
// only persists which one is selected.
export { CODE_PAGES }
export type { CodePage }

/** The full persisted shape — one JSON object under {@link PREFERENCES_STORAGE_KEY}. */
export interface Preferences {
  /** The whole Sidebar collapsed to nothing via the splitter (plan §3.3). */
  readonly sidebarCollapsed: boolean
  /**
   * Sidebar width in CSS px (plan §3.2). Validated only for finiteness here;
   * clamped to `[200, containerWidth − gridMin]` at the use site.
   */
  readonly sidebarWidth: number
  /** The Inspector accordion section is open (plan §3.1). */
  readonly inspectorOpen: boolean
  /** The Bitmap accordion section is open (plan §3.1, §4.2). */
  readonly bitmapOpen: boolean
  /** Inspector integer rows shown as hex rather than decimal (#54, plan §3.3). */
  readonly intHex: boolean
  /** Little- or big-endian, governing every multi-byte numeric decode (#55). */
  readonly byteOrder: ByteOrder
  /** The char column's glyph table (#56). */
  readonly codePage: CodePage
  /** Bitmap: document bytes drawn per row, each eight pixels (plan §4.2). Int ≥ 1. */
  readonly bitmapWidth: number
  /**
   * Bitmap: the gap added to Width to get Stride — `Stride = Width + offset`,
   * derived, never stored (plan §4.2). Int ≥ 0; a negative clamps to 0 on load.
   */
  readonly bitmapStrideOffset: number
  /**
   * Bitmap: rendered height in 1× px (plan §4.2). Int 32–4096, or `null` to
   * measure the section body once at first open.
   */
  readonly bitmapHeight: number | null
  /** Bitmap: integer upscale factor (plan §4.2). Int 1–3. */
  readonly bitmapZoom: number
  /** Bitmap: swap foreground / background bit values — colour only (plan §4.2). */
  readonly bitmapInvert: boolean
}

const DEFAULTS: Preferences = {
  sidebarCollapsed: false,
  sidebarWidth: 320,
  inspectorOpen: true,
  bitmapOpen: false,
  intHex: false,
  byteOrder: 'le',
  codePage: 'ascii',
  bitmapWidth: 4,
  bitmapStrideOffset: 0,
  bitmapHeight: null,
  bitmapZoom: 2,
  bitmapInvert: false,
}

function isByteOrder(value: unknown): value is ByteOrder {
  return value === 'le' || value === 'be'
}

function isCodePage(value: unknown): value is CodePage {
  return (CODE_PAGES as readonly unknown[]).includes(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/** True for an integer within `[min, max]` inclusive. */
function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** A stored numeric field: an integer in `[min, max]`, else the field's default. */
function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  return isIntInRange(value, min, max) ? value : fallback
}

/**
 * Read the persisted object once, validating each field against its type /
 * range / allowed set. Anything invalid *or missing* — and every unknown key,
 * including the phase-1.5 `dock` / `collapsed` — falls to its default; the next
 * `persist()` rewrites the object without the strays. Malformed JSON is all
 * defaults; `localStorage` throwing is session-only defaults plus one
 * `console.warn` (the load runs once per session).
 */
function loadPreferences(): Preferences {
  let raw: string | null
  try {
    raw = localStorage.getItem(PREFERENCES_STORAGE_KEY)
  } catch {
    console.warn(
      'bint2: preferences could not be read from localStorage; using session-only defaults.',
    )
    return { ...DEFAULTS }
  }
  if (raw === null) {
    return { ...DEFAULTS }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...DEFAULTS }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ...DEFAULTS }
  }

  const stored = parsed as Record<string, unknown>
  return {
    sidebarCollapsed: isBoolean(stored.sidebarCollapsed)
      ? stored.sidebarCollapsed
      : DEFAULTS.sidebarCollapsed,
    sidebarWidth:
      typeof stored.sidebarWidth === 'number' && Number.isFinite(stored.sidebarWidth)
        ? stored.sidebarWidth
        : DEFAULTS.sidebarWidth,
    inspectorOpen: isBoolean(stored.inspectorOpen) ? stored.inspectorOpen : DEFAULTS.inspectorOpen,
    bitmapOpen: isBoolean(stored.bitmapOpen) ? stored.bitmapOpen : DEFAULTS.bitmapOpen,
    intHex: isBoolean(stored.intHex) ? stored.intHex : DEFAULTS.intHex,
    byteOrder: isByteOrder(stored.byteOrder) ? stored.byteOrder : DEFAULTS.byteOrder,
    codePage: isCodePage(stored.codePage) ? stored.codePage : DEFAULTS.codePage,
    bitmapWidth: intInRange(stored.bitmapWidth, 1, Number.MAX_SAFE_INTEGER, DEFAULTS.bitmapWidth),
    // The offset is `int ≥ 0` — but a negative *clamps* to 0 rather than falling
    // to the default (plan §4.2); a non-integer still falls to the default.
    bitmapStrideOffset:
      typeof stored.bitmapStrideOffset === 'number' && Number.isInteger(stored.bitmapStrideOffset)
        ? Math.max(0, stored.bitmapStrideOffset)
        : DEFAULTS.bitmapStrideOffset,
    // An integer in the band, else `null` — which doubles as "measure the
    // section body once at first open" (plan §4.2) and the default.
    bitmapHeight: isIntInRange(stored.bitmapHeight, BITMAP_HEIGHT_MIN, BITMAP_HEIGHT_MAX)
      ? stored.bitmapHeight
      : null,
    bitmapZoom: intInRange(stored.bitmapZoom, BITMAP_ZOOM_MIN, BITMAP_ZOOM_MAX, DEFAULTS.bitmapZoom),
    bitmapInvert: isBoolean(stored.bitmapInvert) ? stored.bitmapInvert : DEFAULTS.bitmapInvert,
  }
}

export const usePreferencesStore = defineStore('preferences', () => {
  const initial = loadPreferences()

  const sidebarCollapsed = ref(initial.sidebarCollapsed)
  const sidebarWidth = ref(initial.sidebarWidth)
  const inspectorOpen = ref(initial.inspectorOpen)
  const bitmapOpen = ref(initial.bitmapOpen)
  const intHex = ref(initial.intHex)
  const byteOrder = ref<ByteOrder>(initial.byteOrder)
  const codePage = ref<CodePage>(initial.codePage)
  const bitmapWidth = ref(initial.bitmapWidth)
  const bitmapStrideOffset = ref(initial.bitmapStrideOffset)
  /**
   * Stride is **derived, never stored** (plan §4.2): `Width + bitmapStrideOffset`,
   * so it tracks Width in both directions for free and `Stride < Width` is
   * unrepresentable. The one place every consumer — `packBitmap` call sites, the
   * read span, the Extent marker — reads it from.
   */
  const bitmapStride = computed(() => bitmapWidth.value + bitmapStrideOffset.value)
  const bitmapHeight = ref<number | null>(initial.bitmapHeight)
  const bitmapZoom = ref(initial.bitmapZoom)
  const bitmapInvert = ref(initial.bitmapInvert)

  // One warning per session for a write failure — not one per rejected `persist()`.
  let warnedOnWrite = false

  /**
   * Rewrite the whole object as JSON on every change (plan §2). A throw here —
   * quota, a locked-down browser — leaves the in-memory refs authoritative for
   * the session and warns once; nothing is shown to the reader.
   */
  function persist(): void {
    const payload: Preferences = {
      sidebarCollapsed: sidebarCollapsed.value,
      sidebarWidth: sidebarWidth.value,
      inspectorOpen: inspectorOpen.value,
      bitmapOpen: bitmapOpen.value,
      intHex: intHex.value,
      byteOrder: byteOrder.value,
      codePage: codePage.value,
      bitmapWidth: bitmapWidth.value,
      bitmapStrideOffset: bitmapStrideOffset.value,
      bitmapHeight: bitmapHeight.value,
      bitmapZoom: bitmapZoom.value,
      bitmapInvert: bitmapInvert.value,
    }
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      if (!warnedOnWrite) {
        console.warn(
          'bint2: preferences could not be saved to localStorage; changes are session-only.',
        )
        warnedOnWrite = true
      }
    }
  }

  function setSidebarCollapsed(next: boolean): void {
    sidebarCollapsed.value = next
    persist()
  }

  function setSidebarWidth(next: number): void {
    sidebarWidth.value = next
    persist()
  }

  function setInspectorOpen(next: boolean): void {
    inspectorOpen.value = next
    persist()
  }

  function setBitmapOpen(next: boolean): void {
    bitmapOpen.value = next
    persist()
  }

  function setIntHex(next: boolean): void {
    intHex.value = next
    persist()
  }

  function setByteOrder(next: ByteOrder): void {
    byteOrder.value = next
    persist()
  }

  function setCodePage(next: CodePage): void {
    codePage.value = next
    persist()
  }

  function setBitmapWidth(next: number): void {
    bitmapWidth.value = next
    persist()
  }

  function setBitmapStrideOffset(next: number): void {
    bitmapStrideOffset.value = next
    persist()
  }

  function setBitmapHeight(next: number | null): void {
    bitmapHeight.value = next
    persist()
  }

  function setBitmapZoom(next: number): void {
    bitmapZoom.value = next
    persist()
  }

  function setBitmapInvert(next: boolean): void {
    bitmapInvert.value = next
    persist()
  }

  return {
    sidebarCollapsed,
    sidebarWidth,
    inspectorOpen,
    bitmapOpen,
    intHex,
    byteOrder,
    codePage,
    bitmapWidth,
    bitmapStrideOffset,
    bitmapStride,
    bitmapHeight,
    bitmapZoom,
    bitmapInvert,
    setSidebarCollapsed,
    setSidebarWidth,
    setInspectorOpen,
    setBitmapOpen,
    setIntHex,
    setByteOrder,
    setCodePage,
    setBitmapWidth,
    setBitmapStrideOffset,
    setBitmapHeight,
    setBitmapZoom,
    setBitmapInvert,
  }
})
