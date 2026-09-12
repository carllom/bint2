import { describe, expect, it } from 'vitest'
import type { DerivedWorkResponseMessage } from '../DerivedWork'
import type { DerivedWorkWorkerLike } from '../DerivedWorkClient'
import { DerivedWorkCancelled, DerivedWorkClient, DerivedWorkError } from '../DerivedWorkClient'

function syntheticFile(size = 16): File {
  return new File([new Uint8Array(size)], 'synthetic.bin')
}

/** A hand-driven fake of the worker seam — no real `Worker` involved. */
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

function requestReqId(worker: FakeWorker, index = 0): string {
  const requests = worker.sent.filter(
    (m): m is { type: 'request'; reqId: string } =>
      typeof m === 'object' && m !== null && (m as { type?: string }).type === 'request',
  )
  return requests[index]!.reqId
}

describe('DerivedWorkClient', () => {
  it('sends init with the file on construction', () => {
    const worker = new FakeWorker()
    const file = syntheticFile()
    new DerivedWorkClient(file, { createWorker: () => worker })

    expect(worker.sent[0]).toEqual({ type: 'init', file })
  })

  it('close() terminates the worker exactly once, idempotently', () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })

    client.close()
    client.close()

    expect(worker.terminateCalls).toBe(1)
  })

  it('dispatches a search job as a request message and resolves on a matching result', async () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })

    const handle = client.search({ pattern: Uint8Array.of(0xaa) })
    const reqId = requestReqId(worker)
    expect(worker.sent).toContainEqual({
      type: 'request',
      reqId,
      kind: 'search',
      params: { pattern: Uint8Array.of(0xaa) },
    })

    const matches = Float64Array.of(5, 14)
    worker.emit({ reqId, kind: 'result', ok: true, result: { matches } })

    await expect(handle.result).resolves.toEqual({ matches })
  })

  it('delivers progress to the onProgress callback', () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })
    const progressCalls: Array<{ percent: number; matchCount: number }> = []

    client.search({ pattern: Uint8Array.of(0xaa) }, (progress) => progressCalls.push(progress))
    const reqId = requestReqId(worker)

    worker.emit({ reqId, kind: 'progress', percent: 0.5, extra: { matchCount: 2 } })

    expect(progressCalls).toEqual([{ percent: 0.5, matchCount: 2 }])
  })

  it('cancel() posts a cancel message, rejects the result with DerivedWorkCancelled, and drops a late result', async () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })

    const handle = client.search({ pattern: Uint8Array.of(0xaa) })
    const reqId = requestReqId(worker)

    handle.cancel()

    expect(worker.sent).toContainEqual({ type: 'cancel', reqId })
    await expect(handle.result).rejects.toBeInstanceOf(DerivedWorkCancelled)

    // A result the worker had already computed before the cancel must never
    // land as if it were live.
    expect(() =>
      worker.emit({ reqId, kind: 'result', ok: true, result: { matches: new Float64Array(0) } }),
    ).not.toThrow()
  })

  it('a new job supersedes the in-flight one: the old result rejects and the old reqId is retired', async () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })

    const first = client.search({ pattern: Uint8Array.of(0xaa) })
    const firstReqId = requestReqId(worker, 0)

    const second = client.search({ pattern: Uint8Array.of(0xbb) })
    const secondReqId = requestReqId(worker, 1)

    expect(firstReqId).not.toBe(secondReqId)
    expect(worker.sent).toContainEqual({ type: 'cancel', reqId: firstReqId })
    await expect(first.result).rejects.toBeInstanceOf(DerivedWorkCancelled)

    // A late result for the superseded job must not resolve/affect anything.
    worker.emit({
      reqId: firstReqId,
      kind: 'result',
      ok: true,
      result: { matches: new Float64Array(0) },
    })

    const secondMatches = Float64Array.of(7)
    worker.emit({ reqId: secondReqId, kind: 'result', ok: true, result: { matches: secondMatches } })
    await expect(second.result).resolves.toEqual({ matches: secondMatches })
  })

  it('rejects with a DerivedWorkError carrying the worker-reported code (e.g. source-gone)', async () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })

    const handle = client.search({ pattern: Uint8Array.of(0xaa) })
    const reqId = requestReqId(worker)

    worker.emit({ reqId, kind: 'error', ok: false, code: 'source-gone', message: 'file moved' })

    await expect(handle.result).rejects.toBeInstanceOf(DerivedWorkError)
    await expect(handle.result).rejects.toMatchObject({ code: 'source-gone' })
  })

  it('close() cancels an in-flight job before terminating the worker', async () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })

    const handle = client.search({ pattern: Uint8Array.of(0xaa) })
    client.close()

    await expect(handle.result).rejects.toBeInstanceOf(DerivedWorkCancelled)
    expect(worker.terminateCalls).toBe(1)
  })

  it('search() after close() rejects immediately instead of dispatching to the terminated worker', async () => {
    const worker = new FakeWorker()
    const client = new DerivedWorkClient(syntheticFile(), { createWorker: () => worker })
    client.close()

    const sentBeforeSearch = worker.sent.length
    const handle = client.search({ pattern: Uint8Array.of(0xaa) })

    await expect(handle.result).rejects.toBeInstanceOf(DerivedWorkCancelled)
    expect(() => handle.cancel()).not.toThrow()
    // No 'request' posted to the already-terminated worker.
    expect(worker.sent.length).toBe(sentBeforeSearch)
  })
})
