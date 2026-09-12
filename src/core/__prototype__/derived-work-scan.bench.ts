/**
 * Derived-work scan performance harness — issue #96
 * (https://github.com/carllom/bint2/issues/96).
 *
 * Throwaway research code on branch `research/derived-work-scan-performance`;
 * not intended to merge to `main`. Findings are written up in
 * `docs/research/derived-work-scan-performance.md`.
 *
 * Question: Phase 2's derived work (search, entropy map, byte histogram — see
 * issue #95) all need one thing at their core: a full sequential scan over a
 * document, computing something incremental as they go. Is the frozen
 * `ByteSource.read()` / `readSync()` random-access interface (ADR-0001) enough
 * to drive that scan, or does a dedicated sequential-scan primitive (no
 * offset re-specification, internal read-ahead) win anything measurable? Feeds
 * issue #99 (the worker-crossing interface for derived work).
 *
 * Approach: a running byte-frequency histogram (256 counts) — the shared
 * computational core of both the entropy map and the byte histogram, and a
 * fair proxy for "search" too (both are O(bytes), single sequential pass,
 * bounded per-byte work) — driven purely through `ByteSource.read()` /
 * `prefetch()`, the interface exactly as frozen, never touched here.
 *
 * Run (not part of `npm run test:unit` / CI — see `vitest.bench.config.ts`):
 *
 *   npx vitest run --config vitest.bench.config.ts
 *
 * Reading the output: each `report()` line is one scan. `wall` is the whole
 * scan's wall-clock time; the rest describes the *distribution* of individual
 * `read()`-to-histogram-updated latencies, `over16ms` counts how many of those
 * individual steps alone would have blown a 16 ms frame budget.
 */

import { describe, it } from 'vitest'
import type { ByteSource } from '../index'
import { FileByteSource, PageCache } from '../index'

const KiB = 1024
const MiB = 1024 * KiB
const FRAME_BUDGET_MS = 16
const CHUNK_SIZES = [64 * KiB, 256 * KiB, 1 * MiB]

// ---------------------------------------------------------------------------
// Shared histogram compute — the payload every scenario below runs per chunk.
// ---------------------------------------------------------------------------

function newHistogram(): Uint32Array {
  return new Uint32Array(256)
}

function accumulate(hist: Uint32Array, bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i]!
    hist[value] = (hist[value] ?? 0) + 1
  }
}

/**
 * `i & 0xff` over a long contiguous run is uniform to within one wraparound
 * per bucket. A broken accumulate loop (wrong index, double-count, dropped
 * tail chunk) shows up as a bucket well outside a generous 5% band — this is
 * a correctness guard on the harness itself, not a performance assertion.
 */
function assertUniformHistogram(hist: Uint32Array, totalBytes: number): void {
  const expected = totalBytes / 256
  for (let b = 0; b < 256; b++) {
    const count = hist[b] ?? 0
    const delta = Math.abs(count - expected) / expected
    if (delta > 0.05) {
      throw new Error(
        `histogram sanity check failed at bucket ${b}: got ${count}, expected ~${expected.toFixed(0)}`,
      )
    }
  }
}

/**
 * Fill `bytes[i] = i & 0xff` in O(log n) `set()` calls instead of one JS write
 * per byte, by doubling an already-filled prefix. Fixture setup, never
 * measured — keeps building a several-hundred-MiB `File` fast.
 */
