import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ByteSourceError, eofByteSlots, FileByteSource, packBitmap, rowByteSpan } from '@/core'
import type { ByteSource, PackBitmapParams, PackedBitmap } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { PREFERENCES_STORAGE_KEY, usePreferencesStore } from '@/stores/preferences'
import { useBitmapStore } from '@/stores/bitmap'
import BitmapPanel from '@/components/BitmapPanel.vue'
import HomeView from '@/views/HomeView.vue'

// The Bitmap Panel in Follow mode (plan-phase1.75.md §4, #81), at the app-shell
// seam: HomeView mounted whole, a real file-backed source, the Bitmap section
// opened. happy-dom gives `<canvas>` no 2-D context, so the exact *pixels* are
// pinned by `src/core/__tests__/bitmap.spec.ts` (seam 2). Here we assert the
// **wiring** — Origin = Cursor, the reactive `Stride·(Height−1)+Width` span, the
// Width / Stride keys, Zoom upscale, invert, and the dead-source escalation.
// Geometry is read from the controls, the canvas attributes and the stores; the
// component exposes only `frame`, whose `bits` are the one non-DOM signal.

let pinia: Pinia
let wrapper: VueWrapper | null = null

/** `byte[i]` — deterministic, bit-varied, so a packed frame is a real fingerprint. */
const PATTERN: number[] = Array.from({ length: 4096 }, (_u, i) => (i * 37 + 11) & 0xff)

function mountApp(): VueWrapper {
  wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [pinia] } })
  return wrapper
}

function fileOf(bytes: number[], name = 'pattern.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

/** The Bitmap accordion trigger — the second section, after the Inspector. */
const bitmapTrigger = (app: VueWrapper) => app.findAll('button.accordion-trigger')[1]!

/** Open a document and open the Bitmap accordion section. */
async function openWithBitmap(source: ByteSource, name = 'pattern.bin'): Promise<void> {
  useDocumentStore(pinia).open(source, name)
  await flushPromises()
  await bitmapTrigger(wrapper!).trigger('click')
  await flushPromises()
}

// ── Reading the Panel's effective state back out of the DOM / stores ──────
const frameOf = (app: VueWrapper): PackedBitmap | null =>
  (app.findComponent(BitmapPanel).vm as unknown as { frame: PackedBitmap | null }).frame

const ctl = (app: VueWrapper, field: string) =>
  app.find(`[data-field="bitmap-${field}"]`).element as HTMLInputElement

/** The render params exactly as the Panel derives them, rebuilt from what a user
 *  can see: Width / Zoom / invert from the store, Stride and Height from the
 *  rendered control values, the span from `rowByteSpan`. */
function geometry(app: VueWrapper): {
  origin: number | null
  width: number
  stride: number
  height: number
  zoom: number
  invert: boolean
  span: number
  packParams: PackBitmapParams
} {
  const prefs = usePreferencesStore(pinia)
  const width = prefs.bitmapWidth
  const stride = Number(ctl(app, 'stride').value)
  const height = Number(ctl(app, 'height').value)
  const invert = prefs.bitmapInvert
  return {
    origin: useDocumentStore(pinia).selection?.focus ?? null,
    width,
    stride,
    height,
    zoom: prefs.bitmapZoom,
    invert,
    span: rowByteSpan({ width, stride, height }),
    packParams: { width, stride, height, invert },
  }
}

/** `PATTERN` as the byte run the Panel packs from `origin` over `span`. */
const windowAt = (origin: number, span: number): Uint8Array =>
  Uint8Array.from(PATTERN.slice(origin, origin + span))

function bitmapContainer(app: VueWrapper) {
  return app.find('[data-region="bitmap"]')
}

/** Click the Bitmap accordion trigger — closes the section when open, reopens it
 *  when closed. `unmount-on-hide` means a close destroys `BitmapPanel`. */
async function toggleBitmapSection(app: VueWrapper): Promise<void> {
  await bitmapTrigger(app).trigger('click')
  await flushPromises()
}

const statusText = (app: VueWrapper): string =>
  app.find('[data-field="bitmap-status"]').text()

const lockToggle = (app: VueWrapper) => app.find('[data-field="bitmap-lock-toggle"]')

const bitsOf = (app: VueWrapper): number[] => Array.from(frameOf(app)!.bits)

// ── The #83 render model, exposed because happy-dom's `<canvas>` has no 2-D
//    context so the painted pixels are unobservable (plan §7, §4.10). ────────
interface RenderModel {
  renderState: 'no-origin' | 'pending' | 'dead-salvage' | 'resident'
  eofMask: Uint8Array | null
  salvagedRows: boolean[] | null
}
const modelOf = (app: VueWrapper): RenderModel =>
  app.findComponent(BitmapPanel).vm as unknown as RenderModel

/** `readSync` always misses; every `read` is parked until {@link flushReads}
 *  releases it with the real `PATTERN` slice — lets a test watch the pending
 *  frame before the bytes land. */
class ParkedSource implements ByteSource {
  readonly size = PATTERN.length
  #parked: Array<{ offset: number; length: number; resolve: (b: Uint8Array) => void }> = []
  readSync(): Uint8Array | null {
    return null
  }
  read(offset: number, length: number): Promise<Uint8Array> {
    return new Promise((resolve) => this.#parked.push({ offset, length, resolve }))
  }
  prefetch(): void {}
  close(): void {}
  flushReads(): void {
    const queued = this.#parked
    this.#parked = []
    for (const { offset, length, resolve } of queued) {
      resolve(Uint8Array.from(PATTERN.slice(offset, Math.min(offset + length, this.size))))
    }
  }
}

/** A dead source: `readSync` still answers for the first `residentBytes` bytes
 *  (already-resident pages, ADR-0004), but every `read` rejects `source-gone`.
 *  Drives the one-time per-row salvage sweep (plan §4.10). */
class DeadSource implements ByteSource {
  readonly size = PATTERN.length
  constructor(private readonly residentBytes: number) {}
  readSync(offset: number, length: number): Uint8Array | null {
    if (offset < 0 || offset + length > this.residentBytes) {
      return null
    }
    return Uint8Array.from(PATTERN.slice(offset, offset + length))
  }
  read(): Promise<Uint8Array> {
    return Promise.reject(new ByteSourceError('source-gone'))
  }
  prefetch(): void {}
  close(): void {}
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

describe('the Bitmap Panel — no Cursor yet (plan §4.4)', () => {
  it('shows the muted hint and no canvas, and the keys are inert', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))

    expect(app.find('[data-field="bitmap-no-cursor"]').exists()).toBe(true)
    expect(app.find('[data-field="bitmap-canvas"]').exists()).toBe(false)
    expect(frameOf(app)).toBeNull()

    const before = usePreferencesStore(pinia).bitmapWidth
    await bitmapContainer(app).trigger('keydown', { code: 'Period' })
    await bitmapContainer(app).trigger('keydown', { code: 'Comma', shiftKey: true })
    expect(usePreferencesStore(pinia).bitmapWidth).toBe(before)
  })
})

