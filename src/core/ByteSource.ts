/**
 * ByteSource — the abstraction over an open document's bytes (see CONTEXT.md).
 * It answers for any byte range on demand and never holds the whole document.
 *
 * Frozen by ADR-0001. The interface is specified worker-compatible, but no
 * Web Worker is built in phase 1. Implementations (FileByteSource, the test
 * doubles) land at M2 — this module is the type surface only.
 */

export type ByteSourceErrorCode = 'read-failed' | 'source-closed' | 'source-gone'

/**
 * Failures reject with one of these. Across a worker boundary it would be
 * posted as a plain payload and reconstructed on the main thread, because
 * structured clone drops `Error` subclass identity.
 */
export class ByteSourceError extends Error {
  readonly code: ByteSourceErrorCode

  constructor(code: ByteSourceErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ByteSourceError'
    this.code = code
  }
}

export interface ByteSource {
  /** Document size in bytes. May exceed 2^32. */
  readonly size: number

  /**
   * Freshly-allocated, caller-owned bytes — never a view into a Page.
   * A read crossing EOF returns `min(length, size - offset)` bytes;
   * `offset >= size` returns an empty array. Only negative/`NaN` throws.
   */
  read(offset: number, length: number): Promise<Uint8Array>

  /** Non-null only on a full local hit; null otherwise. Never blocks. */
  readSync(offset: number, length: number): Uint8Array | null

  /** Fire-and-forget; returns void; never throws. Failures surface on the matching `read`. */
  prefetch(offset: number, length: number): void

  /**
   * Idempotent. Rejects in-flight reads with `source-closed`; subsequent
   * `read` rejects immediately and `readSync` returns null.
   */
  close(): void
}
