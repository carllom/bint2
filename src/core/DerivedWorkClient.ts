import type {
  DerivedWorkErrorCode,
  DerivedWorkResponseMessage,
  SearchParams,
  SearchProgressExtra,
  SearchResult,
  StatsParams,
  StatsResult,
} from './DerivedWork'

/**
 * The failure a {@link DerivedWorkClient} job rejects with (ADR-0013). Its own
 * `code` union, distinct from `ByteSourceError` — reusing that type would
 * imply the two are one frozen contract, when the point of the ADR is that
 * they are not.
 */
export class DerivedWorkError extends Error {
  readonly code: DerivedWorkErrorCode

  constructor(code: DerivedWorkErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'DerivedWorkError'
    this.code = code
  }
}

/**
 * What a job's `result` promise rejects with when cancelled — either
 * explicitly via {@link DerivedWorkJobHandle.cancel}, or implicitly because a
 * new/different job superseded it (ADR-0013 §2.7). Cancellation is a normal
 * outcome, not a failure code, so it is not a {@link DerivedWorkError}.
 */
export class DerivedWorkCancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'DerivedWorkCancelled'
  }
}

/** The seam a test substitutes to avoid spinning up a real `Worker` (plan §7). */
export interface DerivedWorkWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent) => void) | null
  terminate(): void
}

export interface DerivedWorkClientDeps {
  createWorker?: () => DerivedWorkWorkerLike
}

export interface SearchProgress extends SearchProgressExtra {
  readonly percent: number
}

/** A `'stats'` job has no job-specific `extra` (ADR-0013 §2.5) — just `percent`. */
export interface StatsProgress {
  readonly percent: number
}

export interface DerivedWorkJobHandle<T> {
  readonly result: Promise<T>
  cancel(): void
}

interface PendingJob {
  resolve(value: unknown): void
  reject(error: unknown): void
  onProgress?: (progress: SearchProgress) => void
}

function defaultCreateWorker(): DerivedWorkWorkerLike {
  return new Worker(new URL('./derived-work.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as DerivedWorkWorkerLike
}

let nextReqId = 0

/**
 * The worker-crossing interface every derived-work job (search, stats)
 * dispatches through (ADR-0013). Constructed the same way as
 * `FileByteSource` — `new DerivedWorkClient(file)` — alongside it wherever a
 * document opens, but holds its own `File` clone and does its own reads *and*
 * compute entirely inside the worker's event loop; it does not reuse the main
 * thread's `PageCache` and never touches `ByteSource`.
 *
 * One worker per instance, created here and terminated by {@link close}. Jobs
 * are mutually exclusive (ADR-0013 §2.4/§2.7): starting a new job always
 * supersedes — cancels — whatever job is currently running, regardless of
 * kind. `#pending` never holds more than one entry by construction, so its
 * sole key (if any) *is* "the current job" — no separate field to keep in
 * lockstep with it. A superseded or explicitly cancelled job's `reqId` is
 * retired immediately (removed from `#pending`), so a result the worker had
 * already computed before the cancel can never be delivered as if it were
 * live, independent of when — or whether — the worker's own `{kind:
 * 'cancelled'}` ack arrives.
 */
export class DerivedWorkClient {
  readonly #worker: DerivedWorkWorkerLike
  readonly #pending = new Map<string, PendingJob>()
  #closed = false

  constructor(file: File, deps: DerivedWorkClientDeps = {}) {
    this.#worker = deps.createWorker ? deps.createWorker() : defaultCreateWorker()
    this.#worker.onmessage = (event) =>
      this.#handleMessage(event.data as DerivedWorkResponseMessage)
    this.#worker.postMessage({ type: 'init', file })
  }

  /**
   * Hex byte-sequence, forward, whole-file search (ADR-0013; text mode and
   * Selection scoping land in #97/#100). Supersedes any job currently in
   * flight. Once {@link close} has run, this is a no-op whose `result`
   * rejects immediately with {@link DerivedWorkCancelled} — mirrors
   * `FileByteSource.read()` rejecting after `close()` (ADR-0001), except
   * there is no live worker left to even ask.
   */
  search(
    params: SearchParams,
    onProgress?: (progress: SearchProgress) => void,
  ): DerivedWorkJobHandle<SearchResult> {
    if (this.#closed) {
      return { result: Promise.reject(new DerivedWorkCancelled()), cancel: () => {} }
    }

    this.#supersedeCurrent()

    const reqId = String(nextReqId++)
    const result = new Promise<SearchResult>((resolve, reject) => {
      this.#pending.set(reqId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      })
    })

    this.#worker.postMessage({ type: 'request', reqId, kind: 'search', params })

    return {
      result,
      cancel: () => this.#cancel(reqId),
    }
  }

  /**
   * The joint entropy/histogram scan (#98/#104, ADR-0012) over `params.range`.
   * Supersedes any job currently in flight, exactly like {@link search} — jobs
   * are mutually exclusive regardless of kind (ADR-0013 §2.4/§2.7).
   */
  stats(
    params: StatsParams,
    onProgress?: (progress: StatsProgress) => void,
  ): DerivedWorkJobHandle<StatsResult> {
    if (this.#closed) {
      return { result: Promise.reject(new DerivedWorkCancelled()), cancel: () => {} }
    }

    this.#supersedeCurrent()

    const reqId = String(nextReqId++)
    const result = new Promise<StatsResult>((resolve, reject) => {
      this.#pending.set(reqId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      })
    })

    this.#worker.postMessage({ type: 'request', reqId, kind: 'stats', params })

    return {
      result,
      cancel: () => this.#cancel(reqId),
    }
  }

  /**
   * Idempotent. Cancels any in-flight job (its `result` rejects with
   * {@link DerivedWorkCancelled}) and terminates the worker.
   */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#supersedeCurrent()
    this.#worker.terminate()
  }

  #supersedeCurrent(): void {
    const [current] = this.#pending.keys()
    if (current !== undefined) this.#cancel(current)
  }

  #cancel(reqId: string): void {
    const pending = this.#pending.get(reqId)
    if (!pending) return
    this.#pending.delete(reqId)
    this.#worker.postMessage({ type: 'cancel', reqId })
    pending.reject(new DerivedWorkCancelled())
  }

  #handleMessage(message: DerivedWorkResponseMessage): void {
    const pending = this.#pending.get(message.reqId)
    // Retired (cancelled/superseded/closed) — never deliver as if it were live.
    if (!pending) return

    switch (message.kind) {
      case 'progress':
        // `extra` is job-specific and optional (ADR-0013 §2.5) — spread it in
        // only when present, so a stats job's callback sees plain `{percent}`
        // rather than a search-shaped `matchCount` it never asked for.
        pending.onProgress?.({ percent: message.percent, ...message.extra } as SearchProgress)
        return
      case 'cancelled':
        this.#pending.delete(message.reqId)
        pending.reject(new DerivedWorkCancelled())
        return
      case 'result':
        this.#pending.delete(message.reqId)
        pending.resolve(message.result)
        return
      case 'error':
        this.#pending.delete(message.reqId)
        pending.reject(new DerivedWorkError(message.code, message.message))
        return
    }
  }
}