describe('the Bitmap Panel — Follow-mode render (plan §4.4, §4.7)', () => {
  it('packs the byte window at the Cursor to the expected pixels', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    const g = geometry(app)
    const frame = frameOf(app)
    expect(g.origin).toBe(0)
    expect(frame).not.toBeNull()
    // Canvas intrinsic size is Height rows × Width·8 px.
    expect([frame!.w, frame!.h]).toEqual([g.width * 8, g.height])

    const expected = packBitmap(windowAt(0, g.span), g.packParams)
    expect(Array.from(frame!.bits)).toEqual(Array.from(expected.bits))
  })

  it('slides the image exactly one byte when the Cursor byte-steps', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)

    store.setCursor(0)
    await flushPromises()
    const span = geometry(app).span

    store.setCursor(1)
    await flushPromises()
    const g = geometry(app)
    expect(g.origin).toBe(1)

    const shifted = packBitmap(windowAt(1, span), g.packParams)
    expect(Array.from(frameOf(app)!.bits)).toEqual(Array.from(shifted.bits))
  })

  it('sizes the canvas buffer to the frame and marks it decorative', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    const frame = frameOf(app)!
    const cv = app.find('[data-field="bitmap-canvas"]')
    expect(cv.attributes('width')).toBe(String(frame.w))
    expect(cv.attributes('height')).toBe(String(frame.h))
    // Decorative — the Cursor live region carries the linkage (ADR-0005).
    expect(cv.attributes('aria-hidden')).toBe('true')
  })
})

