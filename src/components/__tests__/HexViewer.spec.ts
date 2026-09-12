import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { byteSourceFactoryKey } from '@/byteSourceFactory'
import type {
  ByteSource,
  DerivedWorkResponseMessage,
  DerivedWorkWorkerLike,
  SearchParams,
} from '@/core'
import { ByteSourceError, DerivedWorkClient, FileByteSource, toAddress } from '@/core'
import { derivedWorkClientFactoryKey } from '@/derivedWorkClientFactory'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'
import HomeView from '@/views/HomeView.vue'

function fileOf(bytes: number[] | Uint8Array, name = 'test.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

/**
 * `defaultDerivedWorkClientFactory` spins up a real `Worker`, which happy-dom
 * does not implement (`derivedWorkClientFactory.spec.ts`). None of this
 * file's cases but the Find suite (#103) below exercise Search, so `mountApp`
 * always substitutes this inert factory unless a test injects its own.
 */
class NoopWorker implements DerivedWorkWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage(): void {}
  terminate(): void {}
}
const noopDerivedWorkClientFactory = (file: File): DerivedWorkClient =>
  new DerivedWorkClient(file, { createWorker: () => new NoopWorker() })

/**
 * A source that reports a 2 GB size and generates bytes on demand — byte `i`
 * holds `i & 0xff`. It never allocates anything near the whole document, and it
 * records every read so a test can prove no code path asks for more than a
 * screenful (plan §11 "synthetic" substitution).
 */
class SyntheticByteSource implements ByteSource {
  readonly size: number
  readonly reads: { offset: number; length: number }[] = []

  constructor(size = 2e9) {
    this.size = size
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    const count = Math.max(0, Math.min(length, this.size - offset))
    this.reads.push({ offset, length: count })
    const bytes = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      bytes[i] = (offset + i) & 0xff
    }
    return Promise.resolve(bytes)
  }

  readSync(): Uint8Array | null {
    return null
  }

  prefetch(): void {}

  close(): void {}

  get maxReadLength(): number {
    return this.reads.reduce((max, r) => Math.max(max, r.length), 0)
  }

  get bytesRead(): number {
    return this.reads.reduce((sum, r) => sum + r.length, 0)
  }
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

function mountApp(
  factory?: (file: File) => ByteSource,
  derivedWorkFactory?: (file: File) => DerivedWorkClient,
): VueWrapper {
  wrapper = mount(HomeView, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
      provide: {
        ...(factory ? { [byteSourceFactoryKey as symbol]: factory } : {}),
        [derivedWorkClientFactoryKey as symbol]: derivedWorkFactory ?? noopDerivedWorkClientFactory,
      },
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
  vi.restoreAllMocks()
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
      '00',
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '0A',
      '0B',
      '0C',
      '0D',
      '0E',
      '0F',
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
      '20',
      '21',
      '22',
      '23',
      '24',
      '25',
      '26',
      '27',
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

// In happy-dom nothing has layout, so the probe measures 0 and the Viewport
// keeps its pre-measurement fallbacks: rowPx 18, viewportPx 720 -> 40 whole rows
// visible, 41 rendered. rowCount for 2 GB / 16 bpr is 125_000_000, so
// maxFirstRow is 125_000_000 - 40 = 124_999_960.
const ROWS_RENDERED = 41
const MAX_FIRST_ROW = 125_000_000 - 40
const LAST_TOP_OFFSET = MAX_FIRST_ROW * 16 // 1_999_999_360

async function openSynthetic(app: VueWrapper, source: SyntheticByteSource): Promise<void> {
  useDocumentStore(pinia).open(source, 'huge.bin')
  await flushPromises()
}

/** Rows actually on screen — the recycled pool hides its surplus by attribute. */
function visibleRows(app: VueWrapper): number {
  return app.findAll('.hex-row').filter((row) => !(row.element as HTMLElement).hidden).length
}

/** Force an element's measured height (happy-dom has no layout). */
function stubHeight(app: VueWrapper, selector: string, height: number): void {
  Object.defineProperty(app.find(selector).element, 'getBoundingClientRect', {
    value: () => ({
      height,
      width: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() {},
    }),
    configurable: true,
  })
}

describe('scrolling the whole document', () => {
  it('scrolls the view by rows on the mouse wheel', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    const area = app.find('.hex-viewer__row-area')

    await area.trigger('wheel', { deltaY: 3, deltaMode: 1 }) // 3 lines
    expect(store.topByteOffset).toBe(48)
    expect(app.get('.hex-row__addr').text()).toBe(toAddress(48, 8))

    await area.trigger('wheel', { deltaY: 2, deltaMode: 1 })
    expect(store.topByteOffset).toBe(80)

    await area.trigger('wheel', { deltaY: -5, deltaMode: 1 })
    expect(store.topByteOffset).toBe(0)

    // Wheeling up past the top clamps rather than going negative.
    await area.trigger('wheel', { deltaY: -3, deltaMode: 1 })
    expect(store.topByteOffset).toBe(0)

    expect(visibleRows(app)).toBe(ROWS_RENDERED)
  })

  it('converts pixel wheel deltas to rows using the row height', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    // 18 px rows (the fallback) -> 54 px is 3 rows.
    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 54, deltaMode: 0 })
    expect(store.topByteOffset).toBe(48)
  })

  it('drags the thumb to jump across gigabytes and back', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    const source = new SyntheticByteSource()
    await openSynthetic(app, source)

    // Grab past the bottom of the track: the view lands on the final screen.
    await app.find('.virtual-scrollbar').trigger('pointerdown', { clientY: 100_000, pointerId: 1 })
    await flushPromises()

    expect(store.topByteOffset).toBe(LAST_TOP_OFFSET)
    expect(app.get('.hex-row__addr').text()).toBe(toAddress(LAST_TOP_OFFSET, 8))
    // Byte i holds (offset + i) & 0xff; LAST_TOP_OFFSET & 0xff === 0x80.
    expect(app.get('.hex-row__byte').text()).toBe('80')
    // The final screen is short — only the rows that remain.
    expect(visibleRows(app)).toBe(125_000_000 - MAX_FIRST_ROW)

    // Grab above the track: back to the top.
    await app.find('.virtual-scrollbar').trigger('pointerdown', { clientY: -9_999, pointerId: 1 })
    await flushPromises()
    expect(store.topByteOffset).toBe(0)
  })

  it('keeps the thumb grabbable at 2 GB rather than shrinking to nothing', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    const thumb = app.find('.virtual-scrollbar__thumb').element as HTMLElement
    // minThumbPx is 24 (ADR-0006); the true visible fraction here is sub-pixel.
    expect(thumb.style.height).toBe('24px')
  })

  it('never asks the source for more than a screenful — nothing allocates the whole file', async () => {
    const app = mountApp()
    const source = new SyntheticByteSource()
    await openSynthetic(app, source)

    const area = app.find('.hex-viewer__row-area')
    for (let i = 0; i < 20; i++) {
      await area.trigger('wheel', { deltaY: 500, deltaMode: 1 })
    }
    await app.find('.virtual-scrollbar').trigger('pointerdown', { clientY: 50_000, pointerId: 1 })
    await flushPromises()

    expect(source.reads.length).toBeGreaterThan(0)
    expect(source.maxReadLength).toBeLessThanOrEqual(16) // one row's bytes, never more
    expect(source.reads.every((r) => r.offset + r.length <= source.size)).toBe(true)
    // Total bytes ever fetched is a few screenfuls, nowhere near 2e9.
    expect(source.bytesRead).toBeLessThan(1_000_000)
  })

  it('repaints a scroll back over visited bytes from the page cache — no ·· flash (#20)', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    // Three 64 KiB pages, so scrolling forward faults pages the reader then
    // returns to.
    const raw = new Uint8Array(192 * 1024)
    for (let i = 0; i < raw.length; i++) raw[i] = i & 0xff
    const source = new FileByteSource(new File([raw], 'big.bin'))
    const readSpy = vi.spyOn(source, 'read')

    store.open(source, 'big.bin')
    await flushPromises()
    expect(app.findAll('.hex-row--pending')).toHaveLength(0)

    const area = app.find('.hex-viewer__row-area')
    await area.trigger('wheel', { deltaY: 5000, deltaMode: 1 }) // into page 1
    await flushPromises()
    await area.trigger('wheel', { deltaY: 4000, deltaMode: 1 }) // into page 2
    await flushPromises()
    expect(store.topByteOffset).toBe(9000 * 16)
    expect(app.findAll('.hex-row--pending')).toHaveLength(0)

    readSpy.mockClear()
    await area.trigger('wheel', { deltaY: -9000, deltaMode: 1 }) // all the way back
    await flushPromises()

    // Page 0 is still resident, so the rows paint straight from `readSync` with
    // no placeholder and without another async read.
    expect(store.topByteOffset).toBe(0)
    expect(app.findAll('.hex-row--pending')).toHaveLength(0)
    expect(bytesText(app).slice(0, 4)).toEqual(['00', '01', '02', '03'])
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('repaints when the row area resizes', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())
    expect(visibleRows(app)).toBe(ROWS_RENDERED)

    stubHeight(app, '.hex-viewer__probe', 10)
    stubHeight(app, '.hex-viewer__row-area', 100)
    window.dispatchEvent(new Event('resize'))
    await flushPromises()

    // 100 px / 10 px rows -> 10 whole rows visible, 11 rendered.
    expect(visibleRows(app)).toBe(11)
  })

  it('pulls a near-EOF view back through the choke point when the viewport grows', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await app.find('.virtual-scrollbar').trigger('pointerdown', { clientY: 100_000, pointerId: 1 })
    await flushPromises()
    expect(store.topByteOffset).toBe(LAST_TOP_OFFSET) // 40 rows fit

    // Window maximised: the row area doubles, so more rows fit and the last
    // valid top is lower. The old top must not leave a blank strip below.
    stubHeight(app, '.hex-viewer__row-area', 18 * 80)
    window.dispatchEvent(new Event('resize'))
    await flushPromises()

    expect(store.topByteOffset).toBe((125_000_000 - 80) * 16)
    expect(visibleRows(app)).toBe(80)
  })
})

