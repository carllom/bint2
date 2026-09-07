import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { FileByteSource, toByteSize } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import HomeView from '@/views/HomeView.vue'

// The status bar is asserted here, at the app-shell seam (plan §11): HomeView
// mounted whole, a real file-backed source over a real `File`, every field and
// the appear/disappear rule for the Selection fields.

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

/** Text of a single status-bar field, or `null` when the field is absent. */
function field(app: VueWrapper, name: string): string | null {
  const el = app.find(`[data-field="${name}"]`)
  return el.exists() ? el.text() : null
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('the status bar (#23)', () => {
  it('shows nothing until a document is open', () => {
    const app = mountApp()
    expect(app.find('.status-bar').exists()).toBe(false)
    expect(app.findAll('[data-field]')).toHaveLength(0)
  })

  it('always shows the file name and total size while a document is open', async () => {
    const app = mountApp()
    await openBytes(
      Array.from({ length: 300 }, (_u, i) => i & 0xff),
      'sample.bin',
    )

    expect(field(app, 'file-name')).toBe('sample.bin')
    const size = field(app, 'file-size')!
    expect(size).toContain('300 bytes') // the exact count
    expect(size).toContain(toByteSize(300)) // and the human-readable companion
  })

  it('is present with the identity fields even before the reader points at a byte', async () => {
    const app = mountApp()
    await openBytes([1, 2, 3, 4])

    expect(app.find('.status-bar').exists()).toBe(true)
    expect(field(app, 'file-name')).toBe('test.bin')
    // No Cursor yet — no offset, no byte fields.
    expect(field(app, 'cursor-offset')).toBeNull()
    expect(field(app, 'byte-unsigned')).toBeNull()
  })

  it('shows the Cursor offset in both hex and decimal', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 64 }, (_u, i) => i))

    useDocumentStore(pinia).setCursor(0x1f)
    await flushPromises()

    const offset = field(app, 'cursor-offset')!
    expect(offset).toContain('0x1F')
    expect(offset).toContain('31')
  })

  it('shows the byte under the Cursor as unsigned, signed and binary', async () => {
    const app = mountApp()
    const bytes = Array.from({ length: 16 }, () => 0)
    bytes[3] = 0x4d
    bytes[5] = 0x80
    await openBytes(bytes)
    const store = useDocumentStore(pinia)

    store.setCursor(3)
    await flushPromises()
    expect(field(app, 'byte-unsigned')).toBe('77')
    expect(field(app, 'byte-signed')).toBe('77')
    expect(field(app, 'byte-binary')).toBe('01001101')

    // 0x80: unsigned 128, signed -128, all-or-nothing top bit.
    store.setCursor(5)
    await flushPromises()
    expect(field(app, 'byte-unsigned')).toBe('128')
    expect(field(app, 'byte-signed')).toBe('-128')
    expect(field(app, 'byte-binary')).toBe('10000000')
  })

  it('shows Selection start, end and length exactly when the Selection spans bytes', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 64 }, (_u, i) => i))
    const store = useDocumentStore(pinia)

    // A bare Cursor — no Selection extent.
    store.setCursor(4)
    await flushPromises()
    expect(field(app, 'selection-start')).toBeNull()
    expect(field(app, 'selection-end')).toBeNull()
    expect(field(app, 'selection-length')).toBeNull()

    // Extend it to a real range: anchor 4, focus 9 -> [4, 10), length 6.
    store.extendSelectionTo(9)
    await flushPromises()
    expect(field(app, 'selection-start')).toBe('0x04')
    expect(field(app, 'selection-end')).toBe('0x0A')
    expect(field(app, 'selection-length')).toBe('6 B')
    // The byte fields track the focus end of the range.
    expect(field(app, 'byte-unsigned')).toBe('9')
  })

  it('drops the Selection fields again when the range collapses back to a Cursor', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 64 }, (_u, i) => i))
    const store = useDocumentStore(pinia)

    store.setCursor(4)
    store.extendSelectionTo(20)
    await flushPromises()
    expect(field(app, 'selection-length')).toBe('17 B')

    store.setCursor(8) // a plain click collapses the Selection
    await flushPromises()
    expect(field(app, 'selection-start')).toBeNull()
    expect(field(app, 'selection-length')).toBeNull()
    expect(field(app, 'cursor-offset')).toContain('0x08')
  })

  it('clears when the document is closed by opening another', async () => {
    const app = mountApp()
    await openBytes([1, 2, 3, 4], 'first.bin')
    useDocumentStore(pinia).setCursor(2)
    await flushPromises()
    expect(field(app, 'cursor-offset')).not.toBeNull()

    await openBytes([9, 9, 9, 9, 9, 9], 'second.bin')
    expect(field(app, 'file-name')).toBe('second.bin')
    // The Selection does not survive the close (ADR-0003).
    expect(field(app, 'cursor-offset')).toBeNull()
    expect(field(app, 'byte-unsigned')).toBeNull()
  })

  it('placeholders the byte fields until the point read resolves, then fills them in', async () => {
    // A source whose bytes are never a synchronous cache hit — `readSync` always
    // misses, so the status bar must fall back to the async point read.
    let resolveRead: (() => void) | null = null
    const source: ByteSource = {
      size: 64,
      read: (_offset, length) =>
        new Promise((resolve) => {
          resolveRead = () => resolve(new Uint8Array(length).fill(0xff))
        }),
      readSync: () => null,
      prefetch: () => {},
      close: () => {},
    }
    const app = mountApp()
    useDocumentStore(pinia).open(source, 'deferred.bin')
    await flushPromises()

    useDocumentStore(pinia).setCursor(10)
    await flushPromises()
    expect(field(app, 'byte-unsigned')).toBe('··')
    expect(field(app, 'byte-binary')).toBe('········')

    resolveRead!()
    await flushPromises()
    expect(field(app, 'byte-unsigned')).toBe('255')
    expect(field(app, 'byte-signed')).toBe('-1')
    expect(field(app, 'byte-binary')).toBe('11111111')
  })

  it('shows the last copy outcome, and marks a refusal, without being a live region (#25)', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 64 }, (_u, i) => i))
    const store = useDocumentStore(pinia)

    // Nothing shown until a copy happens.
    expect(field(app, 'copy-status')).toBeNull()

    store.copyStatus = { ok: true, message: 'Copied 4 bytes to the clipboard as hex.' }
    await flushPromises()
    let shown = app.find('[data-field="copy-status"]')
    expect(shown.text()).toBe('Copied 4 bytes to the clipboard as hex.')
    expect(shown.classes()).not.toContain('status-bar__copy--refused')
    // Still not a live region — the spoken form is #28's separate action region.
    expect(shown.attributes('aria-live')).toBeUndefined()
    expect(shown.attributes('role')).toBeUndefined()

    store.copyStatus = { ok: false, message: 'Selection is 9.0 MiB … Nothing was copied.' }
    await flushPromises()
    shown = app.find('[data-field="copy-status"]')
    expect(shown.text()).toContain('Nothing was copied.')
    expect(shown.classes()).toContain('status-bar__copy--refused')
  })

  it('is not a live region — the packed bar is never spoken as a whole (ADR-0005)', async () => {
    const app = mountApp()
    await openBytes([1, 2, 3, 4])

    const footer = app.find('[data-region="status-bar"]')
    expect(footer.attributes('aria-live')).toBeUndefined()
    expect(footer.attributes('role')).toBeUndefined()
    expect(app.find('.status-bar').attributes('aria-live')).toBeUndefined()
    expect(app.find('.status-bar').attributes('role')).toBeUndefined()
  })
})