describe('the Bitmap Panel — Width / Stride keys (plan §4.5)', () => {
  it('Comma / Period change Width and re-pack; the span follows', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    const prefs = usePreferencesStore(pinia)
    const startWidth = prefs.bitmapWidth

    await bitmapContainer(app).trigger('keydown', { code: 'Period' })
    expect(prefs.bitmapWidth).toBe(startWidth + 1)
    await flushPromises()
    const g = geometry(app)
    expect(frameOf(app)!.w).toBe((startWidth + 1) * 8)
    expect(g.span).toBe(rowByteSpan({ width: startWidth + 1, stride: g.stride, height: g.height }))

    await bitmapContainer(app).trigger('keydown', { code: 'Comma' })
    expect(prefs.bitmapWidth).toBe(startWidth)
  })

  it('Shift+Comma / Shift+Period step bitmapStrideOffset, clamped at 0', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    const prefs = usePreferencesStore(pinia)
    expect(prefs.bitmapStrideOffset).toBe(0)

    // Already at the Stride ≥ Width floor — Shift+Comma cannot go lower.
    await bitmapContainer(app).trigger('keydown', { code: 'Comma', shiftKey: true })
    expect(prefs.bitmapStrideOffset).toBe(0)
    await flushPromises()
    expect(geometry(app).stride).toBe(prefs.bitmapWidth)

    await bitmapContainer(app).trigger('keydown', { code: 'Period', shiftKey: true })
    expect(prefs.bitmapStrideOffset).toBe(1)
    await flushPromises()
    expect(geometry(app).stride).toBe(prefs.bitmapWidth + 1)
  })

  it('restores the row layout when Width is raised then lowered (Stride tracks Width)', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    // A non-zero offset so Stride is genuinely derived, not incidentally equal.
    await bitmapContainer(app).trigger('keydown', { code: 'Period', shiftKey: true })
    await flushPromises()
    const strideBefore = geometry(app).stride
    const spanBefore = geometry(app).span

    await bitmapContainer(app).trigger('keydown', { code: 'Period' }) // Width +1
    await flushPromises()
    expect(geometry(app).stride).toBe(strideBefore + 1) // Stride rose with Width

    await bitmapContainer(app).trigger('keydown', { code: 'Comma' }) // Width −1
    await flushPromises()
    expect(geometry(app).stride).toBe(strideBefore) // …and fell back
    expect(geometry(app).span).toBe(spanBefore)
  })

  it('does not steal a "." typed into a control input', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    const prefs = usePreferencesStore(pinia)
    const startWidth = prefs.bitmapWidth

    await app.find('[data-field="bitmap-width"]').trigger('keydown', { code: 'Period' })
    expect(prefs.bitmapWidth).toBe(startWidth)
  })
})

describe('the Bitmap Panel — Zoom and invert (plan §4.2, §4.3)', () => {
  it('Zoom upscales the canvas by exact integer multiples, intrinsic size unchanged', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    const prefs = usePreferencesStore(pinia)
    const frame = frameOf(app)!
    const cv = () => app.find('[data-field="bitmap-canvas"]')

    expect(cv().attributes('style')).toContain(`width: ${frame.w * prefs.bitmapZoom}px`)
    expect(cv().attributes('style')).toContain(`height: ${frame.h * prefs.bitmapZoom}px`)
    expect(cv().attributes('style')).toContain('image-rendering: pixelated')

    prefs.setBitmapZoom(3)
    await flushPromises()
    expect(cv().attributes('style')).toContain(`width: ${frame.w * 3}px`)
    expect(cv().attributes('width')).toBe(String(frame.w)) // intrinsic buffer unchanged
  })

  it('invert flips every bit value and changes no geometry', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()
    const prefs = usePreferencesStore(pinia)

    const plain = frameOf(app)!
    const plainBits = Array.from(plain.bits)

    prefs.setBitmapInvert(true)
    await flushPromises()
    const flipped = frameOf(app)!

    expect([flipped.w, flipped.h]).toEqual([plain.w, plain.h])
    expect(Array.from(flipped.bits)).toEqual(plainBits.map((b) => 1 - b))
  })
})

describe('the Bitmap Panel — the read path (plan §4.6, #66)', () => {
  it('reads a normal paged span at the Origin — never a prefetch, never oversized', async () => {
    const reads: Array<[number, number]> = []
    const prefetches: number[] = []
    const source: ByteSource = {
      size: 2_000_000_000,
      read(offset: number, length: number): Promise<Uint8Array> {
        reads.push([offset, length])
        return Promise.resolve(Uint8Array.from({ length }, (_u, i) => (offset + i) & 0xff))
      },
      readSync: () => null,
      prefetch(offset: number): void {
        prefetches.push(offset)
      },
      close: () => {},
    }

    const app = mountApp()
    await openWithBitmap(source, 'huge.bin')
    useDocumentStore(pinia).setCursor(1000)
    await flushPromises()

    const span = geometry(app).span
    expect(reads).toContainEqual([1000, span])
    expect(span).toBeLessThan(1024 * 1024) // far under the Direct-read threshold
    // The Bitmap never prefetches its own span — only HexViewer warms the
    // Viewport (offset 0 here).
    expect(prefetches).not.toContain(1000)
  })

  it('raises the dead-source banner once on a source-gone rejection', async () => {
    const source: ByteSource = {
      size: 2_000_000_000,
      read: () => Promise.reject(new ByteSourceError('source-gone')),
      readSync: () => null,
      prefetch: () => {},
      close: () => {},
    }

    mountApp()
    await openWithBitmap(source, 'gone.bin')
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    expect(useDocumentStore(pinia).sourceHealth).toBe('gone')
  })
})

