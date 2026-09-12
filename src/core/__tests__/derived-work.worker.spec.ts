import { describe, expect, it, vi } from 'vitest'
import type { DerivedWorkRequestMessage, DerivedWorkResponseMessage } from '../DerivedWork'
import { createDerivedWorkHandler } from '../derived-work.worker'

function fileWithPatternAt(size: number, pattern: number[], positions: number[]): File {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = i & 0xff
  for (const position of positions) bytes.set(pattern, position)
  return new File([bytes], 'pattern.bin')
}

/**
 * A `File`-like whose `.slice().arrayBuffer()` resolves only when the test
 * calls `resolveNext()`, in issue order — lets a test interleave a `cancel`
 * message between chunks deterministically.
 */
function controllableFile(size: number): { file: File; resolveNext: () => void } {
  const resolvers: Array<() => void> = []
  const file = {
    size,
    slice(start: number, end: number) {
      return {
        arrayBuffer(): Promise<ArrayBuffer> {
          return new Promise((resolve) => {
            resolvers.push(() => resolve(new Uint8Array(end - start).buffer))
          })
        },
      }
    },
  } as unknown as File
  return { file, resolveNext: () => resolvers.shift()?.() }
}

function fakePost(): ReturnType<typeof vi.fn<(m: DerivedWorkResponseMessage, t?: Transferable[]) => void>> {
  return vi.fn<(m: DerivedWorkResponseMessage, t?: Transferable[]) => void>()
}

describe('createDerivedWorkHandler', () => {
  it('errors with read-failed when a request arrives before init', async () => {
    const post = fakePost()
    const handle = createDerivedWorkHandler(post)

    await handle({
      type: 'request',
      reqId: 'r1',
      kind: 'search',
      params: { pattern: Uint8Array.of(1) },
    })

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ reqId: 'r1', kind: 'error', ok: false, code: 'read-failed' }),
    )
  })

  it('runs a search job end to end: init, progress, result with a transferred buffer', async () => {
    const post = fakePost()
    const handle = createDerivedWorkHandler(post)
    const pattern = [0xaa, 0xbb]
    const file = fileWithPatternAt(32, pattern, [3, 10])

    await handle({ type: 'init', file })
    await handle({
      type: 'request',
      reqId: 'r1',
      kind: 'search',
      params: { pattern: Uint8Array.from(pattern) },
    })

    const resultCall = post.mock.calls.find(([message]) => message.kind === 'result')
    expect(resultCall).toBeDefined()
    const [message, transfer] = resultCall!
    expect(message).toMatchObject({ reqId: 'r1', kind: 'result', ok: true })
    if (message.kind === 'result') {
      expect(Array.from(message.result.matches)).toEqual([3, 10])
      expect(transfer).toEqual([message.result.matches.buffer])
    }

    const progressCalls = post.mock.calls.filter(([m]) => m.kind === 'progress')
    expect(progressCalls.length).toBeGreaterThan(0)
  })

  it('does nothing and does not throw for the not-yet-implemented stats job kind', async () => {
    const post = fakePost()
    const handle = createDerivedWorkHandler(post)
    const file = fileWithPatternAt(16, [0xaa], [])
    await handle({ type: 'init', file })

    // 'stats' is a real DerivedWorkJobKind, just unimplemented — the request
    // message union only types 'search' today, so cast around it here.
    const statsRequest = {
      type: 'request',
      reqId: 'r1',
      kind: 'stats',
      params: {},
    } as unknown as DerivedWorkRequestMessage

    await expect(handle(statsRequest)).resolves.toBeUndefined()
    expect(post).not.toHaveBeenCalled()
  })

  it('acks cancellation and never posts a result for a cancelled job, even if reads were already in flight', async () => {
    const post = fakePost()
    const handle = createDerivedWorkHandler(post)
    const { file, resolveNext } = controllableFile(2 * 1024 * 1024) // 2 chunks at the default 1 MiB chunk size

    await handle({ type: 'init', file })
    // Fire-and-forget, matching real usage: postMessage doesn't block the caller.
    void handle({
      type: 'request',
      reqId: 'r1',
      kind: 'search',
      params: { pattern: Uint8Array.of(1) },
    })
    void handle({ type: 'cancel', reqId: 'r1' })

    resolveNext() // let chunk 0 resolve; the loop should then see the cancellation and stop
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(post).toHaveBeenCalledWith({ reqId: 'r1', kind: 'cancelled' })
    expect(post.mock.calls.some(([m]) => m.kind === 'result')).toBe(false)
  })

  it('a stale cancel for an already-finished job does not leak and does not affect a later job reusing the same reqId', async () => {
    const post = fakePost()
    const handle = createDerivedWorkHandler(post)
    const file = fileWithPatternAt(16, [0xaa], [3])

    await handle({ type: 'init', file })
    await handle({
      type: 'request',
      reqId: 'r1',
      kind: 'search',
      params: { pattern: Uint8Array.of(0xaa) },
    })
    post.mockClear()

    // A cancel that arrives after its job already finished — DerivedWorkClient
    // sends this without waiting for an ack, so it can race a fast job.
    await handle({ type: 'cancel', reqId: 'r1' })

    // A later job reusing the same reqId must run to completion, not be
    // treated as already-cancelled by the stale entry above.
    await handle({
      type: 'request',
      reqId: 'r1',
      kind: 'search',
      params: { pattern: Uint8Array.of(0xaa) },
    })

    const resultCall = post.mock.calls.find(([m]) => m.kind === 'result')
    expect(resultCall).toBeDefined()
    expect(post.mock.calls.some(([m]) => m.kind === 'cancelled')).toBe(false)
  })
})
