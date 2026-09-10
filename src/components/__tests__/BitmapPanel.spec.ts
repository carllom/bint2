import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ByteSourceError, FileByteSource, packBitmap, rowByteSpan } from '@/core'
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

/** Click the Bitmap accordion trigger — closes the section when open, reopens it
 *  when closed. `unmount-on-hide` means a close destroys `BitmapPanel`. */
async function toggleBitmapSection(app: VueWrapper): Promise<void> {
  await app.findAll('button.accordion-trigger')[1]!.trigger('click')
  await flushPromises()
}

const statusText = (app: VueWrapper): string =>
  app.find('[data-field="bitmap-status"]').text()

const lockToggle = (app: VueWrapper) => app.find('[data-field="bitmap-lock-toggle"]')

const bitsOf = (app: VueWrapper): number[] => Array.from(frameOf(app)!.bits)

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

    const trigger = app.findAll('button.accordion-trigger')[1]!
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
