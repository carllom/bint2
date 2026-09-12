import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { DerivedWorkClient, FileByteSource } from '@/core'
import type { DerivedWorkResponseMessage, DerivedWorkWorkerLike } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { PREFERENCES_STORAGE_KEY, usePreferencesStore } from '@/stores/preferences'
import { useEntropyStore } from '@/stores/entropy'
import HomeView from '@/views/HomeView.vue'

// The Entropy Panel's Map view (#107, CONTEXT.md, ADR-0012,
// plan-phase2.md §4), at the app-shell seam used by every other Panel spec:
// HomeView mounted whole, a real file-backed source, the Entropy section
// opened. Compute/Cancel are exercised against a hand-driven fake worker
// (mirrors `DerivedWorkClient.spec.ts`'s own); staleness and click-to-cursor
// are driven directly against `useEntropyStore` for the cases that don't need
// a real dispatch.

let pinia: Pinia
let wrapper: VueWrapper | null = null

class FakeWorker implements DerivedWorkWorkerLike {
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

interface SentStatsRequest {
  type: 'request'
  reqId: string
  kind: 'stats'
  params: { range: { start: number; end: number }; blockSize: number }
}

function statsRequests(worker: FakeWorker): SentStatsRequest[] {
  return worker.sent.filter(
    (m): m is SentStatsRequest =>
      typeof m === 'object' &&
      m !== null &&
      (m as { type?: string }).type === 'request' &&
      (m as { kind?: string }).kind === 'stats',
  )
}

function sentCancels(worker: FakeWorker): { type: 'cancel'; reqId: string }[] {
  return worker.sent.filter(
    (m): m is { type: 'cancel'; reqId: string } =>
      typeof m === 'object' && m !== null && (m as { type?: string }).type === 'cancel',
  )
}

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

/** Opens a document backed by a real `DerivedWorkClient` over a fake worker, for Compute/Cancel dispatch tests. */
async function openWithWorker(bytes: number[], name = 'test.bin'): Promise<FakeWorker> {
  const worker = new FakeWorker()
  const file = fileOf(bytes, name)
  const client = new DerivedWorkClient(file, { createWorker: () => worker })
  useDocumentStore(pinia).open(new FileByteSource(file), name, client)
  await flushPromises()
  return worker
}

/** The Entropy accordion trigger — third section, after Inspector/Bitmap. */
const entropyTrigger = (app: VueWrapper) => app.findAll('button.accordion-trigger')[2]!

async function openEntropySection(app: VueWrapper): Promise<void> {
  await entropyTrigger(app).trigger('click')
  await flushPromises()
}

function computeButton(app: VueWrapper) {
  return app.find('[data-field="entropy-compute"]')
}

function cancelButton(app: VueWrapper) {
  return app.find('[data-field="entropy-cancel"]')
}

/** Give the canvas a concrete CSS box so `entropyBlockAt` has real coords — a 100px-wide strip. */
function stubCanvasRect(app: VueWrapper, width = 100, height = 32): void {
  const el = app.find('[data-field="entropy-canvas"]').element as HTMLElement
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON() {} }),
  })
}

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the Entropy Panel — presence and persisted open state', () => {
  it('is hidden entirely when no document is open', () => {
    const app = mountApp()
    expect(app.find('[data-region="entropy"]').exists()).toBe(false)
  })

  it('slots into the accordion right after Bitmap, before Search results', async () => {
    const app = mountApp()
    await openBytes([1, 2, 3, 4])
    const triggers = app.findAll('button.accordion-trigger').map((t) => t.text())
    expect(triggers).toEqual(['Inspector', 'Bitmap', 'Entropy', 'Search results'])
  })

  it('opens/closes through the persisted entropyOpen boolean, like Inspector/Bitmap', async () => {
    const app = mountApp()
    await openBytes([1, 2, 3, 4])
    const preferences = usePreferencesStore(pinia)

    expect(preferences.entropyOpen).toBe(false)
    await openEntropySection(app)
    expect(preferences.entropyOpen).toBe(true)
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY)!).entropyOpen).toBe(true)
  })

  it('unmounts on close (`unmount-on-hide`)', async () => {
    const app = mountApp()
    await openBytes([1, 2, 3, 4])
    await openEntropySection(app)
    expect(app.find('[data-region="entropy"]').exists()).toBe(true)

    await entropyTrigger(app).trigger('click')
    await flushPromises()
    expect(app.find('[data-region="entropy"]').exists()).toBe(false)
  })
})

