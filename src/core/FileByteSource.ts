import type { ByteSource, ByteSourceErrorCode } from './ByteSource'

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
 * A {@link ByteSource} backed directly by a `File`, with **no page cache**:
 * every `read` slices the file afresh and `readSync` is always a miss. The page
 * cache lands later behind this same frozen contract (ADR-0001, ADR-0002);
 * keeping this implementation uncached is what keeps the first slice narrow, and
 * proving the cache drops in without touching call sites is what the freeze
 * bought.
 *
 * Holds the raw `File` and closes over nothing non-cloneable, so it stays
 * postable to a worker if one is ever built.
 *
 * Not yet implemented (their milestones own the tests): the `source-gone` latch
 * for a file that moves or is truncated mid-session (ADR-0004, M5).
 */
export class FileByteSource implements ByteSource {
  readonly #file: File
  readonly #closeRejectors = new Set<() => void>()
  #closed = false

  constructor(file: File) {
    this.#file = file
  }

  get size(): number {
    return this.#file.size
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    assertReadArgs(offset, length)
    if (this.#closed) {
      throw new ByteSourceError('source-closed')
    }

    // EOF is not an error: clamp to the file and let the caller see a short
    // (possibly empty) result. The render path needs no EOF arithmetic.
    const start = Math.min(offset, this.size)
    const end = Math.min(offset + length, this.size)

    let onClose!: () => void
    const closed = new Promise<never>((_resolve, reject) => {
      onClose = () => reject(new ByteSourceError('source-closed'))
      this.#closeRejectors.add(onClose)
    })

    const io = this.#file.slice(start, end).arrayBuffer()
    // If close() wins the race below, this promise is orphaned — swallow its
    // eventual settlement so a later I/O failure is not an unhandled rejection.
    io.catch(() => {})

    try {
      const buffer = await Promise.race([io, closed])
      if (this.#closed) {
        // close() landed while the slice was in flight.
        throw new ByteSourceError('source-closed')
      }
      // Freshly allocated and caller-owned — never a view into anything we hold.
      return new Uint8Array(buffer)
    } catch (error) {
      if (error instanceof ByteSourceError) {
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

  /**
   * Uncached: always a miss, whatever the range. The page cache milestone gives
   * this a fast path; the args are part of the frozen contract regardless.
   */
  readSync(): Uint8Array | null {
    return null
  }

  /** Uncached: nothing to warm. Fire-and-forget, never throws (ADR-0001). */
  prefetch(): void {}

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
