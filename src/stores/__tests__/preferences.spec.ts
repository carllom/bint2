import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CODE_PAGES,
  PREFERENCES_STORAGE_KEY,
  usePreferencesStore,
  type Preferences,
} from '../preferences'

// The shared phase-1.5 seam (plan §2). Tests use the real happy-dom
// `localStorage` — no injected storage — cleared between cases, and create the
// store *after* seeding storage so the one-shot load sees it.

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

const DEFAULTS: Preferences = {
  collapsed: false,
  dock: 'bottom',
  intHex: false,
  byteOrder: 'le',
  codePage: 'ascii',
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
    const store = usePreferencesStore()
    expect({
      collapsed: store.collapsed,
      dock: store.dock,
      intHex: store.intHex,
      byteOrder: store.byteOrder,
      codePage: store.codePage,
    }).toEqual(DEFAULTS)
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

    store.setCollapsed(true)
    expect(store.collapsed).toBe(true)
    expect(readBack()).toEqual({ ...DEFAULTS, collapsed: true })

    store.setDock('right')
    expect(store.dock).toBe('right')
    expect(readBack()).toEqual({ ...DEFAULTS, collapsed: true, dock: 'right' })

    store.setIntHex(true)
    store.setByteOrder('be')
    store.setCodePage('cp437')
    expect(readBack()).toEqual({
      collapsed: true,
      dock: 'right',
      intHex: true,
      byteOrder: 'be',
      codePage: 'cp437',
    })
  })

  it('persists to exactly one localStorage key', () => {
    const store = usePreferencesStore()
    store.setByteOrder('be')
    store.setCodePage('cp437')
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe(KEY)
  })

  it('reloads what was persisted on the next session', () => {
    usePreferencesStore().setCodePage('petscii-lower')

    setActivePinia(createPinia())
    expect(usePreferencesStore().codePage).toBe('petscii-lower')
  })
})

describe('preferences store — per-field validation on load (plan §2)', () => {
  it('falls a missing key back to its default, keeping the valid siblings', () => {
    const store = withStored({ dock: 'right', byteOrder: 'be' })
    expect(store.dock).toBe('right')
    expect(store.byteOrder).toBe('be')
    // collapsed / intHex / codePage were absent -> their defaults.
    expect(store.collapsed).toBe(false)
    expect(store.intHex).toBe(false)
    expect(store.codePage).toBe('ascii')
  })

  it('falls a wrong-typed field back to its default', () => {
    const store = withStored({
      collapsed: 'yes',
      dock: 42,
      intHex: null,
      byteOrder: ['le'],
      codePage: 3,
    })
    expect({
      collapsed: store.collapsed,
      dock: store.dock,
      intHex: store.intHex,
      byteOrder: store.byteOrder,
      codePage: store.codePage,
    }).toEqual(DEFAULTS)
  })

  it('falls an out-of-set value back to its default', () => {
    const store = withStored({ dock: 'top', byteOrder: 'middle', codePage: 'utf-8' })
    expect(store.dock).toBe('bottom')
    expect(store.byteOrder).toBe('le')
    expect(store.codePage).toBe('ascii')
  })

  it('accepts every valid code-page value', () => {
    for (const codePage of CODE_PAGES) {
      const store = withStored({ codePage })
      expect(store.codePage).toBe(codePage)
    }
  })

  it('drops unknown keys on the next write', () => {
    const store = withStored({ dock: 'right', theme: 'dark', fontSize: 20 })
    expect(store.dock).toBe('right')

    store.setCollapsed(true) // triggers persist()
    expect(readBack()).toEqual({ ...DEFAULTS, dock: 'right', collapsed: true })
    expect(readBack()).not.toHaveProperty('theme')
  })
})

describe('preferences store — failure modes (plan §2)', () => {
  it('malformed JSON -> all defaults, overwritten by the next persist()', () => {
    const store = withStored('{ not json ]')
    expect({
      collapsed: store.collapsed,
      dock: store.dock,
      intHex: store.intHex,
      byteOrder: store.byteOrder,
      codePage: store.codePage,
    }).toEqual(DEFAULTS)

    store.setDock('right')
    expect(readBack()).toEqual({ ...DEFAULTS, dock: 'right' })
  })

  it('non-object JSON (an array, a bare number) -> all defaults', () => {
    expect(withStored('[1,2,3]').codePage).toBe('ascii')
    expect(withStored('42').dock).toBe('bottom')
    expect(withStored('null').byteOrder).toBe('le')
  })

  it('localStorage throwing on read -> session-only defaults and one console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    setActivePinia(createPinia())
    const store = usePreferencesStore()

    expect(store.dock).toBe('bottom')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('localStorage throwing on write -> session-only, one warn, refs stay authoritative', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = usePreferencesStore()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    store.setByteOrder('be')
    store.setCodePage('akai')

    expect(store.byteOrder).toBe('be') // in-memory refs still authoritative
    expect(store.codePage).toBe('akai')
    expect(warn).toHaveBeenCalledTimes(1) // one warn, not one per rejected write
  })
})
