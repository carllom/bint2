import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_PAGES,
  PREFERENCES_STORAGE_KEY,
  usePreferencesStore,
  type Preferences,
} from '../preferences'

// The shared phase-1.5 seam (plan §2), grown to the phase-1.75 field set
// (plan-phase1.75.md §3.4, §4.2). Tests use the real happy-dom `localStorage` —
// no injected storage — cleared between cases, and create the store *after*
// seeding storage so the one-shot load sees it.

const KEY = PREFERENCES_STORAGE_KEY

/** Seed the persisted object, then activate a fresh Pinia so load() runs now. */
function withStored(value: unknown): ReturnType<typeof usePreferencesStore> {
  localStorage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value))
  setActivePinia(createPinia())
  return usePreferencesStore()
}

/** The object currently in `localStorage`, parsed. */
function readBack(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(KEY)!)
}

/** Every field, read off the store into a plain object for whole-shape asserts. */
function snapshot(store: ReturnType<typeof usePreferencesStore>): Preferences {
  return {
    sidebarCollapsed: store.sidebarCollapsed,
    sidebarWidth: store.sidebarWidth,
    inspectorOpen: store.inspectorOpen,
    bitmapOpen: store.bitmapOpen,
    searchResultsOpen: store.searchResultsOpen,
    intHex: store.intHex,
    byteOrder: store.byteOrder,
    codePage: store.codePage,
    bitmapWidth: store.bitmapWidth,
    bitmapStrideOffset: store.bitmapStrideOffset,
    bitmapHeight: store.bitmapHeight,
    bitmapZoom: store.bitmapZoom,
    bitmapInvert: store.bitmapInvert,
  }
}

