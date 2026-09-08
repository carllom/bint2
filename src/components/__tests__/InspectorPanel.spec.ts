import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { FileByteSource } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'
import HomeView from '@/views/HomeView.vue'

// The Inspector (#54, plan §3), asserted at the app-shell seam: HomeView mounted
// whole, a real file-backed source, every row's decode, the hex and byte-order
// toggles, the three empty states, row-value copy through `actionStatus`, dock
// and collapse with focus retention, and tab order.

let pinia: Pinia
let wrapper: VueWrapper | null = null

function mountApp(): VueWrapper {
  wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [pinia] } })
  return wrapper
}

function fileOf(bytes: number[], name = 'test.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

async function openBytes(bytes: number[], name = 'test.bin'): Promise<void> {
  useDocumentStore(pinia).open(new FileByteSource(fileOf(bytes, name)), name)
  await flushPromises()
}

/** Text of an Inspector row's value button, or `null` when the row is absent. */
function rowValue(app: VueWrapper, key: string): string | null {
  const el = app.find(`[data-field="inspector-${key}"]`)
  return el.exists() ? el.text() : null
}

const ASC = Array.from({ length: 64 }, (_u, i) => i)

/** A synthetic 2 GB source: `readSync` always misses, `read` generates on demand. */
class SyntheticByteSource implements ByteSource {
  readonly size = 2e9
  read(offset: number, length: number): Promise<Uint8Array> {
    const count = Math.max(0, Math.min(length, this.size - offset))
    return Promise.resolve(Uint8Array.from({ length: count }, (_u, i) => (offset + i) & 0xff))
  }
  readSync(): Uint8Array | null {
    return null
  }
  prefetch(): void {}
  close(): void {}
}

/** `readSync` misses; `read` stays pending until {@link DeferredSource.resolveAll}. */
class DeferredSource implements ByteSource {
  readonly size = 64
  #resolvers: (() => void)[] = []
  read(offset: number, length: number): Promise<Uint8Array> {
    const count = Math.max(0, Math.min(length, this.size - offset))
    return new Promise((resolve) => {
      this.#resolvers.push(() =>
        resolve(Uint8Array.from({ length: count }, (_u, i) => (offset + i) & 0xff)),
      )
    })
  }
  readSync(): Uint8Array | null {
    return null
  }
  prefetch(): void {}
  close(): void {}
  resolveAll(): void {
    const pending = this.#resolvers
    this.#resolvers = []
    for (const resolve of pending) resolve()
  }
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('the Inspector Panel — presence (plan §3.1)', () => {
  it('is hidden entirely when no document is open', () => {
    const app = mountApp()
    expect(app.find('[data-region="inspector"]').exists()).toBe(false)
  })

  it('appears the moment a document opens and names itself a region', async () => {
    const app = mountApp()
    await openBytes(ASC)

    const panel = app.find('[data-region="inspector"]')
    expect(panel.exists()).toBe(true)
    expect(panel.attributes('role')).toBe('region')
    expect(panel.attributes('aria-label')).toBe('Cursor inspector')
    // Nothing about it is a live region — the Viewport speaks the cursor (ADR-0005).
    expect(panel.attributes('aria-live')).toBeUndefined()
  })

  it('disappears again when the document is closed by opening a zero-byte-less state', async () => {
    const app = mountApp()
    await openBytes(ASC)
    expect(app.find('[data-region="inspector"]').exists()).toBe(true)

    useDocumentStore(pinia).$patch({ source: null })
    await flushPromises()
    expect(app.find('[data-region="inspector"]').exists()).toBe(false)
  })
})

describe('the Inspector Panel — decoding the bytes at the Cursor (plan §3.2)', () => {
  it('shows every row for a known window, little-endian by default', async () => {
    const app = mountApp()
    await openBytes(ASC) // bytes 0,1,2,3,4,5,6,7 at offset 0
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    expect(rowValue(app, 'u8')).toBe('0')
    expect(rowValue(app, 'i8')).toBe('0')
    expect(rowValue(app, 'bin')).toBe('00000000')
    expect(rowValue(app, 'u16')).toBe('256')
    expect(rowValue(app, 'i16')).toBe('256')
    expect(rowValue(app, 'u32')).toBe('50462976')
    expect(rowValue(app, 'i32')).toBe('50462976')
    expect(rowValue(app, 'u64')).toBe('506097522914230528')
    expect(rowValue(app, 'i64')).toBe('506097522914230528')
    expect(rowValue(app, 'f32')).toBe('3.820471434542632e-37')
    expect(rowValue(app, 'f64')).toBe('7.949928895127363e-275')
  })

  it('re-decodes as the Cursor moves', async () => {
    const app = mountApp()
    await openBytes(ASC)
    const store = useDocumentStore(pinia)

    store.setCursor(0)
    await flushPromises()
    expect(rowValue(app, 'u8')).toBe('0')

    store.setCursor(10)
    await flushPromises()
    expect(rowValue(app, 'u8')).toBe('10')
    expect(rowValue(app, 'u16')).toBe('2826') // 0x0B0A LE
  })
})

describe('the Inspector Panel — the hex toggle (plan §3.3)', () => {
  it('flips only the eight integer rows to the zero-padded raw pattern', async () => {
    const app = mountApp()
    await openBytes(ASC)
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    await app.find('[data-field="inspector-hex"]').trigger('click')

    expect(rowValue(app, 'u8')).toBe('00')
    expect(rowValue(app, 'i8')).toBe('00')
    expect(rowValue(app, 'u16')).toBe('0100')
    expect(rowValue(app, 'i16')).toBe('0100') // signed == unsigned in hex
    expect(rowValue(app, 'u32')).toBe('03020100')
    expect(rowValue(app, 'u64')).toBe('0706050403020100')
    // bin and the floats are untouched.
    expect(rowValue(app, 'bin')).toBe('00000000')
    expect(rowValue(app, 'f32')).toBe('3.820471434542632e-37')

    expect(app.find('[data-field="inspector-hex"]').attributes('aria-pressed')).toBe('true')
  })

  it('persists — a remount comes back in hex', async () => {
    const app = mountApp()
    await openBytes(ASC)
    await app.find('[data-field="inspector-hex"]').trigger('click')
    app.unmount()

    setActivePinia((pinia = createPinia()))
    const app2 = mountApp()
    await openBytes(ASC)
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    expect(rowValue(app2, 'u16')).toBe('0100')
  })
})

describe('the Inspector Panel — byte order (plan §3.2, §4.5)', () => {
  it('re-decodes the multi-byte rows on a flip and leaves u8 / i8 / bin fixed', async () => {
    const app = mountApp()
    await openBytes(ASC)
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    await flushPromises()
    expect(rowValue(app, 'u16')).toBe('256') // LE

    usePreferencesStore(pinia).setByteOrder('be')
    await flushPromises()

    expect(rowValue(app, 'u16')).toBe('1') // BE 0x0001
    expect(rowValue(app, 'u32')).toBe('66051') // BE 0x00010203
    expect(rowValue(app, 'u64')).toBe('283686952306183')
    // width-1 rows do not budge.
    expect(rowValue(app, 'u8')).toBe('0')
    expect(rowValue(app, 'i8')).toBe('0')
    expect(rowValue(app, 'bin')).toBe('00000000')
  })
})

describe('the Inspector Panel — the three empty states (plan §3.4)', () => {
  it('every value column is — before the reader has clicked a byte', async () => {
    const app = mountApp()
    await openBytes(ASC)

    for (const key of ['u8', 'i8', 'bin', 'u16', 'u32', 'u64', 'f32', 'f64']) {
      expect(rowValue(app, key)).toBe('—')
    }
  })

  it('shows ·· while bytes are pending, then repaints on arrival', async () => {
    const source = new DeferredSource()
    const app = mountApp()
    useDocumentStore(pinia).open(source, 'deferred.bin')
    await flushPromises()

    useDocumentStore(pinia).setCursor(4)
    await flushPromises()
    expect(rowValue(app, 'u8')).toBe('··')
    expect(rowValue(app, 'u32')).toBe('··')

    source.resolveAll()
    await flushPromises()
    expect(rowValue(app, 'u8')).toBe('4')
    expect(rowValue(app, 'u32')).toBe('117835012') // 0x07060504 LE
  })

  it('dims to — for a type wider than the bytes left at EOF, the narrow rows still decode', async () => {
    const app = mountApp()
    useDocumentStore(pinia).open(new SyntheticByteSource(), 'huge.bin')
    await flushPromises()

    useDocumentStore(pinia).setCursor(2e9 - 3) // 3 bytes remain
    await flushPromises()

    expect(rowValue(app, 'u8')).not.toBe('—')
    expect(rowValue(app, 'u16')).not.toBe('—')
    expect(rowValue(app, 'u32')).toBe('—')
    expect(rowValue(app, 'u64')).toBe('—')
    expect(rowValue(app, 'f64')).toBe('—')
  })
})

describe('the Inspector Panel — row-value copy (plan §3.6)', () => {
  it('copies the displayed text and reports success through the action region', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    await openBytes(ASC)
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    await flushPromises()

    await app.find('[data-field="inspector-u32"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledExactlyOnceWith('50462976')
    expect(store.actionStatus).toEqual({ ok: true, message: 'Copied u32 value' })
    expect(app.find('[data-field="action-live-region"]').text()).toBe('Copied u32 value')
  })

  it('copies the hex text when the hex toggle is on — the currently-displayed value', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    await openBytes(ASC)
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    await app.find('[data-field="inspector-hex"]').trigger('click')

    await app.find('[data-field="inspector-u32"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledExactlyOnceWith('03020100')
  })

  it('disables the value buttons showing — or ··', async () => {
    const app = mountApp()
    await openBytes(ASC)

    // No Cursor yet: every value button is —, and disabled.
    for (const key of ['u8', 'u16', 'u32', 'u64', 'f64']) {
      expect(app.find(`[data-field="inspector-${key}"]`).attributes('disabled')).toBeDefined()
    }

    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    // Now they carry values and are enabled.
    expect(app.find('[data-field="inspector-u32"]').attributes('disabled')).toBeUndefined()
  })
})

describe('the Inspector Panel — dock, collapse, tab order (plan §3.1, §3.7)', () => {
  it('flips the dock, persisting it and restyling the panel', async () => {
    const app = mountApp()
    await openBytes(ASC)
    expect(app.find('.app-shell').attributes('data-inspector-dock')).toBe('bottom')

    await app.find('[data-field="inspector-dock"]').trigger('click')

    expect(usePreferencesStore(pinia).dock).toBe('right')
    expect(app.find('.app-shell').attributes('data-inspector-dock')).toBe('right')
    expect(app.find('[data-region="inspector"]').classes()).toContain('inspector--right')
  })

  it('collapses to a bar and keeps focus on the toggle, then expands and restores it', async () => {
    const app = mountApp()
    await openBytes(ASC)

    await app.find('[data-field="inspector-collapse"]').trigger('click')
    await flushPromises()

    expect(usePreferencesStore(pinia).collapsed).toBe(true)
    const bar = app.find('[data-field="inspector-expand"]')
    expect(bar.exists()).toBe(true)
    expect(app.find('[data-field="inspector-u8"]').exists()).toBe(false) // rows gone
    expect(document.activeElement).toBe(bar.element)

    await bar.trigger('click')
    await flushPromises()
    expect(usePreferencesStore(pinia).collapsed).toBe(false)
    expect(document.activeElement).toBe(app.find('[data-field="inspector-collapse"]').element)
  })

  it('sits between the viewport and the status bar in DOM order, whatever the dock', async () => {
    const app = mountApp()
    await openBytes(ASC)

    const order = () => {
      const viewport = app.find('[data-region="viewport"]').element
      const inspector = app.find('[data-region="inspector"]').element
      const statusBar = app.find('[data-region="status-bar"]').element
      return (
        !!(viewport.compareDocumentPosition(inspector) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(inspector.compareDocumentPosition(statusBar) & Node.DOCUMENT_POSITION_FOLLOWING)
      )
    }
    expect(order()).toBe(true)

    await app.find('[data-field="inspector-dock"]').trigger('click') // -> right
    expect(order()).toBe(true)
  })
})
