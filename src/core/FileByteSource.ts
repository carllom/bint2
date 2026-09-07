import type { ByteSource, ByteSourceErrorCode } from './ByteSource'
import { PageCache } from './PageCache'
import type { PageCacheStats } from './PageCache'

/**
 * The failure a {@link ByteSource} rejects with (ADR-0001). A plain class over a
 * `code` union rather than a hierarchy: across a worker boundary the failure is
 * posted as a payload and rebuilt on the main thread, and structured clone
 * drops Error subclass identity.
 */
export class ByteSourceError extends Error {
  readonly code: ByteSourceErrorCode

  constructor(code: ByteSourceErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'ByteSourceError'
    this.code = code
  }
}

function assertReadArgs(offset: number, length: number): void {
  if (offset < 0 || Number.isNaN(offset) || length < 0 || Number.isNaN(length)) {
    throw new RangeError(`ByteSource read out of range: offset=${offset}, length=${length}`)
  }
}

/**
 * A {@link ByteSource} backed by a `File`, with a {@link PageCache} sitting
 * behind the frozen contract (ADR-0001, ADR-0002). `read` assembles whole Pages
 * the cache fetches with `File.slice(...).arrayBuffer()`; `readSync` is a real
 * fast path that returns non-null whenever every covering Page is resident, so a
 * scroll back over visited bytes paints in the same frame; `prefetch` is live
 * API, warming the Pages around the Viewport.
 *
 * Holds the raw `File` and closes over nothing non-cloneable, so it stays
 * postable to a worker if one is ever built.
 *
 * Not yet implemented (their milestones own the tests): the `source-gone` latch
 * for a file that moves or is truncated mid-session (ADR-0004, M5).
 */
export class FileByteSource implements ByteSource {
  readonly #file: File
  readonly #cache: PageCache
  readonly #closeRejectors = new Set<() => void>()
  #closed = false

  constructor(file: File) {
    this.#file = file
    this.#cache = new PageCache({
      size: file.size,
      fetchRange: (start, end) =>
        file
          .slice(start, end)
          .arrayBuffer()
          .then((buffer) => new Uint8Array(buffer)),
    })
  }

  get size(): number {
    return this.#file.size
  }

  /** A developer / test surface (ADR-0002): the page cache's counters. */
  get stats(): PageCacheStats {
    return this.#cache.stats
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    assertReadArgs(offset, length)
    if (this.#closed) {
      throw new ByteSourceError('source-closed')
    }

    let onClose!: () => void
    const closed = new Promise<never>((_resolve, reject) => {
      onClose = () => reject(new ByteSourceError('source-closed'))
      this.#closeRejectors.add(onClose)
    })

    const io = this.#cache.read(offset, length)
    // If close() wins the race below, this promise is orphaned — swallow its
    // eventual settlement so a later I/O failure is not an unhandled rejection.
    io.catch(() => {})

    try {
      const bytes = await Promise.race([io, closed])
      if (this.#closed) {
        // close() landed while the fetch was in flight.
        throw new ByteSourceError('source-closed')
      }
      // The cache already hands back a freshly-allocated, caller-owned array.
      return bytes
    } catch (error) {
      if (error instanceof ByteSourceError) {
        throw error
      }
      if (error instanceof RangeError) {
        throw error
      }
      throw new ByteSourceError(
        'read-failed',
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      this.#closeRejectors.delete(onClose)
    }
  }

  /** Non-null only on a full local hit (ADR-0001). Never blocks. */
  readSync(offset: number, length: number): Uint8Array | null {
    if (this.#closed) {
      return null
    }
    return this.#cache.readSync(offset, length)
  }

  /** Fire-and-forget, never throws (ADR-0001). No-op once closed. */
  prefetch(offset: number, length: number): void {
    if (this.#closed) {
      return
    }
    this.#cache.prefetch(offset, length)
  }

  close(): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    for (const reject of this.#closeRejectors) {
      reject()
    }
    this.#closeRejectors.clear()
  }
}