const DEFAULTS: Preferences = {
  sidebarCollapsed: false,
  sidebarWidth: 320,
  inspectorOpen: true,
  bitmapOpen: false,
  searchResultsOpen: false,
  intHex: false,
  byteOrder: 'le',
  codePage: 'ascii',
  bitmapWidth: 4,
  bitmapStrideOffset: 0,
  bitmapHeight: null,
  bitmapZoom: 2,
  bitmapInvert: false,
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('preferences store — defaults', () => {
  it('starts at every default with nothing persisted', () => {
    expect(snapshot(usePreferencesStore())).toEqual(DEFAULTS)
  })

  it('offers ascii first and the two PETSCII rows adjacent (#56, plan §5.1)', () => {
    expect([...CODE_PAGES]).toEqual([
      'ascii',
      'cp437',
      'windows-1252',
      'petscii',
      'petscii-lower',
      'akai',
    ])
  })
})

describe('preferences store — setters persist the whole object as JSON', () => {
  it('each setter updates its field and rewrites the one key', () => {
    const store = usePreferencesStore()

    store.setSidebarCollapsed(true)
    expect(store.sidebarCollapsed).toBe(true)
    expect(readBack()).toEqual({ ...DEFAULTS, sidebarCollapsed: true })

    store.setSidebarWidth(440)
    store.setInspectorOpen(false)
    store.setBitmapOpen(true)
    store.setSearchResultsOpen(true)
    store.setIntHex(true)
    store.setByteOrder('be')
    store.setCodePage('cp437')
    store.setBitmapWidth(13)
    store.setBitmapStrideOffset(3)
    store.setBitmapHeight(128)
    store.setBitmapZoom(3)
    store.setBitmapInvert(true)

    expect(readBack()).toEqual({
      sidebarCollapsed: true,
      sidebarWidth: 440,
      inspectorOpen: false,
      bitmapOpen: true,
      searchResultsOpen: true,
      intHex: true,
      byteOrder: 'be',
      codePage: 'cp437',
      bitmapWidth: 13,
      bitmapStrideOffset: 3,
      bitmapHeight: 128,
      bitmapZoom: 3,
      bitmapInvert: true,
    })
  })

  it('setBitmapHeight accepts null (back to measure-once)', () => {
    const store = usePreferencesStore()
    store.setBitmapHeight(200)
    store.setBitmapHeight(null)
    expect(store.bitmapHeight).toBeNull()
    expect(readBack().bitmapHeight).toBeNull()
  })

  it('persists to exactly one localStorage key', () => {
    const store = usePreferencesStore()
    store.setByteOrder('be')
    store.setBitmapZoom(1)
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe(KEY)
  })

  it('reloads what was persisted on the next session', () => {
    const first = usePreferencesStore()
    first.setCodePage('petscii-lower')
    first.setSidebarWidth(275)
    first.setBitmapInvert(true)

    setActivePinia(createPinia())
    const next = usePreferencesStore()
    expect(next.codePage).toBe('petscii-lower')
    expect(next.sidebarWidth).toBe(275)
    expect(next.bitmapInvert).toBe(true)
  })
})

describe('preferences store — per-field validation on load (plan §2)', () => {
  it('falls a missing key back to its default, keeping the valid siblings', () => {
    const store = withStored({ byteOrder: 'be', bitmapWidth: 8 })
    expect(store.byteOrder).toBe('be')
    expect(store.bitmapWidth).toBe(8)
    // everything else was absent -> its default.
    expect(snapshot(store)).toEqual({ ...DEFAULTS, byteOrder: 'be', bitmapWidth: 8 })
  })

  it('falls every wrong-typed field back to its default', () => {
    const store = withStored({
      sidebarCollapsed: 'yes',
      sidebarWidth: '320',
      inspectorOpen: 1,
      bitmapOpen: null,
      searchResultsOpen: 'no',
      intHex: 'no',
      byteOrder: ['le'],
      codePage: 3,
      bitmapWidth: '4',
      bitmapStrideOffset: {},
      bitmapHeight: 'tall',
      bitmapZoom: 'big',
      bitmapInvert: 'false',
    })
    expect(snapshot(store)).toEqual(DEFAULTS)
  })

  it('falls an out-of-set value back to its default', () => {
    const store = withStored({ byteOrder: 'middle', codePage: 'utf-8' })
    expect(store.byteOrder).toBe('le')
    expect(store.codePage).toBe('ascii')
  })

  it('accepts every valid code-page value', () => {
    for (const codePage of CODE_PAGES) {
      expect(withStored({ codePage }).codePage).toBe(codePage)
    }
  })

  describe('sidebarWidth — finite number else 320', () => {
    it('keeps any finite number, integer or not, small or large', () => {
      expect(withStored({ sidebarWidth: 200 }).sidebarWidth).toBe(200)
      expect(withStored({ sidebarWidth: 512.5 }).sidebarWidth).toBe(512.5)
      expect(withStored({ sidebarWidth: 40 }).sidebarWidth).toBe(40)
    })

    it('falls a non-finite number back to 320', () => {
      expect(withStored({ sidebarWidth: Number.NaN }).sidebarWidth).toBe(320)
      expect(withStored({ sidebarWidth: Number.POSITIVE_INFINITY }).sidebarWidth).toBe(320)
      expect(withStored('{"sidebarWidth":null}').sidebarWidth).toBe(320)
    })
  })

  describe('bitmapWidth — integer >= 1 else 4', () => {
    it('keeps a positive integer', () => {
      expect(withStored({ bitmapWidth: 1 }).bitmapWidth).toBe(1)
      expect(withStored({ bitmapWidth: 240 }).bitmapWidth).toBe(240)
    })

    it('falls zero, a negative, or a fraction back to 4', () => {
      expect(withStored({ bitmapWidth: 0 }).bitmapWidth).toBe(4)
      expect(withStored({ bitmapWidth: -3 }).bitmapWidth).toBe(4)
      expect(withStored({ bitmapWidth: 1.5 }).bitmapWidth).toBe(4)
    })
  })

  describe('bitmapStrideOffset — integer >= 0, negatives clamp to 0', () => {
    it('keeps a non-negative integer', () => {
      expect(withStored({ bitmapStrideOffset: 0 }).bitmapStrideOffset).toBe(0)
      expect(withStored({ bitmapStrideOffset: 7 }).bitmapStrideOffset).toBe(7)
    })

    it('clamps a negative integer to 0', () => {
      expect(withStored({ bitmapStrideOffset: -1 }).bitmapStrideOffset).toBe(0)
      expect(withStored({ bitmapStrideOffset: -128 }).bitmapStrideOffset).toBe(0)
    })

    it('falls a fraction back to 0', () => {
      expect(withStored({ bitmapStrideOffset: 2.5 }).bitmapStrideOffset).toBe(0)
    })
  })

  describe('bitmapHeight — integer 32..4096 or null, default null', () => {
    it('keeps null and any integer within the band', () => {
      expect(withStored({ bitmapHeight: null }).bitmapHeight).toBeNull()
      expect(withStored({ bitmapHeight: 32 }).bitmapHeight).toBe(32)
      expect(withStored({ bitmapHeight: 4096 }).bitmapHeight).toBe(4096)
      expect(withStored({ bitmapHeight: 512 }).bitmapHeight).toBe(512)
    })

    it('falls an out-of-band or fractional value back to null', () => {
      expect(withStored({ bitmapHeight: 31 }).bitmapHeight).toBeNull()
      expect(withStored({ bitmapHeight: 4097 }).bitmapHeight).toBeNull()
      expect(withStored({ bitmapHeight: 100.5 }).bitmapHeight).toBeNull()
      expect(withStored({ bitmapHeight: 0 }).bitmapHeight).toBeNull()
    })
  })

  describe('bitmapZoom — integer 1..3 else 2', () => {
    it('keeps 1, 2 and 3', () => {
      expect(withStored({ bitmapZoom: 1 }).bitmapZoom).toBe(1)
      expect(withStored({ bitmapZoom: 2 }).bitmapZoom).toBe(2)
      expect(withStored({ bitmapZoom: 3 }).bitmapZoom).toBe(3)
    })

    it('falls 0, 4 or a fraction back to 2', () => {
      expect(withStored({ bitmapZoom: 0 }).bitmapZoom).toBe(2)
      expect(withStored({ bitmapZoom: 4 }).bitmapZoom).toBe(2)
      expect(withStored({ bitmapZoom: 2.5 }).bitmapZoom).toBe(2)
    })
  })

  it('drops unknown keys on the next write', () => {
    const store = withStored({ byteOrder: 'be', theme: 'dark', fontSize: 20 })
    expect(store.byteOrder).toBe('be')

    store.setSidebarCollapsed(true) // triggers persist()
    expect(readBack()).toEqual({ ...DEFAULTS, byteOrder: 'be', sidebarCollapsed: true })
    expect(readBack()).not.toHaveProperty('theme')
    expect(readBack()).not.toHaveProperty('fontSize')
  })
})

describe('preferences store — phase-1.5 keys are ignored and dropped (plan §3.4)', () => {
  it('loads a persisted { dock, collapsed } blob clean — both ignored', () => {
    const store = withStored({ dock: 'right', collapsed: true, byteOrder: 'be' })
    // dock is gone from the store entirely; collapsed does not feed sidebarCollapsed.
    expect(store).not.toHaveProperty('dock')
    expect(store.sidebarCollapsed).toBe(false)
    expect(store.byteOrder).toBe('be')
    expect(snapshot(store)).toEqual({ ...DEFAULTS, byteOrder: 'be' })
  })

  it('drops the dock / collapsed keys on the next write', () => {
    const store = withStored({ dock: 'right', collapsed: true })

    store.setSidebarWidth(400) // triggers persist()
    expect(readBack()).not.toHaveProperty('dock')
    expect(readBack()).not.toHaveProperty('collapsed')
    expect(readBack()).toEqual({ ...DEFAULTS, sidebarWidth: 400 })
  })
})

describe('preferences store — failure modes (plan §2)', () => {
  it('malformed JSON -> all defaults, overwritten by the next persist()', () => {
    const store = withStored('{ not json ]')
    expect(snapshot(store)).toEqual(DEFAULTS)

    store.setByteOrder('be')
    expect(readBack()).toEqual({ ...DEFAULTS, byteOrder: 'be' })
  })

  it('non-object JSON (an array, a bare number) -> all defaults', () => {
    expect(withStored('[1,2,3]').codePage).toBe('ascii')
    expect(withStored('42').sidebarWidth).toBe(320)
    expect(withStored('null').byteOrder).toBe('le')
  })

  it('localStorage throwing on read -> session-only defaults and one console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    setActivePinia(createPinia())
    const store = usePreferencesStore()

    expect(store.sidebarWidth).toBe(320)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('localStorage throwing on write -> session-only, one warn, refs stay authoritative', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = usePreferencesStore()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    store.setByteOrder('be')
    store.setBitmapZoom(3)

    expect(store.byteOrder).toBe('be') // in-memory refs still authoritative
    expect(store.bitmapZoom).toBe(3)
    expect(warn).toHaveBeenCalledTimes(1) // one warn, not one per rejected write
  })
})
