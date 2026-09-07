import { describe, expect, it } from 'vitest'
import { PageCache } from '../PageCache'
import type { FetchRange } from '../PageCache'

/** A byte-count small enough to make page arithmetic easy to read in the tests. */
const PS = 64

/**
 * A fake `fetchRange` (plan §11: never a `Blob`). Byte `i` of the document holds
 * `i & 0xff`. Every call is recorded, and `failWhen` lets a test make a chosen
 * range reject. Fetches resolve on a microtask; `settle()` waits a macrotask so
 * the cache's promotion bookkeeping has run.
 */
function makeSource(size: number) {
  const calls: Array<{ start: number; end: number }> = []
  let shouldFail: (start: number, end: number) => boolean = () => false

  const bytesFor = (start: number, end: number): Uint8Array => {
    const bytes = new Uint8Array(Math.max(0, end - start))
    for (let i = 0; i < bytes.length; i++) bytes[i] = (start + i) & 0xff
    return bytes
  }

  const fetchRange: FetchRange = (start, end) => {
    calls.push({ start, end })
    return shouldFail(start, end)
      ? Promise.reject(new Error(`fetch rejected [${start}, ${end})`))
      : Promise.resolve(bytesFor(start, end))
  }

  return {
    size,
    fetchRange,
    calls,
    bytesFor,
    failWhen(pred: (start: number, end: number) => boolean) {
      shouldFail = pred
    },
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('PageCache', () => {
  describe('LRU pool', () => {
    it('evicts in LRU order when a small capacity is injected', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 3 })

      await cache.read(0 * PS, 1)
      await cache.read(1 * PS, 1)
      await cache.read(2 * PS, 1)
      expect(cache.stats.pagesResident).toBe(3)
      expect(cache.stats.evictions).toBe(0)

      await cache.read(3 * PS, 1) // evicts page 0, the least-recently-used
      expect(cache.stats.evictions).toBe(1)
      expect(cache.stats.pagesResident).toBe(3)
      expect(cache.readSync(0 * PS, 1)).toBeNull()
      expect(cache.readSync(1 * PS, 1)).not.toBeNull()
      expect(cache.readSync(3 * PS, 1)).not.toBeNull()
    })

    it('promotes to MRU on a read hit, sparing it from the next eviction', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 3 })
      await cache.read(0, 1)
      await cache.read(PS, 1)
      await cache.read(2 * PS, 1) // resident LRU→MRU: [0, 1, 2]

      await cache.read(0, 1) // hit → promote 0 → [1, 2, 0]
      await cache.read(3 * PS, 1) // evicts 1, the new LRU

      expect(cache.readSync(PS, 1)).toBeNull()
      expect(cache.readSync(0, 1)).not.toBeNull()
    })

    it('promotes to MRU on a readSync hit — the per-frame path keeps the working set warm', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 3 })
      await cache.read(0, 1)
      await cache.read(PS, 1)
      await cache.read(2 * PS, 1)

      expect(cache.readSync(0, 1)).not.toBeNull() // hit → promote 0
      await cache.read(3 * PS, 1) // evicts 1, not 0

      expect(cache.readSync(PS, 1)).toBeNull()
      expect(cache.readSync(0, 1)).not.toBeNull()
    })

    it('defaults to 64 KiB pages and a 256-page (≤ 16 MiB) ceiling', async () => {
      const KIB64 = 64 * 1024
      const src = makeSource(64 * 1024 * 1024)
      const cache = new PageCache(src) // no options

      await cache.read(0, 1)
      await cache.read(KIB64, 1)
      expect(src.calls).toEqual([
        { start: 0, end: KIB64 },
        { start: KIB64, end: 2 * KIB64 },
      ])

      for (let page = 2; page < 256; page++) await cache.read(page * KIB64, 1)
      expect(cache.stats.pagesResident).toBe(256)
      expect(cache.stats.evictions).toBe(0)

      await cache.read(256 * KIB64, 1) // the 257th page
      expect(cache.stats.evictions).toBe(1)
      expect(cache.stats.pagesResident).toBe(256)
    })
  })

  describe('coalescing', () => {
    it('joins a strictly-contiguous run of missing pages into one fetch', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })

      await cache.read(0, 3 * PS) // pages 0, 1, 2 — all missing

      expect(src.calls).toEqual([{ start: 0, end: 3 * PS }])
    })

    it('caps a coalesced fetch at 16 pages / 1 MiB', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })

      await cache.read(0, 20 * PS) // 20 contiguous missing pages

      expect(src.calls).toEqual([
        { start: 0, end: 16 * PS },
        { start: 16 * PS, end: 20 * PS },
      ])
      expect(src.calls.every((c) => c.end - c.start <= 16 * PS)).toBe(true)
    })

    it('does not bridge a resident page — it splits the run instead', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })
      await cache.read(PS, 1) // page 1 resident
      src.calls.length = 0

      await cache.read(0, 3 * PS) // pages 0, 1, 2 — 1 is resident

      expect(src.calls).toEqual([
        { start: 0, end: PS },
        { start: 2 * PS, end: 3 * PS },
      ])
    })

    it('shares a single in-flight fetch across concurrent reads of one page', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })

      const a = cache.read(0, 32)
      const b = cache.read(16, 32) // same page 0, still in flight
      expect(cache.stats.pendingCount).toBe(1)

      await Promise.all([a, b])
      expect(src.calls).toEqual([{ start: 0, end: PS }])
    })
  })

  describe('the resident + pending ceiling', () => {
    it('keeps resident + pending within capacity under concurrent misses', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 2 })

      const reads = [
        cache.read(0, 1),
        cache.read(PS, 1),
        cache.read(2 * PS, 1),
        cache.read(3 * PS, 1),
      ]
      const stats = cache.stats // sync prefixes have run; fetches are in flight
      expect(stats.pendingCount).toBe(2)
      expect(stats.pagesResident).toBe(0)
      expect(stats.pendingCount + stats.pagesResident).toBeLessThanOrEqual(2)

      const out = await Promise.all(reads)
      expect(out.map((b) => b[0])).toEqual([0, PS & 0xff, (2 * PS) & 0xff, (3 * PS) & 0xff])
      expect(cache.stats.pagesResident).toBe(2)
    })

    it('pins pending pages — a further miss is served uncached, not by evicting them', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 2 })

      const pinned = [cache.read(0, 1), cache.read(PS, 1)]
      const overflow = cache.read(2 * PS, 1)
      expect(cache.stats.pendingCount).toBe(2) // the two pinned, never three

      const results = await Promise.all([...pinned, overflow])
      expect(Array.from(results[2]!)).toEqual([(2 * PS) & 0xff]) // still served correctly
      expect(cache.readSync(2 * PS, 1)).toBeNull() // but it never entered the pool
      expect(cache.stats.pagesResident).toBe(2)
    })
  })

  describe('prefetch', () => {
    it('warms the covering pages plus one either side, symmetrically', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })

      cache.prefetch(5 * PS + 10, 4) // visible span sits inside page 5
      await settle()

      expect(src.calls).toEqual([{ start: 4 * PS, end: 7 * PS }]) // pages 4, 5, 6
      expect(cache.readSync(4 * PS, 1)).not.toBeNull()
      expect(cache.readSync(6 * PS, 1)).not.toBeNull()
    })

    it('clamps the expanded span to the document size', async () => {
      const src = makeSource(2 * PS) // pages 0 and 1 only
      const cache = new PageCache(src, { pageSize: PS })

      cache.prefetch(PS + 4, 8) // span page 1; +1 would be page 2, past EOF
      await settle()

      expect(src.calls).toEqual([{ start: 0, end: 2 * PS }])
    })

    it('never pushes resident + pending past capacity', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 3 })
      await cache.read(0, 1)

      cache.prefetch(2 * PS, 1) // wants pages 1, 2, 3 → total would be 4
      await settle()

      const stats = cache.stats
      expect(stats.pagesResident + stats.pendingCount).toBeLessThanOrEqual(3)
    })

    it('inserts prefetched pages at MRU so the next fetch does not evict them', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 3 })
      await cache.read(0, 1) // [0]
      await cache.read(PS, 1) // [0, 1]

      cache.prefetch(2 * PS, 1) // pages 2, 3 missing → evict 0 → resident [1, 2, 3]
      await settle()
      expect(cache.readSync(0, 1)).toBeNull()

      await cache.read(4 * PS, 1) // evicts the LRU — page 1, not a prefetched page
      expect(cache.readSync(PS, 1)).toBeNull()
      expect(cache.readSync(2 * PS, 1)).not.toBeNull()
      expect(cache.readSync(3 * PS, 1)).not.toBeNull()
    })

    it('never throws and is a no-op on an empty document', async () => {
      const empty = new PageCache(makeSource(0), { pageSize: PS })
      expect(() => empty.prefetch(0, 10)).not.toThrow()

      const cache = new PageCache(makeSource(1000), { pageSize: PS })
      expect(() => cache.prefetch(-5, -5)).not.toThrow()
      await settle()
      expect(cache.stats.bytesFetched).toBe(0)
    })
  })

  describe('direct reads', () => {
    it('serves a read over the threshold without populating any page', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, directReadThreshold: 4 * PS })

      const bytes = await cache.read(0, 10 * PS) // 640 B > 256 B threshold
      expect(bytes).toHaveLength(10 * PS)
      expect(Array.from(bytes.slice(0, 3))).toEqual([0, 1, 2])
      expect(cache.stats.pagesResident).toBe(0)
      expect(cache.stats.pendingCount).toBe(0)
      expect(cache.readSync(0, 1)).toBeNull()
      expect(cache.stats.bytesFetched).toBe(10 * PS)
    })

    it('reuses resident pages and fetches only the gaps', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, directReadThreshold: 5 * PS })
      await cache.read(3 * PS, 1) // page 3 resident
      src.calls.length = 0

      const bytes = await cache.read(0, 6 * PS) // 384 B > 320 B → direct read
      expect(bytes).toHaveLength(6 * PS)

      // Page 3's range is never re-fetched.
      expect(src.calls.some((c) => c.start < 4 * PS && c.end > 3 * PS)).toBe(false)
      const fetched = src.calls.reduce((n, c) => n + (c.end - c.start), 0)
      expect(fetched).toBe(6 * PS - PS) // five pages fetched, page 3 reused

      // …and the bytes are still whole across the seam.
      expect(Array.from(bytes.slice(3 * PS, 3 * PS + 3))).toEqual([
        (3 * PS) & 0xff,
        (3 * PS + 1) & 0xff,
        (3 * PS + 2) & 0xff,
      ])
      expect(cache.stats.pagesResident).toBe(1) // nothing new populated
    })
  })

  describe('a failed coalesced run', () => {
    it('rejects every page in the run and removes the entries — no negative caching', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })
      src.failWhen(() => true)

      await expect(cache.read(0, 3 * PS)).rejects.toThrow(/fetch rejected/)
      expect(cache.stats.pagesResident).toBe(0)
      expect(cache.stats.pendingCount).toBe(0)
      expect(src.calls).toHaveLength(1)

      src.failWhen(() => false)
      const bytes = await cache.read(0, 3 * PS) // retried, not served from a negative cache
      expect(src.calls).toHaveLength(2)
      expect(Array.from(bytes.slice(0, 3))).toEqual([0, 1, 2])
    })
  })

  describe('stats', () => {
    it('reports hits, misses, evictions, resident, pending and bytesFetched', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS, capacityPages: 2 })

      expect(cache.stats).toEqual({
        hits: 0,
        misses: 0,
        evictions: 0,
        pagesResident: 0,
        pendingCount: 0,
        bytesFetched: 0,
      })

      await cache.read(0, PS)
      expect(cache.stats).toMatchObject({ hits: 0, misses: 1, pagesResident: 1, bytesFetched: PS })

      await cache.read(0, PS) // full hit (async path)
      cache.readSync(0, PS) // full hit (sync path)
      expect(cache.stats).toMatchObject({ hits: 2, misses: 1 })

      await cache.read(PS, PS)
      await cache.read(2 * PS, PS) // evicts page 0
      expect(cache.stats).toMatchObject({
        misses: 3,
        evictions: 1,
        pagesResident: 2,
        bytesFetched: 3 * PS,
      })

      const pending = cache.read(9 * PS, PS)
      expect(cache.stats.pendingCount).toBe(1)
      await pending
    })
  })

  describe('the frozen ByteSource contract', () => {
    it('hands back caller-owned copies, never a view into a page', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })

      const first = await cache.read(0, 8)
      first.fill(0xff)
      expect(Array.from(await cache.read(0, 8))).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

      const sync = cache.readSync(0, 8)!
      sync.fill(0xff)
      expect(Array.from(cache.readSync(0, 8)!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    })

    it('returns min(length, size - offset) across EOF and empty past it', async () => {
      const src = makeSource(100)
      const cache = new PageCache(src, { pageSize: PS })

      const tail = await cache.read(90, 50)
      expect(Array.from(tail)).toEqual(Array.from({ length: 10 }, (_u, i) => (90 + i) & 0xff))
      expect(await cache.read(100, 10)).toHaveLength(0)
      expect(await cache.read(200, 10)).toHaveLength(0)
      expect(cache.readSync(100, 10)).toHaveLength(0)
    })

    it('throws only for negative or NaN arguments; readSync just returns null', async () => {
      const src = makeSource(100)
      const cache = new PageCache(src, { pageSize: PS })

      await expect(cache.read(-1, 4)).rejects.toBeInstanceOf(RangeError)
      await expect(cache.read(0, -4)).rejects.toBeInstanceOf(RangeError)
      await expect(cache.read(Number.NaN, 4)).rejects.toBeInstanceOf(RangeError)
      await expect(cache.read(0, 0)).resolves.toHaveLength(0)

      expect(cache.readSync(-1, 4)).toBeNull()
      expect(cache.readSync(0, Number.NaN)).toBeNull()
    })

    it('readSync stays null until every covering page is resident, spanning pages once they are', async () => {
      const src = makeSource(1 << 20)
      const cache = new PageCache(src, { pageSize: PS })

      expect(cache.readSync(0, 2 * PS)).toBeNull()
      await cache.read(0, PS) // page 0 only
      expect(cache.readSync(0, 2 * PS)).toBeNull() // page 1 still missing
      await cache.read(PS, PS) // page 1 now resident

      const spanned = cache.readSync(PS - 4, 8)!
      expect(spanned).not.toBeNull()
      expect(Array.from(spanned)).toEqual(Array.from({ length: 8 }, (_u, i) => (PS - 4 + i) & 0xff))
    })
  })
})