describe('reshaping the grid with bytes-per-row presets (#19)', () => {
  /** Byte-cell counts of every rendered (non-hidden) row. */
  function rowWidths(app: VueWrapper): number[] {
    return app
      .findAll('.hex-row')
      .filter((row) => !(row.element as HTMLElement).hidden)
      .map((row) => row.findAll('.hex-row__byte').length)
  }

  async function choosePreset(app: VueWrapper, preset: number): Promise<void> {
    await app.find(`input[name="bytes-per-row"][value="${preset}"]`).trigger('change')
    await flushPromises()
  }

  it('preserves the byte offset — aligned down, not the row index — on a change', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    // Row 5 at 16 bpr — byte offset 80.
    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 5, deltaMode: 1 })
    expect(store.topByteOffset).toBe(80)

    await choosePreset(app, 24)

    // 80 aligned down to a 24-byte row boundary is 72 — the byte, kept as
    // closely as a row allows; the row index (was 5, now 3) is not.
    expect(store.topByteOffset).toBe(72)
    expect(app.get('.hex-row__addr').text()).toBe(toAddress(72, 8))
  })

  it('repaints the grid and the ASCII pane with the new column count', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    expect(rowWidths(app).every((w) => w === 16)).toBe(true)
    expect(app.findAll('.hex-row').at(0)!.findAll('.hex-row__char')).toHaveLength(16)

    await choosePreset(app, 32)
    expect(rowWidths(app).every((w) => w === 32)).toBe(true)
    expect(app.findAll('.hex-row').at(0)!.findAll('.hex-row__char')).toHaveLength(32)

    await choosePreset(app, 8)
    expect(rowWidths(app).every((w) => w === 8)).toBe(true)
    expect(app.findAll('.hex-row').at(0)!.findAll('.hex-row__char')).toHaveLength(8)
  })

  it('ratchets the offset down by at most bytesPerRow - 1 each change, not a lossless round-trip', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 5, deltaMode: 1 })
    expect(store.topByteOffset).toBe(80)

    await choosePreset(app, 24)
    expect(store.topByteOffset).toBe(72) // lost 8, within 24 - 1

    await choosePreset(app, 16)
    expect(store.topByteOffset).toBe(64) // lost 8, within 16 - 1

    // 16 -> 24 -> 16 landed at 64, not back at 80. The ratchet is pinned, not
    // asserted away (ADR-0006).
    expect(store.topByteOffset).toBeLessThan(80)
  })

  it('is the only lever — the grid does not reshape when the row area resizes', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    stubHeight(app, '.hex-viewer__probe', 9)
    stubHeight(app, '.hex-viewer__row-area', 400)
    window.dispatchEvent(new Event('resize'))
    await flushPromises()

    expect(store.bytesPerRow).toBe(16)
    expect(rowWidths(app).every((w) => w === 16)).toBe(true)
  })
})

// --- Cursor and Selection (#22, ADR-0003) -----------------------------------

/**
 * Lay every rendered byte out as a 10 px box so `byteAtPoint` resolves — happy-dom
 * has no layout. Hex-pane byte `o` sits at x = `o*10 .. o*10+10`; the ASCII
 * paint of the same byte sits 10000 px to the right. Reads `data-offset` live, so
 * it survives the recycled pool being repainted.
 */
function stubCellBoxes(app: VueWrapper): void {
  for (const cell of app.findAll('.hex-viewer__grid [data-offset]')) {
    const el = cell.element as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const offset = Number(el.dataset.offset)
        const pane = el.classList.contains('hex-row__byte') ? 0 : 1
        const left = pane * 10_000 + offset * 10
        return {
          left,
          right: left + 10,
          top: 0,
          bottom: 10,
          width: 10,
          height: 10,
          x: left,
          y: 0,
          toJSON() {},
        }
      },
    })
  }
}

/** Client x/y of the middle of hex-pane byte `offset`'s box. */
function hexPoint(offset: number): { clientX: number; clientY: number } {
  return { clientX: offset * 10 + 5, clientY: 5 }
}

/** Client x/y of the middle of the ASCII paint of byte `offset`. */
function asciiPoint(offset: number): { clientX: number; clientY: number } {
  return { clientX: 10_000 + offset * 10 + 5, clientY: 5 }
}

/** Absolute offsets of every `--selected` cell in the hex pane. */
function selectedHexOffsets(app: VueWrapper): number[] {
  return app
    .findAll('.hex-row__byte--selected')
    .map((c) => Number((c.element as HTMLElement).dataset.offset))
}

async function openFile(app: VueWrapper, bytes: number[]): Promise<void> {
  useDocumentStore(pinia).open(new FileByteSource(fileOf(bytes)), 'sel.bin')
  await flushPromises()
  stubCellBoxes(app)
}

describe('the Cursor: one byte, pointed at or walked to (#22)', () => {
  it('a plain click puts the Cursor on a byte, marked in both panes', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )

    await app.find('.hex-viewer__row-area').trigger('pointerdown', { button: 0, ...hexPoint(3) })

    expect(store.selection).toEqual({ anchor: 3, focus: 3 })
    expect(app.findAll('.hex-row__byte--cursor')).toHaveLength(1)
    expect(app.get('.hex-row__byte--cursor').attributes('data-offset')).toBe('3')
    expect(app.get('.hex-row__char--cursor').attributes('data-offset')).toBe('3')
    // A collapsed Selection fills nothing.
    expect(app.findAll('.hex-row__byte--selected')).toHaveLength(0)
  })

  it('clicking the ASCII pane targets the same underlying byte', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )

    await app.find('.hex-viewer__row-area').trigger('pointerdown', { button: 0, ...asciiPoint(5) })

    expect(store.selection).toEqual({ anchor: 5, focus: 5 })
    expect(app.get('.hex-row__byte--cursor').attributes('data-offset')).toBe('5')
  })

  it('ignores a press that lands on no rendered byte', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(app, [1, 2, 3, 4])

    await app
      .find('.hex-viewer__row-area')
      .trigger('pointerdown', { button: 0, clientX: 5_000, clientY: 5_000 })

    expect(store.selection).toBeNull()
  })

  it('the first cursor key reveals the Cursor on the first visible byte without skipping', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())
    // Scroll so the top of the view is not offset 0.
    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 5, deltaMode: 1 })
    expect(store.topByteOffset).toBe(80)
    expect(store.selection).toBeNull()

    await app.find('.hex-viewer__row-area').trigger('keydown', { key: 'ArrowRight' })
    // Lands on the first visible byte, not one past it.
    expect(store.selection).toEqual({ anchor: 80, focus: 80 })

    await app.find('.hex-viewer__row-area').trigger('keydown', { key: 'ArrowRight' })
    expect(store.selection).toEqual({ anchor: 81, focus: 81 })
  })

  it('arrow keys walk the Cursor by byte and by row', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    store.setCursor(20)
    await area.trigger('keydown', { key: 'ArrowRight' })
    expect(store.selection).toEqual({ anchor: 21, focus: 21 })
    await area.trigger('keydown', { key: 'ArrowLeft' })
    await area.trigger('keydown', { key: 'ArrowLeft' })
    expect(store.selection).toEqual({ anchor: 19, focus: 19 })
    await area.trigger('keydown', { key: 'ArrowDown' })
    expect(store.selection).toEqual({ anchor: 35, focus: 35 }) // +bytesPerRow
    await area.trigger('keydown', { key: 'ArrowUp' })
    expect(store.selection).toEqual({ anchor: 19, focus: 19 })
  })

  it('Home / End walk to the row ends; Ctrl+Home / Ctrl+End to the document ends', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 100 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    store.setCursor(37) // row 2 (offsets 32..47) at 16 bpr
    await area.trigger('keydown', { key: 'Home' })
    expect(store.selection!.focus).toBe(32)
    await area.trigger('keydown', { key: 'End' })
    expect(store.selection!.focus).toBe(47)

    await area.trigger('keydown', { key: 'End', ctrlKey: true })
    expect(store.selection!.focus).toBe(99) // last byte
    await area.trigger('keydown', { key: 'Home', ctrlKey: true })
    expect(store.selection!.focus).toBe(0)
  })

  it('does nothing on a zero-byte file — there is no byte to point at', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(app, [])

    await app.find('.hex-viewer__row-area').trigger('keydown', { key: 'ArrowRight' })
    expect(store.selection).toBeNull()
  })
})