describe('the Bitmap Panel — the Height control (plan §4.2)', () => {
  it('takes a sticky Height edit and re-spans; clamps to the 32–4096 band', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    const input = app.find('[data-field="bitmap-height"]')
    ;(input.element as HTMLInputElement).value = '40'
    await input.trigger('change')
    await flushPromises()

    const g = geometry(app)
    expect(g.height).toBe(40)
    expect(frameOf(app)!.h).toBe(40)
    expect(g.span).toBe(rowByteSpan({ width: g.width, stride: g.stride, height: 40 }))
    expect(usePreferencesStore(pinia).bitmapHeight).toBe(40)

    ;(input.element as HTMLInputElement).value = '5'
    await input.trigger('change')
    expect(usePreferencesStore(pinia).bitmapHeight).toBe(32) // clamped up to the floor
  })
})

describe('the Bitmap Panel — lock the Origin (plan §4.4, ADR-0008)', () => {
  it('L freezes the Origin at the Cursor and the render stops tracking it', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)
    store.setCursor(100)
    await flushPromises()

    const locked = bitsOf(app)
    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    await flushPromises()

    expect(useBitmapStore(pinia).originLocked).toBe(true)
    expect(useBitmapStore(pinia).lockedOffset).toBe(100)
    expect(statusText(app)).toBe('Locked · 0x64')

    // The Cursor moves anywhere — near, far, off the end — and nothing changes.
    store.setCursor(2000)
    await flushPromises()
    expect(bitsOf(app)).toEqual(locked)
    store.setCursor(4096)
    await flushPromises()
    expect(bitsOf(app)).toEqual(locked)
  })

  it('L again snaps the Origin to the Cursor’s current offset and resumes Follow', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)
    store.setCursor(100)
    await flushPromises()

    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    store.setCursor(300) // moved while locked
    await flushPromises()
    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    await flushPromises()

    expect(useBitmapStore(pinia).originLocked).toBe(false)
    expect(useBitmapStore(pinia).lockedOffset).toBeNull()
    expect(statusText(app)).toBe('Following cursor')

    const g = geometry(app)
    expect(g.origin).toBe(300)
    const expected = packBitmap(windowAt(300, g.span), g.packParams)
    expect(bitsOf(app)).toEqual(Array.from(expected.bits))
  })

  it('the header toggle locks and follows just like the L key', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0x2a)
    await flushPromises()

    expect(lockToggle(app).text()).toBe('Lock Origin')
    await lockToggle(app).trigger('click')
    await flushPromises()
    expect(useBitmapStore(pinia).originLocked).toBe(true)
    expect(statusText(app)).toBe('Locked · 0x2A')
    expect(lockToggle(app).text()).toBe('Follow Cursor')

    await lockToggle(app).trigger('click')
    await flushPromises()
    expect(useBitmapStore(pinia).originLocked).toBe(false)
    expect(statusText(app)).toBe('Following cursor')
  })

  it('Lock is unavailable with no Cursor — no toggle, L inert', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))

    expect(lockToggle(app).exists()).toBe(false)
    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    expect(useBitmapStore(pinia).originLocked).toBe(false)
  })

  it('keeps the lock (mode + offset) across closing and reopening the section', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(512)
    await flushPromises()
    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    await flushPromises()
    const locked = bitsOf(app)

    await toggleBitmapSection(app) // close — BitmapPanel unmounts
    expect(app.findComponent(BitmapPanel).exists()).toBe(false)
    await toggleBitmapSection(app) // reopen — fresh mount

    expect(useBitmapStore(pinia).originLocked).toBe(true)
    expect(useBitmapStore(pinia).lockedOffset).toBe(512)
    expect(statusText(app)).toBe('Locked · 0x200')
    expect(bitsOf(app)).toEqual(locked)
  })
})