function fillCyclic(bytes: Uint8Array): void {
  const unit = Math.min(256, bytes.length)
  for (let i = 0; i < unit; i++) bytes[i] = i & 0xff
  let filled = unit
  while (filled < bytes.length) {
    const take = Math.min(filled, bytes.length - filled)
    bytes.set(bytes.subarray(0, take), filled)
    filled += take
  }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

interface ChunkStats {
  count: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  overBudget: number
}

function summarize(times: number[]): ChunkStats {
  const sorted = [...times].sort((a, b) => a - b)
  const total = times.reduce((a, b) => a + b, 0)
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  return {
    count: times.length,
    meanMs: total / (times.length || 1),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    overBudget: times.filter((t) => t > FRAME_BUDGET_MS).length,
  }
}

function report(label: string, chunkSize: number, wallMs: number, stats: ChunkStats): void {
  console.log(
    `[${label}] chunk=${Math.round(chunkSize / KiB)}KiB chunks=${stats.count} ` +
      `wall=${wallMs.toFixed(1)}ms mean=${stats.meanMs.toFixed(4)}ms ` +
      `p50=${stats.p50Ms.toFixed(4)}ms p95=${stats.p95Ms.toFixed(4)}ms ` +
      `max=${stats.maxMs.toFixed(4)}ms over16ms=${stats.overBudget}`,
  )
}

// ---------------------------------------------------------------------------
// Scan drivers — every one of these is built only on the frozen ByteSource
// surface (`read`, `readSync`, `prefetch`). None of them touch ByteSource.
// ---------------------------------------------------------------------------

/**
 * Naive: `read(offset, length)` in a loop, re-specifying `offset` every call —
 * the shape #96 is asked to validate or refute. `yieldEveryChunks > 0` inserts
 * a real macrotask yield (`setTimeout(0)`, not just another microtask) every
 * N chunks — the thing a microtask `await` on an already-resolving promise
 * does *not* give you for free.
 */
async function scanNaive(
  source: ByteSource,
  chunkSize: number,
  hist: Uint32Array,
  yieldEveryChunks = 0,
): Promise<{ wallMs: number; stats: ChunkStats }> {
  const times: number[] = []
  const t0 = performance.now()
  let offset = 0
  let n = 0
  while (offset < source.size) {
    const len = Math.min(chunkSize, source.size - offset)
    const t1 = performance.now()
    const bytes = await source.read(offset, len)
    accumulate(hist, bytes)
    times.push(performance.now() - t1)
    offset += len
    n++
    if (yieldEveryChunks > 0 && n % yieldEveryChunks === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  return { wallMs: performance.now() - t0, stats: summarize(times) }
}

/**
 * Read-ahead-of-one-chunk: kicks off the next chunk's `read()` before
 * processing the current one, so the next fetch is in flight while this
 * chunk's histogram update runs. Built entirely on `read()` — no ByteSource
 * change. Only overlaps *compute* time against the next fetch's latency; see
 * `scanPrefetchAhead` below for overlapping *fetch* time against fetch time.
 */
async function scanPipelined(
  source: ByteSource,
  chunkSize: number,
  hist: Uint32Array,
): Promise<{ wallMs: number; stats: ChunkStats }> {
  const times: number[] = []
  const t0 = performance.now()
  let offset = 0
  let pending = source.read(offset, Math.min(chunkSize, source.size - offset))
  while (offset < source.size) {
    const t1 = performance.now()
    const bytes = await pending
    const nextOffset = offset + bytes.length
    if (nextOffset < source.size) {
      pending = source.read(nextOffset, Math.min(chunkSize, source.size - nextOffset))
    }
    accumulate(hist, bytes)
    times.push(performance.now() - t1)
    offset = nextOffset
  }
  return { wallMs: performance.now() - t0, stats: summarize(times) }
}

/**
 * Depth-N lookahead using nothing but the *existing, frozen* fire-and-forget
 * `prefetch()` to keep `depth` chunks warm ahead of the `read()` cursor. This
 * is the real test of "would a dedicated sequential primitive help": if this
 * userland wrapper — zero ByteSource changes — captures most of the win a
 * bespoke primitive could offer, no new interface is needed.
 */
async function scanPrefetchAhead(
  source: ByteSource,
  chunkSize: number,
  hist: Uint32Array,
  depth: number,
): Promise<{ wallMs: number; stats: ChunkStats }> {
  const times: number[] = []
  const t0 = performance.now()
  let offset = 0
  let warmedUpTo = 0

  const topUp = (): void => {
    while (warmedUpTo < source.size && warmedUpTo < offset + depth * chunkSize) {
      const len = Math.min(chunkSize, source.size - warmedUpTo)
      source.prefetch(warmedUpTo, len)
      warmedUpTo += len
    }
  }

  topUp()
  while (offset < source.size) {
    const len = Math.min(chunkSize, source.size - offset)
    const t1 = performance.now()
    const bytes = await source.read(offset, len)
    accumulate(hist, bytes)
    times.push(performance.now() - t1)
    offset += len
    topUp()
  }
  return { wallMs: performance.now() - t0, stats: summarize(times) }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Scenario A's fixture: a real in-memory `File`, read through the real,
 * unmodified `FileByteSource` — exercising actual `Blob.slice().arrayBuffer()`
 * cost (already characterized in #5: sub-ms, off-main-thread at page
 * granularity on disk-backed files) plus the real `PageCache` bookkeeping.
 */
function realFile(size: number): File {
  const bytes = new Uint8Array(size)
  fillCyclic(bytes)
  return new File([bytes], 'derived-work-scan-fixture.bin')
}

/**
 * Scenarios B/D/E's fixture: `FileByteSource`'s own shape — a real `PageCache`
 * doing real bookkeeping, behind the real `ByteSource` contract — pointed at a
 * fabricated `fetchRange` instead of a real `File.slice()`. This is the plan's
 * "synthetic ByteSource that fabricates a huge logical size" substitution
 * (matches `src/components/__tests__/HexViewer.spec.ts`'s `SyntheticByteSource`
 * convention: byte `i` holds `i & 0xff`, nothing near the whole document is
 * ever allocated), extended to run the *production* `PageCache` rather than
 * bypass it, so the measured bookkeeping cost is real.
 *
 * `latencyMs`, when set, simulates a slower underlying medium than an
 * in-process byte-generator — used only to bound how much a read-ahead
 * primitive could ever win. It is a dial, not a claim: issue #5 already
 * measured the real number for this codebase's actual medium (local
 * `Blob.slice().arrayBuffer()`, sub-ms and off-main-thread).
 */
class SyntheticFileByteSource implements ByteSource {
  readonly size: number
  readonly #cache: PageCache

  constructor(size: number, latencyMs = 0) {
    this.size = size
    this.#cache = new PageCache({
      size,
      fetchRange: async (start, end) => {
        if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
        const bytes = new Uint8Array(end - start)
        for (let i = 0; i < bytes.length; i++) bytes[i] = (start + i) & 0xff
        return bytes
      },
    })
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    return this.#cache.read(offset, length)
  }

  readSync(offset: number, length: number): Uint8Array | null {
    return this.#cache.readSync(offset, length)
  }

  prefetch(offset: number, length: number): void {
    this.#cache.prefetch(offset, length)
  }

  close(): void {
    // Not exercised by this harness — no scenario below opens a source it
    // needs to tear down mid-scan.
  }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe('derived-work scan performance (issue #96 — manual pass, not run in CI)', () => {
  it(
    'A — real FileByteSource over a 256 MiB in-memory File, naive read() loop',
    { timeout: 180_000 },
    async () => {
      const size = 256 * MiB
      for (const chunkSize of CHUNK_SIZES) {
        const source = new FileByteSource(realFile(size))
        const hist = newHistogram()
        const { wallMs, stats } = await scanNaive(source, chunkSize, hist)
        assertUniformHistogram(hist, size)
        report('A real-File naive', chunkSize, wallMs, stats)
      }
    },
  )

  it(
    'B — fabricated 4e9-byte size through production PageCache, naive read() loop',
    { timeout: 180_000 },
    async () => {
      const size = 4_000_000_000 // matches the plan's `size = 2e9`-scale convention, doubled
      for (const chunkSize of CHUNK_SIZES) {
        const source = new SyntheticFileByteSource(size)
        const hist = newHistogram()
        const { wallMs, stats } = await scanNaive(source, chunkSize, hist)
        assertUniformHistogram(hist, size)
        report('B fabricated-4e9 naive', chunkSize, wallMs, stats)
      }
    },
  )

  it(
    'C — yielding vs non-yielding: does the frame budget survive a real scan?',
    { timeout: 180_000 },
    async () => {
      const size = 256 * MiB
      const chunkSize = 256 * KiB

      const none = await scanNaive(new FileByteSource(realFile(size)), chunkSize, newHistogram(), 0)
      report('C non-yielding', chunkSize, none.wallMs, none.stats)

      const everyChunk = await scanNaive(
        new FileByteSource(realFile(size)),
        chunkSize,
        newHistogram(),
        1,
      )
      report('C yield-every-chunk', chunkSize, everyChunk.wallMs, everyChunk.stats)

      const every16 = await scanNaive(
        new FileByteSource(realFile(size)),
        chunkSize,
        newHistogram(),
        16,
      )
      report('C yield-every-16-chunks', chunkSize, every16.wallMs, every16.stats)
    },
  )

  it(
    'D — naive vs single-chunk-lookahead pipelining, with and without simulated I/O latency',
    { timeout: 60_000 },
    async () => {
      const size = 16 * MiB
      const chunkSize = 256 * KiB

      for (const latencyMs of [0, 2]) {
        const naive = await scanNaive(
          new SyntheticFileByteSource(size, latencyMs),
          chunkSize,
          newHistogram(),
        )
        report(`D naive latency=${latencyMs}ms`, chunkSize, naive.wallMs, naive.stats)

        const pipelined = await scanPipelined(
          new SyntheticFileByteSource(size, latencyMs),
          chunkSize,
          newHistogram(),
        )
        report(`D pipelined latency=${latencyMs}ms`, chunkSize, pipelined.wallMs, pipelined.stats)
      }
    },
  )

  it(
    'E — depth-N prefetch() ahead of the read() cursor, under simulated I/O latency',
    { timeout: 60_000 },
    async () => {
      const size = 16 * MiB
      const chunkSize = 256 * KiB
      const latencyMs = 2

      for (const depth of [0, 2, 4]) {
        const { wallMs, stats } = await scanPrefetchAhead(
          new SyntheticFileByteSource(size, latencyMs),
          chunkSize,
          newHistogram(),
          depth,
        )
        report(`E prefetch-depth=${depth} latency=${latencyMs}ms`, chunkSize, wallMs, stats)
      }
    },
  )

  it(
    'F — depth-N prefetch() ahead, at the *real* (no injected latency) 1 MiB-chunk cost profile',
    { timeout: 180_000 },
    async () => {
      // Same fabricated-size / no-artificial-latency profile as Scenario B's
      // worst-per-chunk-mean case (1 MiB chunks, ~4.7ms mean there) — the
      // question is whether depth-N prefetch still helps when the per-chunk
      // cost is dispatch/copy overhead rather than an injected wait, i.e.
      // whether Scenario E's win was an artifact of the latency knob.
      const size = 512 * MiB
      const chunkSize = 1 * MiB

      for (const depth of [0, 2, 4]) {
        const { wallMs, stats } = await scanPrefetchAhead(
          new SyntheticFileByteSource(size),
          chunkSize,
          newHistogram(),
          depth,
        )
        report(`F prefetch-depth=${depth} no-latency`, chunkSize, wallMs, stats)
      }
    },
  )
})