describe('the Selection: one range, byte-snapped, linked across panes (#22)', () => {
  it('drag selects a range, highlighted from the same bytes in both panes', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointerdown', { button: 0, pointerId: 1, ...hexPoint(2) })
    await area.trigger('pointermove', { pointerId: 1, ...hexPoint(9) })
    await area.trigger('pointerup', { pointerId: 1, ...hexPoint(9) })

    expect(store.selection).toEqual({ anchor: 2, focus: 9 })
    expect(selectedHexOffsets(app)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    // The ASCII pane highlights exactly the same bytes.
    expect(
      app
        .findAll('.hex-row__char--selected')
        .map((c) => Number((c.element as HTMLElement).dataset.offset)),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('shift-click extends the current Selection to the clicked byte, backwards if that is the end grabbed', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointerdown', { button: 0, ...hexPoint(10) })
    await area.trigger('pointerdown', { button: 0, shiftKey: true, ...hexPoint(4) })

    expect(store.selection).toEqual({ anchor: 10, focus: 4 })
    expect(selectedHexOffsets(app)).toEqual([4, 5, 6, 7, 8, 9, 10])
  })

  it('keeps extending when a shift-click turns into a drag', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointerdown', { button: 0, ...hexPoint(10) })
    await area.trigger('pointerdown', { button: 0, pointerId: 1, shiftKey: true, ...hexPoint(4) })
    await area.trigger('pointermove', { pointerId: 1, ...hexPoint(2) })
    await area.trigger('pointerup', { pointerId: 1, ...hexPoint(2) })

    expect(store.selection).toEqual({ anchor: 10, focus: 2 })
    expect(selectedHexOffsets(app)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('Shift+arrows extend the end the reader grabbed — a backwards Selection extends backwards', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    store.setCursor(20)
    await area.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(store.selection).toEqual({ anchor: 20, focus: 19 })
    await area.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(store.selection).toEqual({ anchor: 20, focus: 18 })
    // Now flip forwards past the anchor in one extend.
    await area.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
    expect(store.selection).toEqual({ anchor: 20, focus: 34 })
  })

  it('Shift+arrow after the Cursor first appears extends from where it was, not the destination', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())
    const area = app.find('.hex-viewer__row-area')

    expect(store.selection).toBeNull()
    // First key press only reveals the Cursor on the first visible byte.
    await area.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(store.selection).toEqual({ anchor: 0, focus: 0 })

    // The next Shift+arrow extends from that anchor, one byte at a time.
    await area.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(store.selection).toEqual({ anchor: 0, focus: 1 })
  })

  it('a plain click replaces the Selection — there is never more than one range', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointerdown', { button: 0, pointerId: 1, ...hexPoint(2) })
    await area.trigger('pointermove', { pointerId: 1, ...hexPoint(9) })
    await area.trigger('pointerup', { pointerId: 1, ...hexPoint(9) })
    expect(selectedHexOffsets(app)).toHaveLength(8)

    await area.trigger('pointerdown', { button: 0, ...hexPoint(15) })
    expect(store.selection).toEqual({ anchor: 15, focus: 15 })
    expect(app.findAll('.hex-row__byte--selected')).toHaveLength(0)
    expect(app.findAll('.hex-row__byte--cursor')).toHaveLength(1)
  })

  it('does not survive opening another document', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )

    await app.find('.hex-viewer__row-area').trigger('pointerdown', { button: 0, ...hexPoint(4) })
    expect(store.selection).not.toBeNull()

    store.open(new FileByteSource(fileOf([9, 9, 9, 9])), 'other.bin')
    await flushPromises()

    expect(store.selection).toBeNull()
    expect(app.findAll('.hex-row__byte--cursor')).toHaveLength(0)
    expect(app.findAll('.hex-row__byte--selected')).toHaveLength(0)
  })
})

describe('keyboard drives the Cursor, pointer drives the view (#22, ADR-0003)', () => {
  it('the view follows the Cursor down one row at a time, and no further', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())
    const area = app.find('.hex-viewer__row-area')

    // 40 whole rows visible (rows 0..39). Put the Cursor on the last visible row.
    store.setCursor(39 * 16)
    expect(store.topByteOffset).toBe(0)

    await area.trigger('keydown', { key: 'ArrowDown' })
    // Cursor is now on row 40 — one past the bottom, so the view scrolls exactly
    // one row to reveal it and no further.
    expect(store.selection!.focus).toBe(40 * 16)
    expect(store.topByteOffset).toBe(16)

    await area.trigger('keydown', { key: 'ArrowDown' })
    expect(store.selection!.focus).toBe(41 * 16)
    expect(store.topByteOffset).toBe(32) // one more row, still minimal

    // Walking the Cursor back up while its row stays on screen moves nothing.
    await area.trigger('keydown', { key: 'ArrowUp' })
    expect(store.topByteOffset).toBe(32)
  })

  it('pulls the view back up when the Cursor would leave the top', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())
    const area = app.find('.hex-viewer__row-area')

    store.setCursor(10 * 16)
    store.topByteOffset = 10 * 16 // firstRow 10 — the Cursor sits on the top row
    await area.trigger('keydown', { key: 'ArrowUp' })

    expect(store.selection!.focus).toBe(9 * 16)
    expect(store.topByteOffset).toBe(9 * 16) // scrolled up exactly one row
  })

  it('Ctrl+End / Ctrl+Home move the Cursor to the document ends and the view with them', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    const source = new SyntheticByteSource()
    await openSynthetic(app, source)
    const area = app.find('.hex-viewer__row-area')

    store.setCursor(0)
    await area.trigger('keydown', { key: 'End', ctrlKey: true })
    expect(store.selection!.focus).toBe(source.size - 1)
    expect(store.topByteOffset).toBe(LAST_TOP_OFFSET)

    await area.trigger('keydown', { key: 'Home', ctrlKey: true })
    expect(store.selection!.focus).toBe(0)
    expect(store.topByteOffset).toBe(0)
  })

  it('PageDown / PageUp move the Cursor by a screenful', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())
    const area = app.find('.hex-viewer__row-area')

    store.setCursor(0)
    await area.trigger('keydown', { key: 'PageDown' })
    expect(store.selection!.focus).toBe(40 * 16) // visibleRows * bytesPerRow
    await area.trigger('keydown', { key: 'PageUp' })
    expect(store.selection!.focus).toBe(0)
  })

  it('the wheel moves the view only and may leave the Cursor off screen', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    // A file with rows below the fold, so a Cursor at offset 0 can scroll away.
    await openFile(
      app,
      Array.from({ length: 2048 }, (_u, i) => i & 0xff),
    )

    store.setCursor(0)
    await flushPromises()
    expect(app.findAll('.hex-row__byte--cursor')).toHaveLength(1)

    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 100, deltaMode: 1 })

    expect(store.selection).toEqual({ anchor: 0, focus: 0 }) // untouched by the wheel
    expect(store.topByteOffset).toBeGreaterThan(0)
    expect(app.findAll('.hex-row__byte--cursor')).toHaveLength(0) // scrolled past
  })
})

// --- Goto: exact navigation to any offset (#24) -----------------------------

/** Fire `Ctrl+G` on `window`, from wherever focus happens to be. */
async function pressCtrlG(): Promise<void> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))
  await flushPromises()
}

async function typeOffset(app: VueWrapper, value: string): Promise<void> {
  await app.find('#goto-box-input').setValue(value)
  await app.find('.goto-box__form').trigger('submit')
  await flushPromises()
}