describe('the Bitmap Panel — Origin nudge keys (plan §4.5)', () => {
  async function lockedAt(app: VueWrapper, offset: number): Promise<void> {
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(offset)
    await flushPromises()
    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    await flushPromises()
  }

  /** Assert the frame equals the packed window at `origin`, and the Cursor never moved. */
  function expectOriginAt(app: VueWrapper, origin: number, cursorStayedAt: number): void {
    const g = geometry(app)
    const expected = packBitmap(windowAt(origin, g.span), g.packParams)
    expect(bitsOf(app)).toEqual(Array.from(expected.bits))
    expect(useDocumentStore(pinia).selection?.focus).toBe(cursorStayedAt)
    expect(useBitmapStore(pinia).lockedOffset).toBe(origin)
  }

  it('←/→ nudge the Origin by ∓1 byte without moving the Cursor', async () => {
    const app = mountApp()
    await lockedAt(app, 1000)

    await bitmapContainer(app).trigger('keydown', { code: 'ArrowRight' })
    await flushPromises()
    expectOriginAt(app, 1001, 1000)

    await bitmapContainer(app).trigger('keydown', { code: 'ArrowLeft' })
    await bitmapContainer(app).trigger('keydown', { code: 'ArrowLeft' })
    await flushPromises()
    expectOriginAt(app, 999, 1000)
  })

  it('↑/↓ nudge the Origin by ∓ one Stride (one bitmap row)', async () => {
    const app = mountApp()
    await lockedAt(app, 1000)
    const stride = geometry(app).stride

    await bitmapContainer(app).trigger('keydown', { code: 'ArrowDown' })
    await flushPromises()
    expectOriginAt(app, 1000 + stride, 1000)

    await bitmapContainer(app).trigger('keydown', { code: 'ArrowUp' })
    await flushPromises()
    expectOriginAt(app, 1000, 1000)
  })

  it('PageUp/PageDown nudge by ∓ (Stride × visible rows)', async () => {
    const app = mountApp()
    await lockedAt(app, 1500)
    const { stride, height } = geometry(app)
    const page = stride * height

    await bitmapContainer(app).trigger('keydown', { code: 'PageDown' })
    await flushPromises()
    expectOriginAt(app, 1500 + page, 1500)

    await bitmapContainer(app).trigger('keydown', { code: 'PageUp' })
    await flushPromises()
    expectOriginAt(app, 1500, 1500)
  })

  it('Home → 0, End → size (clamped to size, not size − 1)', async () => {
    const app = mountApp()
    await lockedAt(app, 1000)

    await bitmapContainer(app).trigger('keydown', { code: 'Home' })
    await flushPromises()
    expectOriginAt(app, 0, 1000)
    expect(statusText(app)).toBe('Locked · 0x00')

    await bitmapContainer(app).trigger('keydown', { code: 'End' })
    await flushPromises()
    expect(useBitmapStore(pinia).lockedOffset).toBe(PATTERN.length)
    expect(useDocumentStore(pinia).selection?.focus).toBe(1000)
  })

  it('nudges clamp to [0, size] — ← at 0 stays, → past size stops at size', async () => {
    const app = mountApp()
    await lockedAt(app, 0)

    await bitmapContainer(app).trigger('keydown', { code: 'ArrowLeft' })
    await flushPromises()
    expect(useBitmapStore(pinia).lockedOffset).toBe(0)
  })

  it('the arrow / page keys are inert in Follow mode', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(1000)
    await flushPromises()
    const following = bitsOf(app)

    for (const code of ['ArrowRight', 'ArrowUp', 'PageDown', 'Home', 'End']) {
      await bitmapContainer(app).trigger('keydown', { code })
    }
    await flushPromises()
    expect(useDocumentStore(pinia).selection?.focus).toBe(1000)
    expect(bitsOf(app)).toEqual(following)
  })

  it('does not arm on accordion-trigger focus', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(1000)
    await flushPromises()
    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' }) // lock first
    await flushPromises()
    const locked = bitsOf(app)

    const trigger = bitmapTrigger(app)
    await trigger.trigger('keydown', { code: 'ArrowRight' })
    await trigger.trigger('keydown', { code: 'KeyL' })
    await flushPromises()

    expect(useBitmapStore(pinia).originLocked).toBe(true)
    expect(bitsOf(app)).toEqual(locked)
  })

  it('writes nothing about the mode or the offset to preferences', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(1000)
    await flushPromises()
    const before = localStorage.getItem(PREFERENCES_STORAGE_KEY)

    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    await bitmapContainer(app).trigger('keydown', { code: 'ArrowRight' })
    await bitmapContainer(app).trigger('keydown', { code: 'PageDown' })
    await flushPromises()

    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBe(before)
    const persisted = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}')
    expect(Object.keys(persisted)).not.toContain('originLocked')
    expect(Object.keys(persisted)).not.toContain('lockedOffset')
  })
})

