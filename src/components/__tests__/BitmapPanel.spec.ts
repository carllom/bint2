import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ByteSourceError, FileByteSource, packBitmap, rowByteSpan } from '@/core'
import type { ByteSource, PackBitmapParams, PackedBitmap } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'
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

/** Open a document and open the Bitmap accordion section. */
async function openWithBitmap(source: ByteSource, name = 'pattern.bin'): Promise<void> {
  useDocumentStore(pinia).open(source, name)
  await flushPromises()
  await wrapper!.findAll('button.accordion-trigger')[1]!.trigger('click') // Bitmap is second
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