describe('Goto: exact navigation to any offset (#24)', () => {
  it('opens the box on Ctrl+G from anywhere in the app', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    expect(app.find('.goto-box').exists()).toBe(false)
    await pressCtrlG()
    expect(app.find('.goto-box').exists()).toBe(true)
    // Focus is in the box, on the field.
    expect(document.activeElement).toBe(app.find('#goto-box-input').element)
  })

  it('also opens on Ctrl+G while the Viewport itself has focus', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    await app.find('.hex-viewer__row-area').trigger('keydown', { key: 'g', ctrlKey: true })
    await flushPromises()
    expect(app.find('.goto-box').exists()).toBe(true)
  })

  it('accepts a 0x-hex offset and lands both the view and the Cursor on it', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    await typeOffset(app, '0x1F40') // 8000, a row boundary

    expect(store.topByteOffset).toBe(8000)
    expect(store.selection).toEqual({ anchor: 8000, focus: 8000 })
    expect(app.find('.goto-box').exists()).toBe(false) // closed on confirm
  })

  it('accepts a plain decimal offset', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    await typeOffset(app, '256')

    expect(store.topByteOffset).toBe(256)
    expect(store.selection).toEqual({ anchor: 256, focus: 256 })
  })

  it('routes the view through clampTopOffset — the Cursor is exact, the top is its row', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    await typeOffset(app, '0x1F45') // 8005 — mid-row

    expect(store.selection!.focus).toBe(8005) // Cursor on the exact byte
    expect(store.topByteOffset).toBe(8000) // view aligned down to the row boundary
  })

  it('clamps an out-of-range offset to the document rather than rejecting it', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )

    await pressCtrlG()
    await typeOffset(app, '0x9999') // far past a 64-byte file

    expect(store.selection!.focus).toBe(63) // last real byte
    expect(store.topByteOffset).toBe(0) // only one screen of rows exists
    expect(app.find('.goto-box').exists()).toBe(false)
  })

  it('Esc closes the box without moving and returns focus to the Viewport', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 5, deltaMode: 1 })
    expect(store.topByteOffset).toBe(80)

    await pressCtrlG()
    await app.find('#goto-box-input').setValue('0x1F40')
    await app.find('.goto-box').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(app.find('.goto-box').exists()).toBe(false)
    expect(store.topByteOffset).toBe(80) // unmoved
    expect(store.selection).toBeNull()
    expect(document.activeElement).toBe(app.find('.hex-viewer__row-area').element)
  })

  it('returns focus to the Viewport on confirm too', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    await typeOffset(app, '0')

    expect(document.activeElement).toBe(app.find('.hex-viewer__row-area').element)
  })

  it('traps Tab and Shift+Tab between the field and its buttons', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    const input = app.find('#goto-box-input').element
    const cancel = app.find('.goto-box__cancel').element
    expect(document.activeElement).toBe(input)

    // Shift+Tab off the first control wraps to the last.
    await app.find('.goto-box').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)

    // Tab off the last control wraps back to the first.
    await app.find('.goto-box').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(input)
  })

  it('keeps an unparseable entry in the box and moves nothing', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    await typeOffset(app, 'not-an-offset')

    expect(app.find('.goto-box').exists()).toBe(true)
    expect(app.find('#goto-box-input').attributes('aria-invalid')).toBe('true')
    expect(store.selection).toBeNull()
    expect(store.topByteOffset).toBe(0)
  })

  it('does not open on Ctrl+Shift+G — browser reverse-find is left alone', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true }),
    )
    await flushPromises()

    expect(app.find('.goto-box').exists()).toBe(false)
  })

  it('a click on the backdrop closes the box without moving and restores Viewport focus', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 5, deltaMode: 1 })
    expect(store.topByteOffset).toBe(80)

    await pressCtrlG()
    await app.find('.goto-box__backdrop').trigger('pointerdown')

    expect(app.find('.goto-box').exists()).toBe(false)
    expect(store.topByteOffset).toBe(80) // unmoved
    expect(store.selection).toBeNull()
    expect(document.activeElement).toBe(app.find('.hex-viewer__row-area').element)
  })

  it('a click inside the box leaves it open', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    await app.find('#goto-box-input').trigger('pointerdown')

    expect(app.find('.goto-box').exists()).toBe(true)
  })

  it('pulls focus back to the field if it escapes the open box', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    await pressCtrlG()
    const input = app.find('#goto-box-input').element
    expect(document.activeElement).toBe(input)

    // Something steals focus while the box is still open.
    ;(app.find('.hex-viewer__row-area').element as HTMLElement).focus()
    await app.find('.goto-box').trigger('focusout')

    expect(document.activeElement).toBe(input)
  })
})

// --- Hover highlight (#30) ------------------------------------------------

/** Absolute offsets of every `--hovered` cell in a pane. */
function hoveredOffsets(app: VueWrapper, pane = '.hex-row__byte'): number[] {
  return app
    .findAll(`${pane}--hovered`)
    .map((c) => Number((c.element as HTMLElement).dataset.offset))
}

describe('hover mark — tracing a byte across the panes (#30)', () => {
  it('marks the hovered byte in both panes, distinct from the Cursor and the Selection', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    // A Selection over 10..13 is already on screen.
    store.setCursor(10)
    store.extendSelectionTo(13)
    await flushPromises()

    await area.trigger('pointermove', { ...hexPoint(7) })
    await flushPromises()

    expect(hoveredOffsets(app)).toEqual([7])
    expect(hoveredOffsets(app, '.hex-row__char')).toEqual([7]) // same byte, other pane
    const hovered = app.get('.hex-row__byte--hovered')
    expect(hovered.classes()).not.toContain('hex-row__byte--cursor')
    expect(hovered.classes()).not.toContain('hex-row__byte--selected')
    // Hovering elsewhere has not disturbed the Selection.
    expect(store.selection).toEqual({ anchor: 10, focus: 13 })
    expect(selectedHexOffsets(app)).toEqual([10, 11, 12, 13])
  })

  it('resolves the hovered byte from the ASCII pane too — it is a byte index, not pixels', async () => {
    const app = mountApp()
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )

    await app.find('.hex-viewer__row-area').trigger('pointermove', { ...asciiPoint(9) })
    await flushPromises()

    expect(hoveredOffsets(app)).toEqual([9])
    expect(hoveredOffsets(app, '.hex-row__char')).toEqual([9])
  })

  it('clears the highlight when the pointer moves onto a gap', async () => {
    const app = mountApp()
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointermove', { ...hexPoint(5) })
    await flushPromises()
    expect(hoveredOffsets(app)).toEqual([5])

    await area.trigger('pointermove', { clientX: 5_000, clientY: 5_000 })
    await flushPromises()
    expect(hoveredOffsets(app)).toEqual([])
  })

  it('clears the highlight when the pointer leaves the grid', async () => {
    const app = mountApp()
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointermove', { ...hexPoint(5) })
    await flushPromises()
    expect(hoveredOffsets(app)).toEqual([5])

    await area.trigger('pointerleave')
    await flushPromises()
    expect(hoveredOffsets(app)).toEqual([])
  })

  it('drops the hover mark while a drag-select is in progress — the fill takes over', async () => {
    const app = mountApp()
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointermove', { ...hexPoint(2) })
    await flushPromises()
    expect(hoveredOffsets(app)).toEqual([2])

    await area.trigger('pointerdown', { button: 0, pointerId: 1, ...hexPoint(2) })
    await area.trigger('pointermove', { pointerId: 1, ...hexPoint(6) })
    await flushPromises()

    expect(hoveredOffsets(app)).toEqual([])
    expect(selectedHexOffsets(app)).toEqual([2, 3, 4, 5, 6])
  })

  it('does not carry a hovered byte across to a newly opened document', async () => {
    const app = mountApp()
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointermove', { ...hexPoint(5) })
    await flushPromises()
    expect(hoveredOffsets(app)).toEqual([5])

    useDocumentStore(pinia).open(new FileByteSource(fileOf([9, 9, 9, 9])), 'other.bin')
    await flushPromises()

    expect(hoveredOffsets(app)).toEqual([])
  })

  it('drops the mark on a scroll — it does not stay glued to a byte the pointer left', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 2000 }, (_u, i) => i & 0xff),
    )
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointermove', { ...hexPoint(5) })
    await flushPromises()
    expect(hoveredOffsets(app)).toEqual([5])

    // A wheel scroll moves the rows without the pointer moving.
    await area.trigger('wheel', { deltaY: 3, deltaMode: 1 })
    await flushPromises()

    expect(store.topByteOffset).toBeGreaterThan(0) // the scroll happened
    expect(hoveredOffsets(app)).toEqual([])
  })
})

// --- Copy the Selection as hex (#25) ---------------------------------------

/** A source whose `read` always rejects but whose `readSync` still answers for
 *  bytes that were resident when it died — the dead-source case for copy. */
class DeadButResidentSource implements ByteSource {
  readonly size = 4096
  readonly #residentEnd = 64
  read(): Promise<Uint8Array> {
    return Promise.reject(new Error('source-gone'))
  }
  readSync(offset: number, length: number): Uint8Array | null {
    if (offset + length > this.#residentEnd) return null
    return Uint8Array.from({ length }, (_u, i) => (offset + i) & 0xff)
  }
  prefetch(): void {}
  close(): void {}
}

async function pressCopy(app: VueWrapper): Promise<void> {
  await app.find('.hex-viewer__row-area').trigger('keydown', { key: 'c', ctrlKey: true })
  await flushPromises()
}

describe('Copy the Selection as hex, refusing past 8 MiB (#25)', () => {
  it('copies a shift-selected range to the clipboard as a spaced-hex string, and says so', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(
      app,
      Array.from({ length: 48 }, (_u, i) => i),
    )
    const area = app.find('.hex-viewer__row-area')

    // The keyboard-only path: point, then Shift+click to extend, then copy.
    await area.trigger('pointerdown', { button: 0, ...hexPoint(2) })
    await area.trigger('pointerdown', { button: 0, shiftKey: true, ...hexPoint(6) })
    expect(store.selection).toEqual({ anchor: 2, focus: 6 })

    await pressCopy(app)

    expect(writeText).toHaveBeenCalledExactlyOnceWith('02 03 04 05 06')
    expect(store.actionStatus).toEqual({
      ok: true,
      message: 'Copied 5 bytes to the clipboard as hex.',
    })
    // And it is shown in the status bar (not a live region — that is #28).
    expect(app.find('[data-field="copy-status"]').text()).toBe(
      'Copied 5 bytes to the clipboard as hex.',
    )
  })

  it('copies a collapsed Cursor as its single byte', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    await openFile(
      app,
      Array.from({ length: 16 }, (_u, i) => 0x40 + i),
    )

    await app.find('.hex-viewer__row-area').trigger('pointerdown', { button: 0, ...hexPoint(3) })
    await pressCopy(app)

    expect(writeText).toHaveBeenCalledExactlyOnceWith('43')
  })