describe('the Bitmap Panel — EOF / pending / dead-source rendering (plan §4.10, #83)', () => {
  /** The canvas intrinsic buffer, read straight off the element attributes. */
  const canvasSize = (app: VueWrapper): [number, number] => {
    const cv = app.find('[data-field="bitmap-canvas"]')
    return [Number(cv.attributes('width')), Number(cv.attributes('height'))]
  }

  it('keeps the canvas at Height × Width·8 px however little of the span is available', async () => {
    const app = mountApp()
    const parked = new ParkedSource()
    await openWithBitmap(parked, 'parked.bin')
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    const { width, height } = geometry(app)
    // Pending — not one byte resident — and the buffer is still the full frame.
    expect(modelOf(app).renderState).toBe('pending')
    expect(canvasSize(app)).toEqual([width * 8, height])

    parked.flushReads()
    await flushPromises()
    expect(modelOf(app).renderState).toBe('resident')
    expect(canvasSize(app)).toEqual([width * 8, height]) // unchanged by the arrival
  })

  it('marks the past-EOF byte-slots per-slot across a straddling row, independent of invert', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    // PATTERN is 4096 bytes; a Cursor near the end makes the span straddle size.
    const near = PATTERN.length - 100
    useDocumentStore(pinia).setCursor(near)
    await flushPromises()

    const g = geometry(app)
    const model = modelOf(app)
    expect(model.renderState).toBe('resident')

    const expectedMask = eofByteSlots({
      origin: near,
      width: g.width,
      stride: g.stride,
      height: g.height,
      size: PATTERN.length,
    })
    expect(Array.from(model.eofMask!)).toEqual(Array.from(expectedMask))
    // A genuine straddle: some slots before EOF, some past.
    expect(Array.from(model.eofMask!)).toContain(0)
    expect(Array.from(model.eofMask!)).toContain(1)
    // The packed data pass still holds the full canvas geometry.
    expect(canvasSize(app)).toEqual([g.width * 8, g.height])
    expect([frameOf(app)!.w, frameOf(app)!.h]).toEqual([g.width * 8, g.height])

    // invert is a colour-only change (plan §4.3) — the EOF region is chrome and
    // its slot map does not move.
    usePreferencesStore(pinia).setBitmapInvert(true)
    await flushPromises()
    expect(Array.from(modelOf(app).eofMask!)).toEqual(Array.from(expectedMask))
  })

  it('has no EOF mask when the whole Extent sits before size', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0) // span 256 ≪ 4096
    await flushPromises()

    expect(modelOf(app).renderState).toBe('resident')
    expect(modelOf(app).eofMask).toBeNull()
  })

  it('whole-canvas EOF fill once the Origin sits at size (End clamps there)', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(1000)
    await flushPromises()
    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    await bitmapContainer(app).trigger('keydown', { code: 'End' })
    await flushPromises()

    expect(useBitmapStore(pinia).lockedOffset).toBe(PATTERN.length)
    const mask = modelOf(app).eofMask!
    expect(mask.length).toBeGreaterThan(0)
    expect(Array.from(mask).every((v) => v === 1)).toBe(true)
  })

  it('a not-yet-resident span is whole-canvas pending, then repaints on arrival', async () => {
    const app = mountApp()
    const parked = new ParkedSource()
    await openWithBitmap(parked, 'parked.bin')
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    expect(modelOf(app).renderState).toBe('pending')
    expect(modelOf(app).salvagedRows).toBeNull() // per-row painting is dead-source only
    expect(bitsOf(app).every((b) => b === 0)).toBe(true) // no packed pixels yet

    parked.flushReads()
    await flushPromises()
    expect(modelOf(app).renderState).toBe('resident')
    const g = geometry(app)
    const expected = packBitmap(windowAt(0, g.span), g.packParams)
    expect(bitsOf(app)).toEqual(Array.from(expected.bits))
  })

  it('clears the canvas when the span moves onto non-resident bytes — never holds the last frame', async () => {
    const app = mountApp()
    const parked = new ParkedSource()
    await openWithBitmap(parked, 'parked.bin')
    const store = useDocumentStore(pinia)

    store.setCursor(0)
    await flushPromises()
    parked.flushReads()
    await flushPromises()
    expect(modelOf(app).renderState).toBe('resident')
    const residentBits = bitsOf(app)
    expect(residentBits.some((b) => b === 1)).toBe(true)

    // Move onto a fresh, non-resident span: the frame must clear, not hold.
    store.setCursor(2000)
    await flushPromises()
    expect(modelOf(app).renderState).toBe('pending')
    expect(bitsOf(app).every((b) => b === 0)).toBe(true)
    expect(bitsOf(app)).not.toEqual(residentBits)

    parked.flushReads()
    await flushPromises()
    expect(modelOf(app).renderState).toBe('resident')
  })

  it('source-gone → a one-time per-row readSync sweep, resident rows packed, the rest blank, banner once', async () => {
    const app = mountApp()
    // 40 bytes resident = 10 rows at Width 4 / Stride 4; the read then rejects.
    await openWithBitmap(new DeadSource(40), 'gone.bin')
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    expect(useDocumentStore(pinia).sourceHealth).toBe('gone')
    const model = modelOf(app)
    expect(model.renderState).toBe('dead-salvage')

    const rows = model.salvagedRows!
    const g = geometry(app)
    expect(rows).toHaveLength(g.height)
    expect(rows.slice(0, 10).every(Boolean)).toBe(true) // resident → packed
    expect(rows.slice(10).every((r) => r === false)).toBe(true) // the rest → blank, permanently
    expect(canvasSize(app)).toEqual([g.width * 8, g.height]) // still the full canvas
  })

  it('does not salvage per-row when the whole span is still resident on a dead source', async () => {
    const app = mountApp()
    // Everything the span needs is resident, so readSync serves it whole and the
    // render is a normal packed frame — the salvage sweep never runs.
    await openWithBitmap(new DeadSource(PATTERN.length), 'gone.bin')
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    expect(modelOf(app).renderState).toBe('resident')
    expect(modelOf(app).salvagedRows).toBeNull()
    const g = geometry(app)
    const expected = packBitmap(windowAt(0, g.span), g.packParams)
    expect(bitsOf(app)).toEqual(Array.from(expected.bits))
  })

  it('empty document → the "No Cursor yet" hint and no canvas, no fill states', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf([], 'empty.bin')), 'empty.bin')

    expect(app.find('[data-field="bitmap-no-cursor"]').exists()).toBe(true)
    expect(app.find('[data-field="bitmap-canvas"]').exists()).toBe(false)
    expect(modelOf(app).renderState).toBe('no-origin')
    expect(modelOf(app).eofMask).toBeNull()
  })
})

