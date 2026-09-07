import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { byteSourceFactoryKey } from '@/byteSourceFactory'
import type { ByteSource } from '@/core'
import { FileByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import HomeView from '@/views/HomeView.vue'

// The file-open reject policy (#21), exercised at the app-shell seam: HomeView
// mounted whole with the real file-backed source, driven through the hidden
// <input> and window drag-drop the way a reader would. No e2e — every branch is
// observable here (ADR-0004 "Consequences").

function fileOf(bytes: number[], name = 'test.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

/** Just enough of a drag's `dataTransfer` for the drop-zone paths under test. */
interface FakeDataTransferItem {
  kind: string
  webkitGetAsEntry?: () => FileSystemEntry
}
interface FakeDataTransfer {
  files?: File[]
  items?: FakeDataTransferItem[]
  types?: string[]
}

/** A `dataTransfer.items` entry — a file, or a directory when `isDirectory`. */
function entryItem(isDirectory: boolean): FakeDataTransferItem {
  return { kind: 'file', webkitGetAsEntry: () => ({ isDirectory }) as FileSystemEntry }
}

function drop(dataTransfer: FakeDataTransfer): void {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  window.dispatchEvent(event)
}

let pinia: Pinia
let wrapper: VueWrapper | null = null

function mountApp(factory?: (file: File) => ByteSource): VueWrapper {
  wrapper = mount(HomeView, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      ...(factory ? { provide: { [byteSourceFactoryKey as symbol]: factory } } : {}),
    },
  })
  return wrapper
}

async function pickFile(app: VueWrapper, ...files: File[]): Promise<void> {
  const input = app.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

function bytesText(app: VueWrapper): string[] {
  return app.findAll('.hex-row__byte').map((c) => c.text())
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('the file-open reject policy (#21)', () => {
  it('does nothing at all when the file picker is cancelled', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    // A cancelled picker fires `change` with no files in the browsers that fire
    // it at all — and must leave everything untouched.
    await pickFile(app) // no files

    expect(store.source).toBeNull()
    expect(store.fileName).toBeNull()
    expect(app.find('.file-drop-zone__refusal').exists()).toBe(false)
    expect(app.find('.hex-viewer__empty').exists()).toBe(true)
  })

  it('ignores a drop that is not a file — a text fragment, a link — silently', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    drop({ types: ['text/plain'], files: [], items: [{ kind: 'string' }] })
    await flushPromises()

    expect(store.source).toBeNull()
    expect(app.find('.file-drop-zone__refusal').exists()).toBe(false)
    expect(app.findAll('.hex-row')).toHaveLength(0)
  })

  it('opens the first of several dropped files, silently', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    drop({
      files: [fileOf([0x11, 0x22, 0x33], 'first.bin'), fileOf([0x99], 'second.bin')],
      items: [entryItem(false), entryItem(false)],
    })
    await flushPromises()

    expect(store.fileName).toBe('first.bin')
    expect(bytesText(app)).toEqual(['11', '22', '33'])
    expect(app.find('.file-drop-zone__refusal').exists()).toBe(false)
  })

  it('refuses a dropped directory with a message inline in the drop zone', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    // A directory arrives in `files` as a zero-byte, typeless entry; only the
    // filesystem entry distinguishes it from a real empty file.
    drop({ files: [new File([], 'my-folder')], items: [entryItem(true)] })
    await flushPromises()

    const refusal = app.find('.file-drop-zone__refusal')
    expect(refusal.exists()).toBe(true)
    expect(refusal.text()).toMatch(/folder|directory/i)
    // Visible, so it is announced (ADR-0005).
    expect(refusal.attributes('role')).toBe('alert')
    // It lives inside the drop zone in the toolbar — not in the banner region,
    // which stays the dead-source surface (ADR-0004: the two are deliberately
    // not unified). The banner itself lands in #26.
    expect(app.find('[data-region="toolbar"] .file-drop-zone__refusal').exists()).toBe(true)
    expect(app.find('[data-region="banner"] .file-drop-zone__refusal').exists()).toBe(false)

    expect(store.source).toBeNull()
    expect(store.fileName).toBeNull()
  })

  it('drops a stale directory refusal on the next drop, whatever that drop is', async () => {
    const app = mountApp()

    drop({ files: [new File([], 'my-folder')], items: [entryItem(true)] })
    await flushPromises()
    expect(app.find('.file-drop-zone__refusal').exists()).toBe(true)

    // A non-file drop changes nothing else — but the folder message described a
    // drag that is over, so it must not linger.
    drop({ types: ['text/uri-list'], files: [] })
    await flushPromises()
    expect(app.find('.file-drop-zone__refusal').exists()).toBe(false)
  })

  it('clears the directory refusal once a real file opens', async () => {
    const app = mountApp()

    drop({ files: [new File([], 'my-folder')], items: [entryItem(true)] })
    await flushPromises()
    expect(app.find('.file-drop-zone__refusal').exists()).toBe(true)

    drop({ files: [fileOf([0x4d, 0x5a], 'real.bin')], items: [entryItem(false)] })
    await flushPromises()

    expect(app.find('.file-drop-zone__refusal').exists()).toBe(false)
    expect(bytesText(app)).toEqual(['4D', '5A'])
  })

  it('opens a zero-byte file successfully and shows an empty grid', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    await pickFile(app, fileOf([], 'empty.bin'))

    expect(store.fileName).toBe('empty.bin')
    expect(store.fileSize).toBe(0)
    expect(app.find('.hex-viewer__empty').exists()).toBe(false) // opened, not "no file"
    expect(app.find('.hex-viewer__grid').exists()).toBe(true)
    expect(app.findAll('.hex-row')).toHaveLength(0)
  })

  it('opens a zero-byte file dropped onto the window', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    drop({ files: [new File([], 'empty.bin')], items: [entryItem(false)] })
    await flushPromises()

    expect(store.fileName).toBe('empty.bin')
    expect(app.find('.file-drop-zone__refusal').exists()).toBe(false)
    expect(app.findAll('.hex-row')).toHaveLength(0)
  })

  it('closes the first document and fully replaces the view when a second opens', async () => {
    const created: ByteSource[] = []
    const factory = (file: File): ByteSource => {
      const source = new FileByteSource(file)
      vi.spyOn(source, 'close')
      created.push(source)
      return source
    }
    const app = mountApp(factory)
    const store = useDocumentStore(pinia)

    drop({
      files: [fileOf(Array.from({ length: 16 }, () => 0xaa), 'a.bin')],
      items: [entryItem(false)],
    })
    await flushPromises()
    expect(bytesText(app).every((t) => t === 'AA')).toBe(true)

    drop({ files: [fileOf([0xbb, 0xbb, 0xbb], 'b.bin')], items: [entryItem(false)] })
    await flushPromises()

    expect(created).toHaveLength(2)
    expect(created[0]!.close).toHaveBeenCalled() // the first source is closed
    expect(store.fileName).toBe('b.bin')
    expect(store.fileSize).toBe(3)
    // No byte from a.bin survives into b.bin's view.
    expect(bytesText(app)).toEqual(['BB', 'BB', 'BB'])
  })
})