  it('does nothing on Ctrl+C with no Selection', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(app, [1, 2, 3, 4])

    await pressCopy(app)

    expect(writeText).not.toHaveBeenCalled()
    expect(store.actionStatus).toBeNull()
  })

  it('refuses a Selection over 8 MiB of source bytes — wording names the cap and the size, nothing is copied', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource()) // 2 GB

    // The Selection itself is uncapped — marking 10 MiB is not blocked.
    store.setCursor(0)
    store.extendSelectionTo(10 * 1024 * 1024 - 1)
    expect(store.selection).toEqual({ anchor: 0, focus: 10 * 1024 * 1024 - 1 })

    await pressCopy(app)

    expect(writeText).not.toHaveBeenCalled()
    expect(store.actionStatus?.ok).toBe(false)
    const message = store.actionStatus!.message
    expect(message).toContain('10.0 MiB') // the Selection's size
    expect(message).toContain((10 * 1024 * 1024).toLocaleString()) // exactly
    expect(message).toContain('8.0 MiB') // the cap
    expect(message).toMatch(/nothing was copied/i)
    // The refusal is shown, marked as a refusal.
    const shown = app.find('[data-field="copy-status"]')
    expect(shown.text()).toBe(message)
    expect(shown.classes()).toContain('status-bar__copy--refused')
  })

  it('serves the copy as a Direct read — the working set is not flushed and nothing new is populated', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)

    // 17 pages (64 KiB each) — a whole-file copy is 1_114_112 bytes, over the
    // cache's 1 MiB Direct-read threshold.
    const size = 1024 * 1024 + 64 * 1024
    const raw = new Uint8Array(size)
    for (let i = 0; i < size; i++) raw[i] = i & 0xff
    const source = new FileByteSource(new File([raw], 'big.bin'))

    store.open(source, 'big.bin')
    await flushPromises()

    store.setCursor(0)
    store.extendSelectionTo(size - 1)
    await flushPromises() // let the status bar's point read of the focus byte settle

    // A handful of Pages resident — the first screen, prefetch, the Cursor's
    // byte — nowhere near the 17 the whole file spans.
    const residentBefore = source.stats.pagesResident
    expect(residentBefore).toBeGreaterThan(0)
    expect(residentBefore).toBeLessThan(6)

    await pressCopy(app)

    const arg = writeText.mock.calls[0]![0] as string
    expect(arg.startsWith('00 01 02 03 04 05 06 07')).toBe(true)
    expect(arg.split(' ')).toHaveLength(size) // every source byte, none dropped
    // The Direct read consulted resident Pages but populated none: the working
    // set the reader built is exactly as it was — a 1 MiB copy did not flush it.
    expect(source.stats.pagesResident).toBe(residentBefore)
  })

  it('still copies a wholly-resident Selection after the source has died', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)

    store.open(new DeadButResidentSource(), 'dead.bin')
    await flushPromises()

    store.setCursor(0)
    store.extendSelectionTo(7) // inside the bytes that were resident when it died
    await pressCopy(app)

    expect(writeText).toHaveBeenCalledExactlyOnceWith('00 01 02 03 04 05 06 07')
    expect(store.actionStatus?.ok).toBe(true)
  })
})

// --- Copy the Selection as raw text (#30) ---------------------------------

async function pressCopyText(app: VueWrapper): Promise<void> {
  await app
    .find('.hex-viewer__row-area')
    .trigger('keydown', { key: 'c', ctrlKey: true, altKey: true })
  await flushPromises()
}

describe('Copy the Selection as raw text on Ctrl+Alt+C (#30)', () => {
  it('copies the selected bytes decoded as text and announces it through the action region', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)
    // "hello" then padding.
    await openFile(app, [0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x00, 0x00])
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('pointerdown', { button: 0, ...hexPoint(0) })
    await area.trigger('pointerdown', { button: 0, shiftKey: true, ...hexPoint(4) })
    expect(store.selection).toEqual({ anchor: 0, focus: 4 })

    await pressCopyText(app)

    expect(writeText).toHaveBeenCalledExactlyOnceWith('hello')
    expect(store.actionStatus).toEqual({
      ok: true,
      message: 'Copied 5 bytes to the clipboard as text.',
    })
    // The existing action live region carries it — no new region (#28, #30).
    expect(app.find('[data-field="action-live-region"]').text()).toBe(
      'Copied 5 bytes to the clipboard as text.',
    )
  })

  it('does nothing on Ctrl+Alt+C with no Selection', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(app, [1, 2, 3, 4])

    await pressCopyText(app)

    expect(writeText).not.toHaveBeenCalled()
    expect(store.actionStatus).toBeNull()
  })

  it('refuses past the same 8 MiB cap, with the same refusal shown and spoken', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource()) // 2 GB

    store.setCursor(0)
    store.extendSelectionTo(10 * 1024 * 1024 - 1) // 10 MiB — uncapped as a Selection
    await pressCopyText(app)

    expect(writeText).not.toHaveBeenCalled()
    expect(store.actionStatus?.ok).toBe(false)
    expect(store.actionStatus?.message).toContain('8.0 MiB')
    expect(store.actionStatus?.message).toMatch(/nothing was copied/i)
    const shown = app.find('[data-field="copy-status"]')
    expect(shown.text()).toBe(store.actionStatus!.message)
    expect(shown.classes()).toContain('status-bar__copy--refused')
    expect(app.find('[data-field="action-live-region"]').text()).toContain('Nothing was copied.')
  })

  it('leaves plain Ctrl+C copying hex — the two chords are distinct', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    await openFile(app, [0x41, 0x42, 0x43, 0x44])

    await app.find('.hex-viewer__row-area').trigger('pointerdown', { button: 0, ...hexPoint(0) })
    await app
      .find('.hex-viewer__row-area')
      .trigger('pointerdown', { button: 0, shiftKey: true, ...hexPoint(3) })
    await pressCopy(app) // plain Ctrl+C

    expect(writeText).toHaveBeenCalledExactlyOnceWith('41 42 43 44')
    expect(useDocumentStore(pinia).actionStatus?.message).toMatch(/as hex\.$/)
  })

  it('leaves Ctrl+Shift+C for the browser — it is not a copy chord', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(app, [0x41, 0x42, 0x43, 0x44])
    store.setCursor(0)
    store.extendSelectionTo(3)

    const event = new KeyboardEvent('keydown', {
      key: 'C',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    app.find('.hex-viewer__row-area').element.dispatchEvent(event)
    await flushPromises()

    expect(writeText).not.toHaveBeenCalled()
    expect(store.actionStatus).toBeNull()
    expect(event.defaultPrevented).toBe(false) // the browser keeps its binding
  })

  it('still fires when Alt has rewritten event.key to another glyph (macOS Option+C)', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    await openFile(app, [0x68, 0x69]) // "hi"
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    store.extendSelectionTo(1)

    await app
      .find('.hex-viewer__row-area')
      .trigger('keydown', { key: 'ç', code: 'KeyC', ctrlKey: true, altKey: true })
    await flushPromises()

    expect(writeText).toHaveBeenCalledExactlyOnceWith('hi')
    expect(store.actionStatus?.message).toMatch(/as text\.$/)
  })
})

// --- The dead-source banner (#26, ADR-0004) ---------------------------------

/**
 * A rejecting blob stub (plan §11's "failing" substitution): byte `i` holds
 * `i & 0xff`, and every `slice(...).arrayBuffer()` succeeds until {@link
 * goAway} is called, after which every one rejects the way a real `File`
 * does once it has moved or been truncated out from under the reader.
 * `sliceCalls` proves the latch stops touching the "disk".
 */
function flakyFile(
  size: number,
  name = 'moved.bin',
): { file: File; goAway: () => void; sliceCalls: () => number } {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = i & 0xff
  let alive = true
  let calls = 0
  const file = {
    size,
    name,
    slice(start: number, end: number) {
      calls++
      return {
        arrayBuffer(): Promise<ArrayBuffer> {
          if (!alive) {
            return Promise.reject(new DOMException('file moved', 'NotFoundError'))
          }
          return Promise.resolve(bytes.slice(start, end).buffer)
        },
      }
    },
  } as unknown as File
  return { file, goAway: () => (alive = false), sliceCalls: () => calls }
}

