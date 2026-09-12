import type { StatsParams, StatsResult } from './DerivedWork'
import {
  chunkedReadAhead,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_READ_AHEAD_DEPTH,
} from './derivedWorkChunkedRead'

/**
 * The pure joint entropy/histogram scan `derived-work.worker.ts` dispatches a
 * `'stats'` job to (#98/#104, ADR-0012). One pass over `params.range`
 * produces both the per-block Shannon-entropy array and the global 256-value
 * byte-count histogram — the shared computational core behind the Entropy
 * map and Byte histogram, never run twice for the two renderings. Reads
 * `file` directly — not through ByteSource/PageCache (ADR-0013) — with the
 * same chunked, depth-N read-ahead, time-budgeted-yield shape issue #96
 * validated for search.
 */

/** #96 Scenario C: time-budgeted, not chunk-counted — the cadence self-adjusts. */
const DEFAULT_YIELD_BUDGET_MS = 8

export interface StatsScanOptions {
  readonly chunkSize?: number
  readonly readAheadDepth?: number
  readonly yieldBudgetMs?: number
  readonly onProgress?: (percent: number) => void
  readonly isCancelled?: () => boolean
  readonly now?: () => number
  readonly yieldToEventLoop?: () => Promise<void>
}

export interface StatsScanOutcome {
  readonly result: StatsResult
  readonly cancelled: boolean
}

const defaultYieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

/** Shannon entropy, in bits, of a 256-value count array over `total` samples. */
function shannonEntropy(counts: Uint32Array, total: number): number {
  if (total <= 0) return 0
  let entropy = 0
  for (let byte = 0; byte < 256; byte++) {
    const count = counts[byte]!
    if (count === 0) continue
    const p = count / total
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/**
 * Forward joint entropy/histogram scan over `params.range` of `file`
 * (whole-file or an arbitrary Selection-shaped sub-range). Blocks are
 * `blockSize` bytes each except a shorter final block; a block may straddle
 * a chunk boundary, so per-block counts are accumulated byte-by-byte across
 * chunks, tracked by a plain remaining-bytes-in-block counter rather than
 * dividing a byte's position by `blockSize` on every iteration. Cancellation
 * is checked between chunks, never mid-chunk; yielding to the caller's event
 * loop happens once a time budget elapses, not on a fixed chunk count (#96
 * Scenario C) — mirrors `searchForward`'s shape.
 */
export async function computeStats(
  file: File,
  params: StatsParams,
  options: StatsScanOptions = {},
): Promise<StatsScanOutcome> {
  const { range, blockSize } = params
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const depth = options.readAheadDepth ?? DEFAULT_READ_AHEAD_DEPTH
  const yieldBudgetMs = options.yieldBudgetMs ?? DEFAULT_YIELD_BUDGET_MS
  const isCancelled = options.isCancelled ?? ((): boolean => false)
  const now = options.now ?? ((): number => performance.now())
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop

  const rangeStart = range.start
  const rangeLength = Math.max(0, range.end - range.start)
  const histogram = new Uint32Array(256)

  if (rangeLength === 0 || blockSize <= 0) {
    options.onProgress?.(1)
    return { result: { entropy: new Float32Array(0), histogram }, cancelled: false }
  }

  const numBlocks = Math.ceil(rangeLength / blockSize)
  const entropy = new Float32Array(numBlocks)
  const bytesInBlock = (blockIndex: number): number =>
    blockIndex < numBlocks - 1 ? blockSize : rangeLength - blockSize * (numBlocks - 1)

  const rangeEnd = rangeStart + rangeLength
  const chunks = chunkedReadAhead(file, rangeStart, rangeEnd, { chunkSize, readAheadDepth: depth })

  let blockCounts = new Uint32Array(256)
  let currentBlock = 0
  let bytesLeftInBlock = bytesInBlock(0)
  let processed = 0
  let lastYield = now()
  let cancelled = false

  while (true) {
    if (isCancelled()) {
      cancelled = true
      break
    }

    const step = await chunks.next()
    if (step.done) break
    const { bytes } = step.value

    for (let i = 0; i < bytes.length; i++) {
      if (bytesLeftInBlock === 0) {
        entropy[currentBlock] = shannonEntropy(blockCounts, bytesInBlock(currentBlock))
        blockCounts = new Uint32Array(256)
        currentBlock++
        bytesLeftInBlock = bytesInBlock(currentBlock)
      }
      const byte = bytes[i]!
      blockCounts[byte] = blockCounts[byte]! + 1
      histogram[byte] = histogram[byte]! + 1
      bytesLeftInBlock--
    }

    processed += bytes.length
    options.onProgress?.(processed / rangeLength)

    if (now() - lastYield >= yieldBudgetMs) {
      await yieldToEventLoop()
      lastYield = now()
    }
  }

  if (!cancelled) {
    entropy[currentBlock] = shannonEntropy(blockCounts, bytesInBlock(currentBlock))
  }

  return { result: { entropy, histogram }, cancelled }
}
