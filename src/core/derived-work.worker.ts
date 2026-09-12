import type { DerivedWorkRequestMessage, DerivedWorkResponseMessage } from './DerivedWork'
import { searchForward } from './derivedWorkSearch'

/**
 * The message-handling logic behind `DerivedWorkClient` (ADR-0013). Exported
 * as a plain function of `post` so it is testable against a fake
 * postMessage/onmessage without a real Worker context
 * (`docs/plan-phase2.md` §7); wired to the real worker global scope at the
 * bottom of this module when one actually exists.
 */

/**
 * The stale-`File` case (mirrors FileByteSource's `isSourceGoneError`, but
 * kept separate per ADR-0013: this worker's own `File` clone can go stale
 * independently of `FileByteSource`'s, and the two error unions are
 * deliberately not shared).
 */
function isSourceGoneError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

export type PostDerivedWorkResponse = (
  message: DerivedWorkResponseMessage,
  transfer?: Transferable[],
) => void

export function createDerivedWorkHandler(
  post: PostDerivedWorkResponse,
): (message: DerivedWorkRequestMessage) => Promise<void> {
  let file: File | null = null
  // Only reqIds a job is actually running for — bounds `cancelledReqIds`
  // below. A `cancel` for a reqId that already finished (or never started)
  // is a stale/no-op message with nothing to retire and nothing to leak.
  const runningReqIds = new Set<string>()
  const cancelledReqIds = new Set<string>()

  async function runSearch(reqId: string, pattern: Uint8Array): Promise<void> {
    if (!file) {
      post({ reqId, kind: 'error', ok: false, code: 'read-failed', message: 'no document open' })
      return
    }
    runningReqIds.add(reqId)
    try {
      const { result, cancelled } = await searchForward(
        file,
        { pattern },
        {
          isCancelled: () => cancelledReqIds.has(reqId),
          onProgress: (percent, extra) => post({ reqId, kind: 'progress', percent, extra }),
        },
      )
      if (cancelled) {
        post({ reqId, kind: 'cancelled' })
      } else {
        post({ reqId, kind: 'result', ok: true, result }, [result.matches.buffer])
      }
    } catch (error) {
      post({
        reqId,
        kind: 'error',
        ok: false,
        code: isSourceGoneError(error) ? 'source-gone' : 'read-failed',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      runningReqIds.delete(reqId)
      cancelledReqIds.delete(reqId)
    }
  }

  return async function handle(message: DerivedWorkRequestMessage): Promise<void> {
    switch (message.type) {
      case 'init':
        file = message.file
        return
      case 'cancel':
        if (runningReqIds.has(message.reqId)) cancelledReqIds.add(message.reqId)
        return
      case 'request':
        if (message.kind === 'search') {
          await runSearch(message.reqId, message.params.pattern)
        }
        // 'stats' is dispatched but not implemented yet — an easy follow-on
        // slot for the entropy/histogram joint scan (#98).
        return
    }
  }
}

// ---------------------------------------------------------------------------
// Real worker wiring — only when this module is actually running inside a
// Worker: no `window`, but a `self` global exists. Kept out of unit tests,
// which run under happy-dom (where `window` is defined) and exercise
// `createDerivedWorkHandler` directly against a fake `post`.
// ---------------------------------------------------------------------------

interface WorkerGlobalLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<DerivedWorkRequestMessage>) => void) | null
}

if (typeof window === 'undefined' && typeof self !== 'undefined') {
  const workerSelf = self as unknown as WorkerGlobalLike
  const handle = createDerivedWorkHandler((message, transfer) =>
    workerSelf.postMessage(message, transfer),
  )
  workerSelf.onmessage = (event) => {
    void handle(event.data)
  }
}
