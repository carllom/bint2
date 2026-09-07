import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { byteSourceFactoryKey } from '@/byteSourceFactory'
import type { ByteSource } from '@/core'
import { FileByteSource, toAddress } from '@/core'
import { useDocumentStore } from '@/stores/document'
import HomeView from '@/views/HomeView.vue'

function fileOf(bytes: number[] | Uint8Array, name = 'test.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

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
