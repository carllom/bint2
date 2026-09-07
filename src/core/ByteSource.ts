/**
 * ByteSource — the abstraction over an open document's bytes (see CONTEXT.md).
 * It answers for any byte range on demand and never holds the whole document.
 *
 * Frozen by ADR-0001. The interface is specified worker-compatible, but no
 * Web Worker is built in phase 1. This module is the M0 skeleton: the frozen
 * type surface only. Implementations (FileByteSource, the test doubles) and the
 * ByteSourceError value class land at M2, with the tests for close/latch
 * semantics that runtime code needs.
 */

/**
 * The `code` a ByteSourceError carries. Across a worker boundary the failure
 * would be posted as a plain payload and reconstructed on the main thread,
 * because structured clone drops Error subclass identity — hence a plain union
 * rather than a class hierarchy.
 */
export type ByteSourceErrorCode = 'read-failed' | 'source-closed' | 'source-gone'

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