// ── Bitmap <-> hex linkage: the Extent marker + click-to-cursor (plan
//    §4.8 / §4.9, ADR-0011, #84) ────────────────────────────────────────────
// HomeView whole, so the Bitmap Panel (Sidebar) and the passive Extent overlay
// (inside `.hex-viewer__row-area`) are both live. happy-dom leaves HexViewer on
// its pre-measurement fallbacks — rowPx 18, viewportPx 720 → 40 rows fit — and
// gives `<canvas>` a 0-size box, so the canvas rect is stubbed for the click math.

const extentMarker = (app: VueWrapper) => app.find('.hex-viewer__row-area .extent-marker')
const extentBand = (app: VueWrapper) => app.find('[data-field="extent-band"]')
const extentChevron = (app: VueWrapper) => app.find('[data-field="extent-chevron"]')

/** Give the Bitmap canvas a concrete box so `bitmapOffsetAt` has real coords.
 *  The canvas is `Width*8 x Height` intrinsic px, drawn at `Zoom` — default
 *  4*8 x 64 at Zoom 2 -> 64 x 128 CSS px, top-left at the origin. */
function stubCanvasRect(app: VueWrapper, zoom = 2): void {
  const el = app.find('[data-field="bitmap-canvas"]').element as HTMLElement
  const width = 4 * 8 * zoom
  const height = 64 * zoom
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON() {},
    }),
  })
}

/** Client point for intrinsic pixel (col, row) at the given Zoom. */
const pixelPoint = (col: number, row: number, zoom = 2) => ({
  clientX: col * zoom + 1,
  clientY: row * zoom + 1,
})

async function lockAt(app: VueWrapper, offset: number): Promise<void> {
  useDocumentStore(pinia).setCursor(offset)
  await flushPromises()
  await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
  await flushPromises()
}

