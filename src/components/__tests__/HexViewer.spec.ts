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

function fileOf(bytes: number[] | Uint8Array, name = 'test.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

/** A source whose reads stay pending until {@link resolveAll}. */
class DeferredSource implements ByteSource {
  readonly size: number
  readonly #fill: number
  #resolvers: (() => void)[] = []
  #closed = false

  constructor(size: number, fill: number) {
    this.size = size
    this.#fill = fill
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    const count = Math.max(0, Math.min(length, this.size - offset))
    return new Promise((resolve, reject) => {
      this.#resolvers.push(() =>
        this.#closed
          ? reject(new Error('source-closed'))
          : resolve(new Uint8Array(count).fill(this.#fill)),
      )
    })
  }

  readSync(): Uint8Array | null {
    return null
  }

  prefetch(): void {}

  close(): void {
    this.#closed = true
  }

  resolveAll(): void {
    const pending = this.#resolvers
    this.#resolvers = []
    for (const resolve of pending) {
      resolve()
    }
  }
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

function bytesText(root: VueWrapper, selector = '.hex-row__byte'): string[] {
  return root.findAll(selector).map((node) => node.text())
}

async function pickFile(root: VueWrapper, file: File): Promise<void> {
  const input = root.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('the app shell, mounted whole', () => {
  it('renders address, hex and ascii for an opened file', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    store.open(new FileByteSource(fileOf(Array.from({ length: 64 }, (_u, i) => i))), 'test.bin')
    await flushPromises()

    const rows = app.findAll('.hex-row')
    expect(rows).toHaveLength(4) // 64 bytes / 16
    expect(rows[0]!.get('.hex-row__addr').text()).toBe('00000000')
    expect(rows[1]!.get('.hex-row__addr').text()).toBe('00000010')
    expect(rows[0]!.findAll('.hex-row__byte').map((c) => c.text())).toEqual([
      '00', '01', '02', '03', '04', '05', '06', '07',
      '08', '09', '0A', '0B', '0C', '0D', '0E', '0F',
    ])
    // Bytes 0x00–0x0F are all control characters.
    expect(rows[0]!.get('.hex-row__ascii').element.textContent).toBe('.'.repeat(16))
    // Bytes 0x20–0x2F are printable — `.textContent`, not `.text()`, which trims
    // the leading space (byte 0x20).
    expect(rows[2]!.get('.hex-row__ascii').element.textContent).toBe(' !"#$%&\'()*+,-./')
  })

  it('opens a file picked through the hidden input', async () => {
    const app = mountApp()

    await pickFile(app, fileOf([0x4d, 0x5a, 0x90, 0x00]))

    const row = app.get('.hex-row')
    expect(row.get('.hex-row__addr').text()).toBe('00000000')
    expect(row.findAll('.hex-row__byte').map((c) => c.text())).toEqual(['4D', '5A', '90', '00'])
    expect(row.get('.hex-row__ascii').text()).toBe('MZ..')
  })

  it('opens a file dropped onto the window', async () => {
    const app = mountApp()

    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [fileOf([0, 1, 2])] } })
    window.dispatchEvent(event)
    await flushPromises()

    expect(app.findAll('.hex-row')).toHaveLength(1)
    expect(app.get('.hex-row__addr').text()).toBe('00000000')
    expect(bytesText(app)).toEqual(['00', '01', '02'])
  })

  it('turns opened files into sources via the injected factory', async () => {
    const seen: File[] = []
    const factory = vi.fn((file: File) => {
      seen.push(file)
      return new FileByteSource(file)
    })
    const app = mountApp(factory)
    const file = fileOf([1, 2, 3])

    await pickFile(app, file)

    expect(factory).toHaveBeenCalledOnce()
    expect(seen[0]).toBe(file)
  })

  it('shows ·· placeholders until reads resolve, then paints', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    store.open(new FileByteSource(fileOf([0xaa, 0xbb, 0xcc, 0xdd])), 'p.bin')
    await app.vm.$nextTick()

    const row = app.get('.hex-row')
    expect(row.classes()).toContain('hex-row--pending')
    expect(row.get('.hex-row__byte').text()).toBe('··')

    await flushPromises()
    expect(app.get('.hex-row').classes()).not.toContain('hex-row--pending')
    expect(bytesText(app)).toEqual(['AA', 'BB', 'CC', 'DD'])
  })

  it('renders a short last row when the file ends on screen', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    store.open(new FileByteSource(fileOf(Array.from({ length: 40 }, (_u, i) => i))), '40.bin')
    await flushPromises()

    const rows = app.findAll('.hex-row')
    expect(rows).toHaveLength(3) // ceil(40 / 16)
    expect(rows[2]!.findAll('.hex-row__byte').map((c) => c.text())).toEqual([
      '20', '21', '22', '23', '24', '25', '26', '27',
    ])
  })

  it('opens a zero-byte file and shows an empty grid', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    store.open(new FileByteSource(fileOf([])), 'empty.bin')
    await flushPromises()

    expect(app.findAll('.hex-row')).toHaveLength(0)
    expect(app.find('.hex-viewer__empty').exists()).toBe(false) // opened, not "no file"
    expect(app.find('.hex-viewer__grid').exists()).toBe(true)
  })

  it('drops reads left over from a previously open document', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    const first = new DeferredSource(16, 0xaa)
    const second = new DeferredSource(16, 0xbb)

    store.open(first, 'a.bin')
    await app.vm.$nextTick()
    store.open(second, 'b.bin')
    await app.vm.$nextTick()

    first.resolveAll() // stale — must be ignored
    second.resolveAll()
    await flushPromises()

    const cells = bytesText(app)
    expect(cells).toHaveLength(16)
    expect(cells.every((text) => text === 'BB')).toBe(true)
  })

  it('shows the empty-state hint before any file is opened', () => {
    const app = mountApp()
    expect(app.find('.hex-viewer__empty').exists()).toBe(true)
    expect(app.findAll('.hex-row')).toHaveLength(0)
  })
})
