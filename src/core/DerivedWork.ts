/**
 * DerivedWork — the worker-crossing protocol every derived-work job (search,
 * stats) dispatches through (CONTEXT.md's Derived work; ADR-0013). Unlike
 * ByteSource's frozen small, uncancellable point reads, a derived-work job is
 * one long-running, cancellable, progress-reporting request — deliberately a
 * separate contract, never bolted onto ByteSource.
 *
 * This module is the wire protocol shared by DerivedWorkClient (main thread)
 * and derived-work.worker.ts (worker thread): request/response message
 * shapes and the job-specific payload types. Implementations land in
 * DerivedWorkClient.ts and derived-work.worker.ts.
 */

/**
 * Distinct from ByteSourceErrorCode (ADR-0013): reusing that type would imply
 * the two are one frozen contract, when the point of the ADR is that they are
 * not.
 */
export type DerivedWorkErrorCode = 'read-failed' | 'source-gone'

export type DerivedWorkJobKind = 'search' | 'stats'

/**
 * A hex byte-sequence, forward, whole-file scan. Text mode and Selection
 * scoping are a later ticket (#97/#100) — this ticket proves the protocol
 * end-to-end against the simplest real job.
 */
export interface SearchParams {
  readonly pattern: Uint8Array
}

export interface SearchResult {
  /**
   * Match offsets, ascending. A Float64Array — not Uint32Array — because
   * ByteSource.size may exceed 2^32, and it survives postMessage's transfer
   * list without structured-clone (ADR-0013 §2.5).
   */
  readonly matches: Float64Array
}

/** Progress's job-specific `extra` payload for a search job (ADR-0013 §2.5). */
export interface SearchProgressExtra {
  readonly matchCount: number
}

/**
 * The joint entropy/histogram scan (#98/#104, ADR-0012) — one pass over
 * `range` produces both the per-block Shannon-entropy array and the global
 * 256-value byte-count histogram. `range` is a half-open `[start, end)` span,
 * the whole file or a Selection-shaped sub-range; scoping the UI feeds it
 * from is a later ticket, so this shape is deliberately not `SelectionRange`
 * itself — the wire protocol stays decoupled from the Selection model.
 */
export interface StatsParams {
  readonly range: { readonly start: number; readonly end: number }
  /** Bytes per entropy block — also the divisor for `ceil(range length / blockSize)`. */
  readonly blockSize: number
}

export interface StatsResult {
  /** Per-block Shannon entropy (0..8), one entry per `ceil(range length / blockSize)` block. */
  readonly entropy: Float32Array
  /** Global byte-value counts over the whole range — raw counts, not yet normalized (a UI-level concern). */
  readonly histogram: Uint32Array
}

// ---------------------------------------------------------------------------
// client -> worker
// ---------------------------------------------------------------------------

/** Posted once, right after the worker is created — hands it the File clone. */
export interface DerivedWorkInitMessage {
  readonly type: 'init'
  readonly file: File
}

export interface DerivedWorkSearchRequestMessage {
  readonly type: 'request'
  readonly reqId: string
  readonly kind: 'search'
  readonly params: SearchParams
}

export interface DerivedWorkStatsRequestMessage {
  readonly type: 'request'
  readonly reqId: string
  readonly kind: 'stats'
  readonly params: StatsParams
}

/** Hard cancellation: the worker checks this between chunks and actually stops. */
export interface DerivedWorkCancelMessage {
  readonly type: 'cancel'
  readonly reqId: string
}

export type DerivedWorkRequestMessage =
  | DerivedWorkInitMessage
  | DerivedWorkSearchRequestMessage
  | DerivedWorkStatsRequestMessage
  | DerivedWorkCancelMessage

// ---------------------------------------------------------------------------
// worker -> client
// ---------------------------------------------------------------------------

/** Generic envelope (ADR-0013 §2.5): `percent` is offset÷size for any job kind. */
export interface DerivedWorkProgressMessage {
  readonly reqId: string
  readonly kind: 'progress'
  readonly percent: number
  readonly extra?: SearchProgressExtra
}

/** Acks a cancel request; the client retires `reqId` on send, not on this ack. */
export interface DerivedWorkCancelledMessage {
  readonly reqId: string
  readonly kind: 'cancelled'
}

export interface DerivedWorkResultMessage {
  readonly reqId: string
  readonly kind: 'result'
  readonly ok: true
  readonly result: SearchResult | StatsResult
}

export interface DerivedWorkErrorMessage {
  readonly reqId: string
  readonly kind: 'error'
  readonly ok: false
  readonly code: DerivedWorkErrorCode
  readonly message: string
}

export type DerivedWorkResponseMessage =
  | DerivedWorkProgressMessage
  | DerivedWorkCancelledMessage
  | DerivedWorkResultMessage
  | DerivedWorkErrorMessage
