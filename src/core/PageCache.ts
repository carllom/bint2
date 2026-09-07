/**
 * PageCache — the real cache that slides in behind the frozen ByteSource
 * (ADR-0001, ADR-0002). It never sees a `File`: it is handed `{ fetchRange, size }`
 * and serves every read by assembling whole Pages, holding a bounded pool of
 * them in LRU order so a scroll back over bytes the reader has already visited
 * paints from `readSync` in the same frame, with no `··` placeholder flicker.
 *
 * Sized against the Viewport, not the file (ADR-0002): 64 KiB Pages and a
 * 256-Page ceiling (≤ 16 MiB) are ~30× the working set, and that over-provision
 * is what makes back-scroll and return-from-Goto free.
 *
 * Framework-free (see src/core/index.ts): plain TypeScript, unit-tested against
 * a fake `fetchRange` with controllable timing.
 */

/** Fetch bytes `[start, end)` of the document. `end` is always ≤ `size`. */
export type FetchRange = (start: number, end: number) => Promise<Uint8Array>

export interface PageCacheDeps {
  fetchRange: FetchRange
  /** Document size in bytes. May exceed 2^32. */
  size: number
}

export interface PageCacheOptions {
  /** Bytes per Page. Default 64 KiB. */
  pageSize?: number
  /** Ceiling on `resident + pending` Pages. Default 256 (≤ 16 MiB at 64 KiB). */
  capacityPages?: number
  /** Prefetch reaches this many Pages either side of the Viewport. Default 1. */
  prefetchPages?: number
  /** A `read` whose clamped length exceeds this is a Direct read. Default 1 MiB. */
  directReadThreshold?: number
}

/** A developer / test surface (ADR-0002). Never shown in the UI. */
export interface PageCacheStats {
  hits: number
  misses: number
  evictions: number
  pagesResident: number
  pendingCount: number
  bytesFetched: number
}

const DEFAULT_PAGE_SIZE = 64 * 1024
const DEFAULT_CAPACITY_PAGES = 256
const DEFAULT_PREFETCH_PAGES = 1
const DEFAULT_DIRECT_READ_THRESHOLD = 1024 * 1024

/** A coalesced fetch spans at most this many Pages / bytes (ADR-0002). */
const COALESCE_PAGE_CAP = 16
const COALESCE_BYTE_CAP = 1024 * 1024

type PageEntry =
  | { readonly state: 'resident'; readonly bytes: Uint8Array }
  | { readonly state: 'pending'; readonly promise: Promise<Uint8Array> }

function invalidArgs(offset: number, length: number): boolean {
  return offset < 0 || Number.isNaN(offset) || length < 0 || Number.isNaN(length)
}

export class PageCache {
  /** Document size in bytes. May exceed 2^32. */
  readonly size: number

  readonly #fetchRange: FetchRange
  readonly #pageSize: number
  readonly #capacityPages: number
  readonly #prefetchPages: number
  readonly #directReadThreshold: number
  readonly #maxCoalescePages: number

  /** Page index → entry. Map iteration order is LRU→MRU; promote by delete+set. */
  readonly #pages = new Map<number, PageEntry>()

  #hits = 0
  #misses = 0
  #evictions = 0
  #bytesFetched = 0