describe('the Entropy Panel — scope (plan §4.3)', () => {
  it('disables Selection scope with no non-collapsed Selection, and falls back to whole file', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)

    expect((app.find('.entropy__scope-selection').element as HTMLButtonElement).disabled).toBe(true)

    useDocumentStore(pinia).setCursor(5) // collapsed — still disabled
    await flushPromises()
    expect((app.find('.entropy__scope-selection').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables Selection scope once a non-collapsed Selection exists', async () => {
    const app = mountApp()
    await openBytes(Array.from({ length: 32 }, (_u, i) => i))
    const store = useDocumentStore(pinia)
    store.setCursor(2)
    store.extendSelectionTo(10)
    await openEntropySection(app)

    expect((app.find('.entropy__scope-selection').element as HTMLButtonElement).disabled).toBe(false)
    await app.find('.entropy__scope-selection').trigger('click')
    expect(useEntropyStore(pinia).scope).toBe('selection')
  })
})

describe('the Entropy Panel — Compute/Cancel dispatch (plan §4.2)', () => {
  it('Compute dispatches a stats job over the whole file by default', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)

    await computeButton(app).trigger('click')

    const reqs = statsRequests(worker)
    expect(reqs).toHaveLength(1)
    expect(reqs[0]!.params).toEqual({ range: { start: 0, end: 32 }, blockSize: 256 })
    expect(cancelButton(app).exists()).toBe(true) // spinner/Cancel while in flight
  })

  it('dispatches over the live Selection when scope is Selection', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    const store = useDocumentStore(pinia)
    store.setCursor(4)
    store.extendSelectionTo(9) // range [4, 10)
    await openEntropySection(app)
    await app.find('.entropy__scope-selection').trigger('click')

    await computeButton(app).trigger('click')

    expect(statsRequests(worker)[0]!.params.range).toEqual({ start: 4, end: 10 })
  })

  it('Cancel stops a running Compute and a late result is dropped', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await computeButton(app).trigger('click')

    const reqId = statsRequests(worker)[0]!.reqId
    await cancelButton(app).trigger('click')

    expect(sentCancels(worker)).toEqual([{ type: 'cancel', reqId }])
    expect(computeButton(app).exists()).toBe(true) // back to Compute, not Cancel

    worker.emit({
      reqId,
      kind: 'result',
      ok: true,
      result: { entropy: Float32Array.of(1, 2), histogram: new Uint32Array(256) },
    })
    await flushPromises()
    expect(app.find('[data-field="entropy-no-result"]').exists()).toBe(true) // still nothing rendered
  })

  it('populates the Map once the job resolves', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await computeButton(app).trigger('click')

    const reqId = statsRequests(worker)[0]!.reqId
    worker.emit({
      reqId,
      kind: 'result',
      ok: true,
      result: { entropy: Float32Array.of(0, 8), histogram: new Uint32Array(256) },
    })
    await flushPromises()

    expect(app.find('[data-field="entropy-no-result"]').exists()).toBe(false)
    expect(app.find('[data-field="entropy-canvas"]').attributes('width')).toBe('2')
  })

  it('the mode toggle never triggers a dispatch', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)

    await app.find('.entropy__mode-histogram').trigger('click')
    await app.find('.entropy__mode-map').trigger('click')

    expect(statsRequests(worker)).toHaveLength(0)
  })

  it('shows the Histogram placeholder without affecting a computed Map result', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await computeButton(app).trigger('click')
    const reqId = statsRequests(worker)[0]!.reqId
    worker.emit({
      reqId,
      kind: 'result',
      ok: true,
      result: { entropy: Float32Array.of(1, 2, 3), histogram: new Uint32Array(256) },
    })
    await flushPromises()

    await app.find('.entropy__mode-histogram').trigger('click')
    expect(app.find('[data-field="entropy-histogram-placeholder"]').exists()).toBe(true)
    expect(app.find('[data-field="entropy-canvas"]').exists()).toBe(false)

    await app.find('.entropy__mode-map').trigger('click')
    expect(app.find('[data-field="entropy-canvas"]').exists()).toBe(true)
  })
})