describe('the Extent marker — a locked run in the hex gutter (plan §4.8, ADR-0011)', () => {
  it('appears only while locked AND the Panel is mounted; gone in Follow; returns on reopen', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    useDocumentStore(pinia).setCursor(0)
    await flushPromises()

    expect(extentMarker(app).exists()).toBe(false) // Follow — the linkage is the Cursor

    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' })
    await flushPromises()
    expect(extentBand(app).exists()).toBe(true)

    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' }) // Follow again
    await flushPromises()
    expect(extentMarker(app).exists()).toBe(false)

    await bitmapContainer(app).trigger('keydown', { code: 'KeyL' }) // lock again
    await flushPromises()
    expect(extentBand(app).exists()).toBe(true)

    await toggleBitmapSection(app) // close — BitmapPanel unmounts
    expect(app.findComponent(BitmapPanel).exists()).toBe(false)
    expect(extentMarker(app).exists()).toBe(false)

    await toggleBitmapSection(app) // reopen — the still-held lock brings it back
    expect(useBitmapStore(pinia).originLocked).toBe(true)
    expect(extentBand(app).exists()).toBe(true)
  })

  it('is a contiguous hull [Origin, Origin + Stride*(Height-1) + Width), positioned from the row height', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    usePreferencesStore(pinia).setBitmapHeight(48)
    usePreferencesStore(pinia).setBitmapStrideOffset(4) // Stride 8 — a gappy run, solid hull
    await flushPromises()
    await lockAt(app, 16) // row 1 at 16 bpr

    const span = rowByteSpan({ width: 4, stride: 8, height: 48 }) // 8*47 + 4 = 380
    expect(useBitmapStore(pinia).extent).toEqual({ start: 16, end: 16 + span })

    // firstRow 1, lastRow = floor((16 + 380 - 1) / 16) = 24 → 24 rows tall, one down.
    expect(extentBand(app).attributes('style')).toContain('top: 18px')
    expect(extentBand(app).attributes('style')).toContain(`height: ${24 * 18}px`)
  })

  it('shows an off-screen chevron that scrolls the grid to the Extent first row', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)
    await lockAt(app, 100 * 16) // row 100 — far below the 40 rows on screen

    expect(store.topByteOffset).toBe(0)
    expect(extentBand(app).exists()).toBe(false)
    expect(extentChevron(app).text()).toBe('▼')

    await extentChevron(app).trigger('click')
    expect(store.topByteOffset).toBe(100 * 16)
  })

  it('is decorative — aria-hidden, no live region — and a sibling of the grid, not a wrapper', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    await lockAt(app, 0)

    expect(extentMarker(app).attributes('aria-hidden')).toBe('true')
    expect(extentMarker(app).find('[aria-live]').exists()).toBe(false)
    // `pointer-events: none` on the band keeps byte clicks landing on the cells
    // beneath — structurally, the overlay sits beside the grid, not around it.
    expect(app.find('.hex-viewer__row-area > .extent-marker').exists()).toBe(true)
    expect(extentMarker(app).find('.hex-viewer__grid').exists()).toBe(false)
  })
})

describe('click-to-cursor — a Bitmap pixel drives the Cursor (plan §4.9)', () => {
  it('plain click → setCursor(Origin + row*Stride + floor(col/8)) then a reveal request', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)
    store.setCursor(100)
    await flushPromises()
    stubCanvasRect(app)

    // intrinsic pixel (col 1, row 3) → byte 0 of row 3 → 100 + 3*4 + 0.
    await app
      .find('[data-field="bitmap-canvas"]')
      .trigger('pointerdown', { button: 0, ...pixelPoint(1, 3) })

    expect(store.selection).toEqual({ anchor: 112, focus: 112 })
    expect(store.revealRequest?.offset).toBe(112)
  })

  it('Shift+click → extendSelectionTo(target)', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)
    store.setCursor(100)
    await flushPromises()
    stubCanvasRect(app)

    await app
      .find('[data-field="bitmap-canvas"]')
      .trigger('pointerdown', { button: 0, shiftKey: true, ...pixelPoint(9, 3) }) // col 9 → byte 1 → 113

    expect(store.selection).toEqual({ anchor: 100, focus: 113 })
  })

  it('works while locked — the Cursor jumps, the Origin and the render do not', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)
    await lockAt(app, 100)
    const lockedBits = bitsOf(app)
    stubCanvasRect(app)

    await app
      .find('[data-field="bitmap-canvas"]')
      .trigger('pointerdown', { button: 0, ...pixelPoint(1, 3) }) // 100 + 12 → 112, from the locked Origin

    expect(store.selection?.focus).toBe(112)
    expect(useBitmapStore(pinia).lockedOffset).toBe(100)
    expect(bitsOf(app)).toEqual(lockedBits)
  })

  it('is inert past EOF — no Cursor move, no reveal', async () => {
    const app = mountApp()
    await openWithBitmap(new FileByteSource(fileOf(PATTERN)))
    const store = useDocumentStore(pinia)
    store.setCursor(PATTERN.length - 6) // 4090; row 2 byte 0 → 4098 ≥ size
    await flushPromises()
    stubCanvasRect(app)

    await app
      .find('[data-field="bitmap-canvas"]')
      .trigger('pointerdown', { button: 0, ...pixelPoint(1, 2) })

    expect(store.selection?.focus).toBe(PATTERN.length - 6)
    expect(store.revealRequest).toBeNull()
  })

  it('is inert on non-resident pixels', async () => {
    const app = mountApp()
    const parked = new ParkedSource() // readSync always misses
    await openWithBitmap(parked, 'parked.bin')
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    await flushPromises()
    expect(modelOf(app).renderState).toBe('pending')
    stubCanvasRect(app)

    await app
      .find('[data-field="bitmap-canvas"]')
      .trigger('pointerdown', { button: 0, ...pixelPoint(1, 3) })

    expect(store.selection).toEqual({ anchor: 0, focus: 0 })
    expect(store.revealRequest).toBeNull()
  })
})