/** A source whose `read` always rejects with a chosen `ByteSourceError` code. */
class AlwaysRejectingSource implements ByteSource {
  readonly size = 4096
  readonly #code: 'read-failed' | 'source-closed'
  constructor(code: 'read-failed' | 'source-closed') {
    this.#code = code
  }
  read(): Promise<Uint8Array> {
    return Promise.reject(new ByteSourceError(this.#code))
  }
  readSync(): Uint8Array | null {
    return null
  }
  prefetch(): void {}
  close(): void {}
}

/**
 * A source whose `read` rejects with `read-failed` until {@link heal} is
 * called, after which every `read` succeeds. `readSync` always misses, so
 * every row goes through `read` on every settle — the escalation counter's
 * whole reason to exist.
 */
class FlakySource implements ByteSource {
  readonly size = 4096
  #healthy = false
  read(offset: number, length: number): Promise<Uint8Array> {
    if (!this.#healthy) {
      return Promise.reject(new ByteSourceError('read-failed'))
    }
    const count = Math.max(0, Math.min(length, this.size - offset))
    return Promise.resolve(Uint8Array.from({ length: count }, (_u, i) => (offset + i) & 0xff))
  }
  readSync(): Uint8Array | null {
    return null
  }
  prefetch(): void {}
  close(): void {}
  heal(): void {
    this.#healthy = true
  }
}

function banner(app: VueWrapper) {
  return app.find('[data-field="dead-source-banner"]')
}

describe('the dead-source banner (#26, ADR-0004)', () => {
  it('shows nothing while the source is healthy', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openFile(app, [1, 2, 3, 4])

    expect(store.sourceHealth).toBe('ok')
    expect(banner(app).exists()).toBe(false)
  })

  it('latches on source-gone: names the file, keeps resident rows painting, and never retries the dead range', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    const PAGE = 64 * 1024
    const { file, goAway, sliceCalls } = flakyFile(PAGE * 3, 'moved.bin')
    const source = new FileByteSource(file)
    store.open(source, 'moved.bin')
    await flushPromises() // the first screen's page (plus its ±1 prefetch) goes resident

    expect(store.sourceHealth).toBe('ok')
    expect(banner(app).exists()).toBe(false)
    expect(bytesText(app).slice(0, 4)).toEqual(['00', '01', '02', '03'])

    // The file moves right now. Nothing already resident notices yet.
    goAway()
    expect(store.sourceHealth).toBe('ok')

    // Scroll to a page that was never fetched — its read rejects source-gone
    // and latches.
    store.topByteOffset = PAGE * 2
    await flushPromises()

    expect(store.sourceHealth).toBe('gone')
    const shown = banner(app)
    expect(shown.exists()).toBe(true)
    expect(shown.attributes('role')).toBe('alert')
    expect(shown.text()).toContain('moved.bin')
    expect(shown.text()).toMatch(/no longer available/i)
    // Non-dismissible: nothing to click, nothing to focus (ADR-0005).
    expect(shown.find('button').exists()).toBe(false)
    expect(app.findAll('.hex-row--pending').length).toBeGreaterThan(0) // this page stays ·· forever

    const callsAtLatch = sliceCalls()

    // Scroll back to the resident first page: it still paints, latch or not.
    store.topByteOffset = 0
    await flushPromises()
    expect(bytesText(app).slice(0, 4)).toEqual(['00', '01', '02', '03'])
    expect(store.sourceHealth).toBe('gone') // still latched — the banner persists

    // Scroll to the dead range again: still ·· forever, and the latch means
    // it never touches the file again.
    store.topByteOffset = PAGE * 2
    await flushPromises()
    expect(app.findAll('.hex-row--pending').length).toBeGreaterThan(0)
    expect(sliceCalls()).toBe(callsAtLatch)
  })

  it('never shows chrome for source-closed rejections', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    store.open(new AlwaysRejectingSource('source-closed'), 'closed.bin')
    await flushPromises()

    expect(store.sourceHealth).toBe('ok')
    expect(banner(app).exists()).toBe(false)
  })

  it('shows no chrome for read-failed under the escalation threshold', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    // Shrink the viewport to 1 visible row (2 requested) so each settle's
    // failure count is precisely controllable.
    stubHeight(app, '.hex-viewer__probe', 10)
    stubHeight(app, '.hex-viewer__row-area', 10)

    store.open(new FlakySource(), 'flaky.bin')
    await flushPromises() // 2 consecutive failures — under the threshold of 3

    expect(store.sourceHealth).toBe('ok')
    expect(banner(app).exists()).toBe(false)
  })

  it('escalates past a threshold of consecutive read-failed rejections, then self-heals on the first success', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    stubHeight(app, '.hex-viewer__probe', 10)
    stubHeight(app, '.hex-viewer__row-area', 10) // 1 visible row, 2 requested per settle

    const source = new FlakySource()
    store.open(source, 'flaky.bin')
    await flushPromises() // 2 failures — under the threshold
    expect(store.sourceHealth).toBe('ok')

    store.topByteOffset = 32 // a fresh pair of rows — 2 more failures, crossing the threshold
    await flushPromises()

    expect(store.sourceHealth).toBe('failing')
    const shown = banner(app)
    expect(shown.exists()).toBe(true)
    expect(shown.attributes('role')).toBe('alert')
    expect(shown.text()).toContain('flaky.bin')
    expect(shown.text()).toMatch(/could not be read/i)

    source.heal()
    store.topByteOffset = 64 // a fresh pair of rows, now both succeed
    await flushPromises()

    expect(store.sourceHealth).toBe('ok')
    expect(banner(app).exists()).toBe(false)
  })
})

// --- Viewport accessibility: role=application and the announced Cursor (#27, ADR-0005) --

function liveRegion(app: VueWrapper) {
  return app.find('[data-field="cursor-live-region"]')
}

describe('Viewport accessibility: role=application and the announced Cursor (#27)', () => {
  it('the Viewport is a single role=application element with a usage note and a label naming the file', async () => {
    const app = mountApp()
    const area = app.find('.hex-viewer__row-area')

    expect(area.attributes('tabindex')).toBe('0')
    expect(area.attributes('role')).toBe('application')
    expect(area.attributes('aria-describedby')).toBe('hex-viewer-usage')
    const usage = app.find('#hex-viewer-usage')
    expect(usage.exists()).toBe(true)
    expect(usage.text()).toMatch(/arrow/i)
    expect(usage.text()).toMatch(/ctrl\+g/i)
    expect(usage.text()).toMatch(/tab/i)
    expect(area.attributes('aria-label')).toBe('Hex viewer') // no file open yet

    await openFile(app, [1, 2, 3, 4])

    const label = app.find('.hex-viewer__row-area').attributes('aria-label')!
    expect(label).toContain('sel.bin') // openFile's fixed name
    expect(label).toContain('4 bytes')
  })

  it('never scopes role=application past the Viewport', () => {
    const app = mountApp()
    expect(app.find('[data-region="viewport"]').attributes('role')).toBeUndefined()
    expect(app.find('.app-shell').attributes('role')).toBeUndefined()
  })

  it('rows are aria-hidden and never focusable — reading the grid as a document is a non-goal', async () => {
    const app = mountApp()
    await openFile(app, [1, 2, 3, 4])

    const row = app.get('.hex-row')
    expect(row.attributes('aria-hidden')).toBe('true')
    expect(row.attributes('tabindex')).toBeUndefined()
    for (const cell of app.findAll('.hex-row__byte').concat(app.findAll('.hex-row__char'))) {
      expect(cell.attributes('tabindex')).toBeUndefined()
    }
  })

  it('moves focus to the Viewport on a successful open, with the label already naming the new file', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)

    store.open(new FileByteSource(fileOf([1, 2, 3], 'opened.bin')), 'opened.bin')
    await flushPromises()

    const area = app.find('.hex-viewer__row-area')
    expect(document.activeElement).toBe(area.element)
    expect(area.attributes('aria-label')).toContain('opened.bin')
    expect(area.attributes('aria-label')).toContain('3 bytes')
  })

  it('announces the Cursor as one sentence, debounced so it speaks the destination, not the journey', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    store.open(new FileByteSource(fileOf([0x4d, 0x5a, 0x90, 0x00])), 'sel.bin')
    await flushPromises()
    expect(liveRegion(app).exists()).toBe(true) // present (and empty) before any Cursor move

    vi.useFakeTimers()
    try {
      store.setCursor(0)
      await app.vm.$nextTick()
      expect(liveRegion(app).text()).toBe('') // still settling

      await vi.advanceTimersByTimeAsync(200)
      expect(liveRegion(app).text()).toBe("offset 0x00, byte 4D, 'M'")

      // A second, uninterrupted move re-settles and speaks its own destination.
      store.setCursor(1)
      await app.vm.$nextTick()
      await vi.advanceTimersByTimeAsync(200)
      expect(liveRegion(app).text()).toBe("offset 0x01, byte 5A, 'Z'")
    } finally {
      vi.useRealTimers()
    }
  })

  it('a held key only speaks where it settles — interrupted moves never get their own announcement', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    store.open(new FileByteSource(fileOf(Array.from({ length: 8 }, (_u, i) => i))), 'walk.bin')
    await flushPromises()

    vi.useFakeTimers()
    try {
      store.setCursor(0)
      await app.vm.$nextTick()
      await vi.advanceTimersByTimeAsync(200)
      expect(liveRegion(app).text()).toBe("offset 0x00, byte 00, '.'")

      store.setCursor(1)
      await app.vm.$nextTick()
      await vi.advanceTimersByTimeAsync(100) // under the 200ms settle
      store.setCursor(2)
      await app.vm.$nextTick()
      await vi.advanceTimersByTimeAsync(100)
      store.setCursor(3)
      await app.vm.$nextTick()
      // None of 1, 2 or 3 ever sat still for 200ms — nothing new spoken yet.
      expect(liveRegion(app).text()).toBe("offset 0x00, byte 00, '.'")

      await vi.advanceTimersByTimeAsync(200)
      expect(liveRegion(app).text()).toBe("offset 0x03, byte 03, '.'")
    } finally {
      vi.useRealTimers()
    }
  })

  it('speaks an extended Selection as a range and its length — one concept, not a second beside the Cursor', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    store.open(new FileByteSource(fileOf(Array.from({ length: 32 }, (_u, i) => i))), 'range.bin')
    await flushPromises()

    vi.useFakeTimers()
    try {
      store.setCursor(0x10)
      store.extendSelectionTo(0x1f)
      await app.vm.$nextTick()
      await vi.advanceTimersByTimeAsync(200)

      expect(liveRegion(app).text()).toBe('selection 0x10 to 0x1F, 16 bytes')
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates the announcement once a still-settling byte resolves after the debounce fires', async () => {
    let resolveRead: (() => void) | null = null
    const source: ByteSource = {
      size: 64,
      read: (_offset, length) =>
        new Promise((resolve) => {
          resolveRead = () => resolve(new Uint8Array(length).fill(0x4d))
        }),
      readSync: () => null,
      prefetch: () => {},
      close: () => {},
    }
    const app = mountApp()
    const store = useDocumentStore(pinia)
    store.open(source, 'deferred.bin')
    await flushPromises()

    vi.useFakeTimers()
    try {
      store.setCursor(10)
      await app.vm.$nextTick()
      await vi.advanceTimersByTimeAsync(200) // the debounce settles...
      expect(liveRegion(app).text()).toBe('') // ...but the byte is still in flight, so withheld

      resolveRead!()
      await vi.advanceTimersByTimeAsync(0)
      await app.vm.$nextTick()

      expect(liveRegion(app).text()).toBe("offset 0x0A, byte 4D, 'M'")
    } finally {
      vi.useRealTimers()
    }
  })

  it('is keyed off the Cursor, not the view — wheel and thumb-drag scrolling announce nothing', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    await app.find('.hex-viewer__row-area').trigger('wheel', { deltaY: 500, deltaMode: 1 })
    await flushPromises()

    expect(liveRegion(app).text()).toBe('')
  })

  it('Ctrl+G speaks its destination through this same region — Goto sets the Cursor', async () => {
    const app = mountApp()
    const store = useDocumentStore(pinia)
    await openSynthetic(app, new SyntheticByteSource())

    vi.useFakeTimers()
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))
      await app.vm.$nextTick()
      await app.find('#goto-box-input').setValue('0x1F40')
      await app.find('.goto-box__form').trigger('submit')
      await app.vm.$nextTick()

      expect(store.selection).toEqual({ anchor: 8000, focus: 8000 })
      await vi.advanceTimersByTimeAsync(200)
      await app.vm.$nextTick() // the byte at 8000 resolves through the async `read` path

      // SyntheticByteSource: byte i holds (offset + i) & 0xff; 8000 & 0xff === 0x40.
      expect(liveRegion(app).text()).toBe("offset 0x1F40, byte 40, '@'")
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes an open Goto box on a new document rather than fighting its focus trap', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))
    await flushPromises()
    expect(app.find('.goto-box').exists()).toBe(true)

    // A new document opens while the box is still up (e.g. a drop reaching the
    // toolbar, outside the box's own backdrop) — the box must not out-fight the
    // Viewport's own focus-on-open (ADR-0005) via its focusout backstop.
    useDocumentStore(pinia).open(new FileByteSource(fileOf([1, 2, 3])), 'second.bin')
    await flushPromises()

    expect(app.find('.goto-box').exists()).toBe(false)
    expect(document.activeElement).toBe(app.find('.hex-viewer__row-area').element)
  })

  it('Tab leaves the Viewport — the reader is never trapped in the grid', async () => {
    // No keydown interception for Tab: CURSOR_KEYS omits it, and it is not the
    // copy chord, so the browser's native focus-advance is left alone.
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    app.find('.hex-viewer__row-area').element.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})