  constructor(deps: PageCacheDeps, options: PageCacheOptions = {}) {
    this.size = deps.size
    this.#fetchRange = deps.fetchRange
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    this.#capacityPages = options.capacityPages ?? DEFAULT_CAPACITY_PAGES
    this.#prefetchPages = options.prefetchPages ?? DEFAULT_PREFETCH_PAGES
    this.#directReadThreshold = options.directReadThreshold ?? DEFAULT_DIRECT_READ_THRESHOLD
    this.#maxCoalescePages = Math.max(
      1,
      Math.min(COALESCE_PAGE_CAP, Math.floor(COALESCE_BYTE_CAP / this.#pageSize) || 1),
    )
  }

  get stats(): PageCacheStats {
    let resident = 0
    let pending = 0
    for (const entry of this.#pages.values()) {
      if (entry.state === 'resident') resident++
      else pending++
    }
    return {
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      pagesResident: resident,
      pendingCount: pending,
      bytesFetched: this.#bytesFetched,
    }
  }

  /**
   * Freshly-allocated, caller-owned bytes — never a view into a Page. A read
   * crossing EOF returns `min(length, size - offset)` bytes; `offset >= size`
   * returns an empty array. Only negative / `NaN` arguments throw.
   */
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (invalidArgs(offset, length)) {
      throw new RangeError(`PageCache read out of range: offset=${offset}, length=${length}`)
    }
    const { start, end } = this.#clamp(offset, length)
    const reqLen = end - start
    if (reqLen === 0) return new Uint8Array(0)

    // A big read is a Direct read: capped chunks, populating nothing, so a
    // one-shot copy cannot flush the working set (ADR-0002).
    if (reqLen > this.#directReadThreshold) {
      return this.#directRead(start, end)
    }

    const { first, last } = this.#pageSpan(start, end)
    const pageBytes = new Map<number, Promise<Uint8Array>>()
    const missing: number[] = []
    let allResident = true

    for (let page = first; page <= last; page++) {
      const entry = this.#pages.get(page)
      if (entry?.state === 'resident') {
        this.#touch(page, entry)
        pageBytes.set(page, Promise.resolve(entry.bytes))
      } else if (entry?.state === 'pending') {
        // Concurrent reads of one pending Page share its single in-flight
        // promise — never a second fetch for the same Page.
        allResident = false
        pageBytes.set(page, entry.promise)
      } else {
        allResident = false
        missing.push(page)
      }
    }

    if (allResident) this.#hits++
    else this.#misses++

    // Join strictly-contiguous runs of missing Pages, each capped at the
    // coalesce ceiling. No gap-bridging: a resident Page in the middle splits
    // the run rather than being re-fetched.
    for (const run of contiguousRuns(missing)) {
      for (let i = 0; i < run.length; i += this.#maxCoalescePages) {
        const chunk = run.slice(i, i + this.#maxCoalescePages)
        const cache = this.#makeRoom(chunk.length)
        for (const [page, promise] of this.#fetchPages(chunk, cache)) {
          pageBytes.set(page, promise)
        }
      }
    }

    const result = new Uint8Array(reqLen)
    await Promise.all(
      Array.from(pageBytes, async ([page, promise]) => {
        this.#slicePageInto(result, await promise, page, start, end)
      }),
    )
    return result
  }

  /** Non-null only on a full local hit; null otherwise. Never blocks. */
  readSync(offset: number, length: number): Uint8Array | null {
    if (invalidArgs(offset, length)) return null
    const { start, end } = this.#clamp(offset, length)
    if (end === start) return new Uint8Array(0)

    const { first, last } = this.#pageSpan(start, end)
    for (let page = first; page <= last; page++) {
      if (this.#pages.get(page)?.state !== 'resident') return null
    }

    const result = new Uint8Array(end - start)
    for (let page = first; page <= last; page++) {
      const entry = this.#pages.get(page) as Extract<PageEntry, { state: 'resident' }>
      this.#slicePageInto(result, entry.bytes, page, start, end)
      this.#touch(page, entry) // the per-frame path must keep the working set warm
    }
    this.#hits++
    return result
  }

  /**
   * Fire-and-forget (ADR-0001): returns void, never throws. Warms the covering
   * Pages of `[offset, offset + length)` plus `prefetchPages` either side,
   * clamped to `size`. Scroll direction is not tracked — the reach is symmetric.
   */
  prefetch(offset: number, length: number): void {
    try {
      if (this.size === 0 || invalidArgs(offset, length)) return
      const { start, end } = this.#clamp(offset, length)
      const from = Math.min(start, this.size - 1)
      const span = this.#pageSpan(from, Math.max(from + 1, end))

      const lastPage = Math.floor((this.size - 1) / this.#pageSize)
      const lo = Math.max(0, span.first - this.#prefetchPages)
      const hi = Math.min(lastPage, span.last + this.#prefetchPages)

      const missing: number[] = []
      for (let page = lo; page <= hi; page++) {
        if (!this.#pages.has(page)) missing.push(page)
      }

      for (const run of contiguousRuns(missing)) {
        for (let i = 0; i < run.length; i += this.#maxCoalescePages) {
          const chunk = run.slice(i, i + this.#maxCoalescePages)
          // Best-effort: skip rather than exceed capacity or evict pinned Pages.
          if (!this.#makeRoom(chunk.length)) continue
          this.#fetchPages(chunk, true)
        }
      }
    } catch {
      // Speculative work must never surface as an unhandled failure.
    }
  }

  // — internals —————————————————————————————————————————————————————————————

  #clamp(offset: number, length: number): { start: number; end: number } {
    const start = Math.min(offset, this.size)
    return { start, end: Math.max(start, Math.min(offset + length, this.size)) }
  }

  /** Covering Page indices of `[start, end)`. Caller guarantees `end > start`. */
  #pageSpan(start: number, end: number): { first: number; last: number } {
    return {
      first: Math.floor(start / this.#pageSize),
      last: Math.floor((end - 1) / this.#pageSize),
    }
  }

  #touch(page: number, entry: PageEntry): void {
    this.#pages.delete(page)
    this.#pages.set(page, entry)
  }

  /**
   * Evict resident Pages from the LRU end until `need` more fit under the
   * ceiling. Pending Pages are pinned and never evicted, so this returns `false`
   * when the pool is full of in-flight fetches — the caller then serves those
   * Pages uncached rather than break the `resident + pending` bound.
   */
  #makeRoom(need: number): boolean {
    while (this.#pages.size + need > this.#capacityPages) {
      let victim: number | undefined
      for (const [page, entry] of this.#pages) {
        if (entry.state === 'resident') {
          victim = page
          break
        }
      }
      if (victim === undefined) return false
      this.#pages.delete(victim)
      this.#evictions++
    }
    return true
  }

  /**
   * Fetch a strictly-contiguous, ≤ cap run of Pages in one `fetchRange` call and
   * return a per-Page bytes-promise. With `cache`, each Page also gets a pending
   * entry that becomes resident at MRU on resolve, or is removed on reject — no
   * negative caching (ADR-0002).
   */
  #fetchPages(pages: number[], cache: boolean): Map<number, Promise<Uint8Array>> {
    const chunkStart = pages[0]! * this.#pageSize
    const chunkEnd = Math.min((pages[pages.length - 1]! + 1) * this.#pageSize, this.size)
    const chunk = this.#fetchRange(chunkStart, chunkEnd)
    this.#bytesFetched += chunkEnd - chunkStart

    const out = new Map<number, Promise<Uint8Array>>()
    for (const page of pages) {
      const pageStart = page * this.#pageSize
      const pageEnd = Math.min(pageStart + this.#pageSize, this.size)
      const promise = chunk.then((buf) =>
        buf.subarray(pageStart - chunkStart, pageEnd - chunkStart),
      )
      out.set(page, promise)

      if (cache) {
        const entry: PageEntry = { state: 'pending', promise }
        this.#pages.set(page, entry)
        promise.then(
          (bytes) => {
            if (this.#pages.get(page) === entry) {
              this.#touch(page, { state: 'resident', bytes: bytes.slice() })
            }
          },
          () => {
            if (this.#pages.get(page) === entry) this.#pages.delete(page)
          },
        )
      }
    }
    return out
  }

  async #directRead(start: number, end: number): Promise<Uint8Array> {
    this.#misses++
    const result = new Uint8Array(end - start)
    const { first, last } = this.#pageSpan(start, end)
    const fetches: Promise<void>[] = []
    let runStart = -1

    const flush = (runEnd: number): void => {
      if (runStart < 0) return
      const from = runStart
      runStart = -1
      this.#bytesFetched += runEnd - from
      fetches.push(
        this.#fetchRange(from, runEnd).then((buf) => {
          result.set(buf, from - start)
        }),
      )
    }

    for (let page = first; page <= last; page++) {
      const pageStart = page * this.#pageSize
      const overlapStart = Math.max(start, pageStart)
      const overlapEnd = Math.min(end, pageStart + this.#pageSize)
      const entry = this.#pages.get(page)
      if (entry?.state === 'resident') {
        // Consult resident Pages where they already exist; populate nothing.
        flush(overlapStart)
        this.#slicePageInto(result, entry.bytes, page, start, end)
        this.#touch(page, entry)
      } else {
        if (runStart < 0) runStart = overlapStart
        if (overlapEnd - runStart >= this.#directReadThreshold) flush(overlapEnd)
      }
    }
    flush(end)

    await Promise.all(fetches)
    return result
  }

  /** Copy this Page's slice of `[start, end)` into `result` at the right offset. */
  #slicePageInto(
    result: Uint8Array,
    pageBytes: Uint8Array,
    page: number,
    start: number,
    end: number,
  ): void {
    const pageStart = page * this.#pageSize
    const from = Math.max(start, pageStart)
    const to = Math.min(end, pageStart + this.#pageSize)
    result.set(pageBytes.subarray(from - pageStart, to - pageStart), from - start)
  }
}

/** Split an ascending list of indices into strictly-contiguous runs. */
function contiguousRuns(pages: number[]): number[][] {
  const runs: number[][] = []
  for (const page of pages) {
    const run = runs[runs.length - 1]
    if (run && page === run[run.length - 1]! + 1) run.push(page)
    else runs.push([page])
  }
  return runs
}