describe('the Entropy Panel — staleness (plan §4.3)', () => {
  /** Computes over the whole 32-byte file at whatever block size is currently in the control, and resolves it. */
  async function computeAndResolve(app: VueWrapper, worker: FakeWorker): Promise<void> {
    await computeButton(app).trigger('click')
    const reqId = statsRequests(worker)[0]!.reqId
    worker.emit({
      reqId,
      kind: 'result',
      ok: true,
      result: { entropy: Float32Array.of(1, 2, 3, 4), histogram: new Uint32Array(256) },
    })
    await flushPromises()
  }

  it('is not stale right after a matching compute', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await computeAndResolve(app, worker)

    expect(app.find('[data-field="entropy-status"]').exists()).toBe(false)
    expect(app.find('.entropy__map--stale').exists()).toBe(false)
  })

  it('changing the block size marks the result stale without clearing it', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await computeAndResolve(app, worker)

    await app.find('[data-field="entropy-block-size"]').setValue(128)

    expect(app.find('[data-field="entropy-status"]').text()).toMatch(/stale/i)
    expect(app.find('.entropy__map--stale').exists()).toBe(true)
    expect(app.find('[data-field="entropy-canvas"]').exists()).toBe(true) // not cleared
  })

  it('changing scope marks the result stale', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await computeAndResolve(app, worker)

    const store = useDocumentStore(pinia)
    store.setCursor(2)
    store.extendSelectionTo(10)
    await flushPromises()
    await app.find('.entropy__scope-selection').trigger('click')

    expect(app.find('[data-field="entropy-status"]').text()).toMatch(/stale/i)
  })

  it('changing the live Selection range while scoped to Selection marks the result stale', async () => {
    const app = mountApp()
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    store.extendSelectionTo(31) // range [0, 32)
    await openEntropySection(app)
    await app.find('.entropy__scope-selection').trigger('click')
    await computeAndResolve(app, worker)

    expect(app.find('[data-field="entropy-status"]').exists()).toBe(false) // matches — not stale

    store.extendSelectionTo(20) // range now [0, 21)
    await flushPromises()

    expect(app.find('[data-field="entropy-status"]').text()).toMatch(/stale/i)
  })
})

describe('the Entropy Panel — click-to-cursor on the strip (plan §4.4)', () => {
  async function computeOver32Bytes(app: VueWrapper, blockSize = 8): Promise<FakeWorker> {
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await app.find('[data-field="entropy-block-size"]').setValue(blockSize)
    await computeButton(app).trigger('click')
    const reqId = statsRequests(worker)[0]!.reqId
    worker.emit({
      reqId,
      kind: 'result',
      ok: true,
      result: { entropy: Float32Array.of(1, 2, 3, 4), histogram: new Uint32Array(256) },
    })
    await flushPromises()
    return worker
  }

  it('plain click -> setCursor at the block\'s first byte, then a reveal request', async () => {
    const app = mountApp()
    await computeOver32Bytes(app, 8) // 4 blocks of 8 bytes each: [0,8) [8,16) [16,24) [24,32)
    stubCanvasRect(app, 100)
    const store = useDocumentStore(pinia)

    // 100px / 4 blocks = 25px each; x=30 -> block 1 -> byte 8.
    await app.find('[data-field="entropy-canvas"]').trigger('pointerdown', { button: 0, clientX: 30, clientY: 5 })

    expect(store.selection).toEqual({ anchor: 8, focus: 8 })
    expect(store.revealRequest?.offset).toBe(8)
  })

  it('Shift+click -> extendSelectionTo the block\'s last byte, selecting the whole block', async () => {
    const app = mountApp()
    await computeOver32Bytes(app, 8)
    stubCanvasRect(app, 100)
    const store = useDocumentStore(pinia)

    await app
      .find('[data-field="entropy-canvas"]')
      .trigger('pointerdown', { button: 0, shiftKey: true, clientX: 30, clientY: 5 })

    expect(store.selection).toEqual({ anchor: 8, focus: 15 }) // block 1 = [8, 16)
    expect(store.revealRequest?.offset).toBe(8)
  })

  it('a click resets the anchor to the block start regardless of a prior unrelated Selection', async () => {
    const app = mountApp()
    await computeOver32Bytes(app, 8)
    stubCanvasRect(app, 100)
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    store.extendSelectionTo(2)

    await app
      .find('[data-field="entropy-canvas"]')
      .trigger('pointerdown', { button: 0, shiftKey: true, clientX: 80, clientY: 5 }) // block 3 -> [24, 32)

    expect(store.selection).toEqual({ anchor: 24, focus: 31 })
  })

  it('clips the last block to the range end when the range does not divide evenly', async () => {
    const app = mountApp()
    // 32 bytes at block size 9 -> 4 blocks: 9,9,9,5.
    const worker = await openWithWorker(Array.from({ length: 32 }, (_u, i) => i))
    await openEntropySection(app)
    await app.find('[data-field="entropy-block-size"]').setValue(9)
    await computeButton(app).trigger('click')
    const reqId = statsRequests(worker)[0]!.reqId
    worker.emit({
      reqId,
      kind: 'result',
      ok: true,
      result: { entropy: Float32Array.of(1, 2, 3, 4), histogram: new Uint32Array(256) },
    })
    await flushPromises()
    stubCanvasRect(app, 100)
    const store = useDocumentStore(pinia)

    // block 3 spans x in [75, 100) -> the short last block [27, 32).
    await app
      .find('[data-field="entropy-canvas"]')
      .trigger('pointerdown', { button: 0, shiftKey: true, clientX: 90, clientY: 5 })

    expect(store.selection).toEqual({ anchor: 27, focus: 31 })
  })
})