// --- Byte order: the `b` hotkey (#55, plan §4.2) --------------------------

describe('the b hotkey flips the view-wide byte order (#55)', () => {
  it('flips LE ↔ BE while the grid has focus, and announces each flip', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())
    const prefs = usePreferencesStore(pinia)
    const store = useDocumentStore(pinia)
    const area = app.find('.hex-viewer__row-area')

    expect(prefs.byteOrder).toBe('le')

    await area.trigger('keydown', { key: 'b' })
    expect(prefs.byteOrder).toBe('be')
    expect(store.actionStatus).toMatchObject({ ok: true, message: 'Byte order: big-endian' })
    expect(app.find('[data-field="action-live-region"]').text()).toBe('Byte order: big-endian')

    await area.trigger('keydown', { key: 'b' })
    expect(prefs.byteOrder).toBe('le')
    expect(store.actionStatus?.message).toBe('Byte order: little-endian')
  })

  it('ignores b with a modifier, and capital B', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())
    const prefs = usePreferencesStore(pinia)
    const area = app.find('.hex-viewer__row-area')

    await area.trigger('keydown', { key: 'b', ctrlKey: true })
    await area.trigger('keydown', { key: 'b', altKey: true })
    await area.trigger('keydown', { key: 'B', shiftKey: true })
    expect(prefs.byteOrder).toBe('le')
  })

  it('does not fire while the Goto box has focus — never flips mid-typing', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())
    const prefs = usePreferencesStore(pinia)

    await pressCtrlG()
    await app.find('#goto-box-input').setValue('0xb')
    await app.find('#goto-box-input').trigger('keydown', { key: 'b' })

    expect(prefs.byteOrder).toBe('le')
  })

  it('the byte order persists across a remount', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())
    await app.find('.hex-viewer__row-area').trigger('keydown', { key: 'b' })
    expect(usePreferencesStore(pinia).byteOrder).toBe('be')
    app.unmount()

    setActivePinia((pinia = createPinia()))
    mountApp()
    expect(usePreferencesStore(pinia).byteOrder).toBe('be')
  })

  it('the usage note tells the reader about it', async () => {
    const app = mountApp()
    await openSynthetic(app, new SyntheticByteSource())
    expect(app.find('#hex-viewer-usage').text()).toMatch(/press b to switch byte order/i)
  })
})

// --- Find: search the whole file for a hex byte sequence (#103) ------------

/**
 * A hand-driven fake of the worker seam (mirrors `DerivedWorkClient.spec.ts`),
 * with `sent`/`emit` so a test can dispatch a job through the real
 * `DerivedWorkClient` and drive its response without a real `Worker`.
 */
class SearchFakeWorker implements DerivedWorkWorkerLike {
  readonly sent: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  terminateCalls = 0
  postMessage(message: unknown): void {
    this.sent.push(message)
  }
  terminate(): void {
    this.terminateCalls++
  }
  emit(message: DerivedWorkResponseMessage): void {
    this.onmessage?.({ data: message } as MessageEvent)
  }
}

interface SentRequest {
  type: 'request'
  reqId: string
  kind: 'search'
  params: SearchParams
}
interface SentCancel {
  type: 'cancel'
  reqId: string
}

function sentRequests(worker: SearchFakeWorker): SentRequest[] {
  return worker.sent.filter(
    (m): m is SentRequest =>
      typeof m === 'object' && m !== null && (m as SentRequest).type === 'request',
  )
}

function sentCancels(worker: SearchFakeWorker): SentCancel[] {
  return worker.sent.filter(
    (m): m is SentCancel =>
      typeof m === 'object' && m !== null && (m as SentCancel).type === 'cancel',
  )
}

/** Opens the app with a controllable derived-work worker per opened document. */
function mountFindApp(): { app: VueWrapper; workers: SearchFakeWorker[] } {
  const workers: SearchFakeWorker[] = []
  const factory = (file: File): DerivedWorkClient => {
    const worker = new SearchFakeWorker()
    workers.push(worker)
    return new DerivedWorkClient(file, { createWorker: () => worker })
  }
  const app = mountApp(undefined, factory)
  return { app, workers }
}

async function openForSearch(app: VueWrapper, bytes: number[], name = 'search.bin'): Promise<void> {
  await pickFile(app, fileOf(bytes, name))
}

/** `/` on the grid — the only route this component opens through (#103). */
async function openFind(app: VueWrapper): Promise<void> {
  await app.find('.hex-viewer__row-area').trigger('keydown', { key: '/' })
  await flushPromises()
}

async function typeTerm(app: VueWrapper, hex: string): Promise<void> {
  await app.find('#find-box-input').setValue(hex)
}

async function pressEnter(app: VueWrapper, shiftKey = false): Promise<void> {
  await app.find('#find-box-input').trigger('keydown', { key: 'Enter', shiftKey })
  await flushPromises()
}

function resolveSearch(worker: SearchFakeWorker, reqId: string, matches: number[]): void {
  worker.emit({ reqId, kind: 'result', ok: true, result: { matches: Float64Array.from(matches) } })
}

