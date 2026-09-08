import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * The shared phase-1.5 seam (plan §2): a Pinia store persisting one JSON object
 * to **one `localStorage` key** — namespaced because GitHub Pages serves every
 * project from the shared `carllom.github.io` origin.
 *
 * Every setting the Inspector (#54), byte order (#55) and the code page (#56)
 * persist lives here. Explicit named setters, each rewriting the whole object;
 * a load-time per-field validation that falls anything invalid *or missing*
 * back to its default — **no version stamp, no migration machinery**, since
 * per-field validation already covers both a key a future version adds and a
 * value it changes. Versioning is added later only for a real migration.
 */
export const PREFERENCES_STORAGE_KEY = 'bint2:preferences'

/** Which Viewport edge the Inspector Panel docks to (#54, plan §3.1). */
export type Dock = 'bottom' | 'right'

/** The view-wide byte order every multi-byte numeric decode obeys (#55, ADR-0007). */
export type ByteOrder = 'le' | 'be'

/**
 * The six code pages that ship (#56, plan §5.1). String literals rather than an
 * enum so the stored JSON and a bug report read plainly. `ascii` first — the
 * default and the familiar one — the two PETSCII rows adjacent.
 */
export const CODE_PAGES = [
  'ascii',
  'cp437',
  'windows-1252',
  'petscii',
  'petscii-lower',
  'akai',
] as const
export type CodePage = (typeof CODE_PAGES)[number]

/** The full persisted shape — one JSON object under {@link PREFERENCES_STORAGE_KEY}. */
export interface Preferences {
  /** Inspector collapsed to its thin bar (#54). */
  readonly collapsed: boolean
  /** Which edge the Inspector docks to (#54). */
  readonly dock: Dock
  /** Inspector integer rows shown as hex rather than decimal (#54, plan §3.3). */
  readonly intHex: boolean
  /** Little- or big-endian, governing every multi-byte numeric decode (#55). */
  readonly byteOrder: ByteOrder
  /** The char column's glyph table (#56). */
  readonly codePage: CodePage
}

const DEFAULTS: Preferences = {
  collapsed: false,
  dock: 'bottom',
  intHex: false,
  byteOrder: 'le',
  codePage: 'ascii',
}

function isDock(value: unknown): value is Dock {
  return value === 'bottom' || value === 'right'
}

function isByteOrder(value: unknown): value is ByteOrder {
  return value === 'le' || value === 'be'
}

function isCodePage(value: unknown): value is CodePage {
  return (CODE_PAGES as readonly unknown[]).includes(value)
}

/**
 * Read the persisted object once, validating each field against its type /
 * allowed set. Anything invalid *or missing* — and every unknown key — falls to
 * its default; the next `persist()` rewrites the file without the strays.
 * Malformed JSON is all defaults; `localStorage` throwing is session-only
 * defaults plus one `console.warn` (the load runs once per session).
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
    collapsed: typeof stored.collapsed === 'boolean' ? stored.collapsed : DEFAULTS.collapsed,
    dock: isDock(stored.dock) ? stored.dock : DEFAULTS.dock,
    intHex: typeof stored.intHex === 'boolean' ? stored.intHex : DEFAULTS.intHex,
    byteOrder: isByteOrder(stored.byteOrder) ? stored.byteOrder : DEFAULTS.byteOrder,
    codePage: isCodePage(stored.codePage) ? stored.codePage : DEFAULTS.codePage,
  }
}

export const usePreferencesStore = defineStore('preferences', () => {
  const initial = loadPreferences()

  const collapsed = ref(initial.collapsed)
  const dock = ref<Dock>(initial.dock)
  const intHex = ref(initial.intHex)
  const byteOrder = ref<ByteOrder>(initial.byteOrder)
  const codePage = ref<CodePage>(initial.codePage)

  // One warning per session for a write failure — not one per rejected `persist()`.
  let warnedOnWrite = false

  /**
   * Rewrite the whole object as JSON on every change (plan §2). A throw here —
   * quota, a locked-down browser — leaves the in-memory refs authoritative for
   * the session and warns once; nothing is shown to the reader.
   */
  function persist(): void {
    const payload: Preferences = {
      collapsed: collapsed.value,
      dock: dock.value,
      intHex: intHex.value,
      byteOrder: byteOrder.value,
      codePage: codePage.value,
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

  function setCollapsed(next: boolean): void {
    collapsed.value = next
    persist()
  }

  function setDock(next: Dock): void {
    dock.value = next
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

  return {
    collapsed,
    dock,
    intHex,
    byteOrder,
    codePage,
    setCollapsed,
    setDock,
    setIntHex,
    setByteOrder,
    setCodePage,
  }
})
