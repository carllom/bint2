import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { DerivedWorkClient, FileByteSource } from '@/core'
import type { DerivedWorkResponseMessage, DerivedWorkWorkerLike } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { useEntropyStore } from '@/stores/entropy'

// The Entropy store's Compute/Cancel/staleness-input contract (#107, ADR-0012,
// plan-phase2.md §4, §7.1 "Entropy panel" scenarios) — driven against a
// hand-fed fake worker, mirroring `DerivedWorkClient.spec.ts`'s own fake so no
// real `Worker` is involved.

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

function fileOf(size = 16): File {
  return new File([new Uint8Array(size)], 'test.bin')
}

/** Opens a document backed by a real `DerivedWorkClient` over a fake worker. */
function openWithClient(): { worker: FakeWorker } {
  const worker = new FakeWorker()
  const file = fileOf()
  const client = new DerivedWorkClient(file, { createWorker: () => worker })
  useDocumentStore().open(new FileByteSource(file), 'test.bin', client)
  return { worker }
}

const SAMPLE_RESULT = { entropy: Float32Array.of(1, 2, 3, 4), histogram: new Uint32Array(256) }

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('entropy store — compute()', () => {
  it('is a no-op with no document open', () => {
    const store = useEntropyStore()
    store.compute({ start: 0, end: 16 }, 4)
    expect(store.pending).toBe(false)
  })

  it('dispatches a stats job and populates result + computedFor on completion', async () => {
    const { worker } = openWithClient()
    const store = useEntropyStore()

    store.compute({ start: 0, end: 16 }, 4)
    expect(store.pending).toBe(true)

    const reqs = statsRequests(worker)
    expect(reqs).toHaveLength(1)

    worker.emit({ reqId: reqs[0]!.reqId, kind: 'result', ok: true, result: SAMPLE_RESULT })
    await flushPromises()

    expect(store.pending).toBe(false)
    expect(store.result).toEqual(SAMPLE_RESULT)
    expect(store.computedFor).toEqual({ start: 0, end: 16, blockSize: 4 })
  })

  it('reports progress through progressPercent', () => {
    const { worker } = openWithClient()
    const store = useEntropyStore()

    store.compute({ start: 0, end: 16 }, 4)
    const reqId = statsRequests(worker)[0]!.reqId
    worker.emit({ reqId, kind: 'progress', percent: 0.42 })

    expect(store.progressPercent).toBe(0.42)
  })

  it('leaves the previous result/computedFor untouched while a new Compute is pending', async () => {
    const { worker } = openWithClient()
    const store = useEntropyStore()

    store.compute({ start: 0, end: 16 }, 4)
    worker.emit({ reqId: statsRequests(worker)[0]!.reqId, kind: 'result', ok: true, result: SAMPLE_RESULT })
    await flushPromises()

    store.compute({ start: 0, end: 16 }, 8) // a different block size
    expect(store.pending).toBe(true)
    expect(store.result).toEqual(SAMPLE_RESULT) // untouched mid-flight
    expect(store.computedFor).toEqual({ start: 0, end: 16, blockSize: 4 })
  })
})

describe('entropy store — cancel()', () => {
  it('posts a cancel, clears pending, and drops a late result', async () => {
    const { worker } = openWithClient()
    const store = useEntropyStore()

    store.compute({ start: 0, end: 16 }, 4)
    const reqId = statsRequests(worker)[0]!.reqId

    store.cancel()
    expect(store.pending).toBe(false)
    expect(sentCancels(worker)).toEqual([{ type: 'cancel', reqId }])

    // A result that arrives after cancel is dropped, never rendered as live.
    worker.emit({ reqId, kind: 'result', ok: true, result: SAMPLE_RESULT })
    await flushPromises()
    expect(store.result).toBeNull()
  })

  it('is harmless with nothing running', () => {
    const store = useEntropyStore()
    expect(() => store.cancel()).not.toThrow()
    expect(store.pending).toBe(false)
  })
})

describe('entropy store — document change resets everything (plan §6)', () => {
  it('resets mode, scope, result and pending, and cancels an in-flight job', async () => {
    const { worker } = openWithClient()
    const store = useEntropyStore()
    store.setMode('histogram')
    store.setScope('selection')
    store.compute({ start: 0, end: 16 }, 4)
    const reqId = statsRequests(worker)[0]!.reqId

    useDocumentStore().open(new FileByteSource(fileOf(32)), 'other.bin')
    await flushPromises()

    expect(store.mode).toBe('map')
    expect(store.scope).toBe('file')
    expect(store.result).toBeNull()
    expect(store.computedFor).toBeNull()
    expect(store.pending).toBe(false)
    expect(sentCancels(worker)).toEqual([{ type: 'cancel', reqId }])
  })
})