describe('Find: search the whole file for a hex byte sequence (#103)', () => {
  it("'/' opens the box only while the grid has focus, closes on Esc, and returns focus to the grid", async () => {
    const { app } = mountFindApp()
    await openForSearch(app, [1, 2, 3, 4])

    expect(app.find('.find-box').exists()).toBe(false)
    await openFind(app)
    expect(app.find('.find-box').exists()).toBe(true)
    expect(document.activeElement).toBe(app.find('#find-box-input').element)

    await app.find('.find-box').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(app.find('.find-box').exists()).toBe(false)
    expect(document.activeElement).toBe(app.find('.hex-viewer__row-area').element)
  })

  it('does not open while another input (the Goto box) has focus', async () => {
    const { app } = mountFindApp()
    await openForSearch(app, [1, 2, 3, 4])

    await pressCtrlG()
    await app.find('#goto-box-input').trigger('keydown', { key: '/' })
    await flushPromises()

    expect(app.find('.find-box').exists()).toBe(false)
  })

  it('typing an invalid hex string disables Find with an inline error; a valid one enables it', async () => {
    const { app } = mountFindApp()
    await openForSearch(app, [1, 2, 3, 4])
    await openFind(app)

    await typeTerm(app, '4G') // non-hex character
    expect((app.find('.find-box__next').element as HTMLButtonElement).disabled).toBe(true)
    expect(app.find('#find-box-input').attributes('aria-invalid')).toBe('true')
    expect(app.find('#find-box-status').text()).toMatch(/valid hex/i)

    await typeTerm(app, '4D5') // odd digit count
    expect((app.find('.find-box__next').element as HTMLButtonElement).disabled).toBe(true)

    await typeTerm(app, '4D5A')
    expect((app.find('.find-box__next').element as HTMLButtonElement).disabled).toBe(false)
    expect(app.find('#find-box-input').attributes('aria-invalid')).toBeUndefined()
  })

  it('Enter dispatches a search job to the worker and moves the Cursor to the resulting match', async () => {
    const { app, workers } = mountFindApp()
    const store = useDocumentStore(pinia)
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    await openFind(app)
    await typeTerm(app, '2A') // byte 0x2A, offset 42 in this fixture
    await pressEnter(app)

    const worker = workers[0]!
    const reqs = sentRequests(worker)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.params.pattern).toEqual(Uint8Array.of(0x2a))
    expect(app.find('.find-box__cancel').exists()).toBe(true) // spinner + Cancel while in flight

    resolveSearch(worker, reqs[0]!.reqId, [42])
    await flushPromises()

    expect(store.selection).toEqual({ anchor: 42, focus: 42 })
    expect(app.find('.find-box__cancel').exists()).toBe(false) // job finished
  })

  it('Shift+Enter finds the previous match, from the Cursor backwards', async () => {
    const { app, workers } = mountFindApp()
    const store = useDocumentStore(pinia)
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    store.setCursor(50)
    await openFind(app)
    await typeTerm(app, '2A')
    await pressEnter(app, true)

    const worker = workers[0]!
    const reqId = sentRequests(worker)[0]!.reqId
    resolveSearch(worker, reqId, [10, 42])
    await flushPromises()

    expect(store.selection).toEqual({ anchor: 42, focus: 42 })
  })

  it('a second Next/Previous for the same term reuses the cached result — no second job', async () => {
    const { app, workers } = mountFindApp()
    const store = useDocumentStore(pinia)
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    await openFind(app)
    await typeTerm(app, '2A')
    await pressEnter(app)

    const worker = workers[0]!
    resolveSearch(worker, sentRequests(worker)[0]!.reqId, [10, 42])
    await flushPromises()
    expect(store.selection).toEqual({ anchor: 10, focus: 10 })

    await pressEnter(app) // Next again, same term
    expect(sentRequests(worker)).toHaveLength(1) // no second dispatch
    expect(store.selection).toEqual({ anchor: 42, focus: 42 })
  })

  it('wraps silently at EOF/BOF, showing the shared status message', async () => {
    const { app, workers } = mountFindApp()
    const store = useDocumentStore(pinia)
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    store.setCursor(42)
    await openFind(app)
    await typeTerm(app, '2A')
    await pressEnter(app)

    const worker = workers[0]!
    resolveSearch(worker, sentRequests(worker)[0]!.reqId, [42]) // the only match is under the Cursor
    await flushPromises()

    expect(store.selection).toEqual({ anchor: 42, focus: 42 })
    expect(app.find('#find-box-status').text()).toMatch(/wrapped to start of file/i)
  })

  it('shows "No match found" when the scan comes back empty, never alongside the wrap message', async () => {
    const { app, workers } = mountFindApp()
    await openForSearch(app, [1, 2, 3, 4])
    await openFind(app)
    await typeTerm(app, 'FF')
    await pressEnter(app)

    const worker = workers[0]!
    resolveSearch(worker, sentRequests(worker)[0]!.reqId, [])
    await flushPromises()

    const status = app.find('#find-box-status').text()
    expect(status).toMatch(/no match found/i)
    expect(status).not.toMatch(/wrapped/i)
  })

  it('a same-term Next while a job is in flight is a no-op — no second job dispatched', async () => {
    const { app, workers } = mountFindApp()
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    await openFind(app)
    await typeTerm(app, '2A')
    await pressEnter(app)
    await pressEnter(app) // same term, still pending

    expect(sentRequests(workers[0]!)).toHaveLength(1)
    expect(app.find('.find-box__cancel').exists()).toBe(true) // still spinning
  })

  it('a different term cancels the running job and starts a new one', async () => {
    const { app, workers } = mountFindApp()
    const store = useDocumentStore(pinia)
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    await openFind(app)
    await typeTerm(app, '2A')
    await pressEnter(app)
    const worker = workers[0]!
    const firstReqId = sentRequests(worker)[0]!.reqId

    await typeTerm(app, '01') // a different term while the first is still in flight
    await pressEnter(app)

    expect(sentCancels(worker).map((c) => c.reqId)).toContain(firstReqId)
    const reqs = sentRequests(worker)
    expect(reqs).toHaveLength(2)
    expect(reqs[1]!.params.pattern).toEqual(Uint8Array.of(0x01))

    // The superseded job's late result must not move the Cursor.
    resolveSearch(worker, firstReqId, [42])
    await flushPromises()
    expect(store.selection).toBeNull()

    resolveSearch(worker, reqs[1]!.reqId, [1])
    await flushPromises()
    expect(store.selection).toEqual({ anchor: 1, focus: 1 })
  })

  it('Cancel actually stops the job — the spinner clears and the Cursor does not move', async () => {
    const { app, workers } = mountFindApp()
    const store = useDocumentStore(pinia)
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    await openFind(app)
    await typeTerm(app, '2A')
    await pressEnter(app)
    const worker = workers[0]!
    const reqId = sentRequests(worker)[0]!.reqId

    await app.find('.find-box__cancel').trigger('click')
    await flushPromises()

    expect(sentCancels(worker).map((c) => c.reqId)).toContain(reqId)
    expect(app.find('.find-box__cancel').exists()).toBe(false)

    // A late result for the cancelled job must not resurrect it.
    resolveSearch(worker, reqId, [42])
    await flushPromises()
    expect(store.selection).toBeNull()
  })

  it('the term survives closing and reopening the box within the same session', async () => {
    const { app } = mountFindApp()
    await openForSearch(app, [1, 2, 3, 4])
    await openFind(app)
    await typeTerm(app, '4D5A')

    await app.find('.find-box').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    await openFind(app)

    expect((app.find('#find-box-input').element as HTMLInputElement).value).toBe('4D5A')
  })

  it('a new document opening terminates the previous document’s worker', async () => {
    const { app, workers } = mountFindApp()
    await openForSearch(app, [1, 2, 3, 4], 'a.bin')
    await openForSearch(app, [5, 6, 7, 8], 'b.bin')

    expect(workers).toHaveLength(2)
    expect(workers[0]!.terminateCalls).toBe(1)
  })

  it('the term does not survive an unrelated document being opened next', async () => {
    const { app } = mountFindApp()
    await openForSearch(app, [1, 2, 3, 4], 'a.bin')
    await openFind(app)
    await typeTerm(app, '4D5A')

    await openForSearch(app, [5, 6, 7, 8], 'b.bin') // a genuinely different file, not a reopen

    await openFind(app)
    expect((app.find('#find-box-input').element as HTMLInputElement).value).toBe('')
  })

  it('editing the term mid-scan cancels the stale job — its late result must not move the Cursor', async () => {
    const { app, workers } = mountFindApp()
    const store = useDocumentStore(pinia)
    await openForSearch(
      app,
      Array.from({ length: 64 }, (_u, i) => i),
    )
    await openFind(app)
    await typeTerm(app, '2A')
    await pressEnter(app) // dispatches, does not resolve yet
    const worker = workers[0]!
    const firstReqId = sentRequests(worker)[0]!.reqId

    // The reader retypes the term but never presses Enter/Shift+Enter again.
    await typeTerm(app, 'FF')
    await flushPromises()

    expect(sentCancels(worker).map((c) => c.reqId)).toContain(firstReqId)
    expect(app.find('.find-box__cancel').exists()).toBe(false) // no job in flight any more

    // The abandoned "2A" job's result arrives late regardless — it must not
    // move the Cursor for a term the box no longer shows.
    resolveSearch(worker, firstReqId, [42])
    await flushPromises()
    expect(store.selection).toBeNull()
  })
})
