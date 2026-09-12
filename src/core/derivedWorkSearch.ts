import type { SearchParams, SearchProgressExtra, SearchResult } from './DerivedWork'
import {
  type Bytes,
  chunkedReadAhead,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_READ_AHEAD_DEPTH,
} from './derivedWorkChunkedRead'

/**
 * The pure hex-byte-sequence forward scan `derived-work.worker.ts` dispatches
 * a `'search'` job to. Reads `file` directly — not through ByteSource /
 * PageCache (ADR-0013) — with depth-N `prefetch()`-style read-ahead and
 * time-budgeted yielding, both validated by issue #96's benchmark
 * (`docs/research/derived-work-scan-performance.md`).
 */

/** #96 Scenario C: time-budgeted, not chunk-counted — the cadence self-adjusts. */
const DEFAULT_YIELD_BUDGET_MS = 8

export interface SearchScanOptions {
  readonly chunkSize?: number
  readonly readAheadDepth?: number
  readonly yieldBudgetMs?: number
  readonly onProgress?: (percent: number, extra: SearchProgressExtra) => void
  readonly isCancelled?: () => boolean
  readonly now?: () => number
  readonly yieldToEventLoop?: () => Promise<void>
}

export interface SearchScanOutcome {
  readonly result: SearchResult
  readonly cancelled: boolean
}

function matchesAt(bytes: Bytes, offset: number, pattern: Uint8Array): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[offset + i] !== pattern[i]) return false
  }
  return true
}

function concat(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * The trailing `keepLen` bytes seen so far, carried forward so the next
 * chunk's boundary check can complete a match that starts in this chunk's
 * tail. Bounded by `keepLen` (`pattern.length - 1`, small) regardless of
 * chunk size — never a full-chunk copy.
 */
function nextCarry(carry: Bytes, bytes: Bytes, keepLen: number): Bytes {
  if (keepLen <= 0) return new Uint8Array(0)
  if (bytes.length >= keepLen) return bytes.slice(bytes.length - keepLen)
  const tail = concat(carry, bytes)
  return tail.length > keepLen ? tail.slice(tail.length - keepLen) : tail
}

const defaultYieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Forward hex-byte-sequence search over `file`, whole-file only (ADR-0013;
 * this ticket). Matches straddling a chunk boundary are found by carrying the
 * trailing `pattern.length - 1` bytes of each chunk forward into the next.
 * Cancellation is checked between chunks, never mid-chunk; yielding to the
 * caller's event loop happens once a time budget elapses, not on a fixed
 * chunk count (#96 Scenario C).
 */
export async function searchForward(
  file: File,
  params: SearchParams,
  options: SearchScanOptions = {},
): Promise<SearchScanOutcome> {
  const pattern = params.pattern
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE
  const depth = options.readAheadDepth ?? DEFAULT_READ_AHEAD_DEPTH
  const yieldBudgetMs = options.yieldBudgetMs ?? DEFAULT_YIELD_BUDGET_MS
  const isCancelled = options.isCancelled ?? ((): boolean => false)
  const now = options.now ?? ((): number => performance.now())
  const yieldToEventLoop = options.yieldToEventLoop ?? defaultYieldToEventLoop

  const size = file.size
  const matches: number[] = []

  if (pattern.length === 0 || size === 0) {
    options.onProgress?.(1, { matchCount: 0 })
    return { result: { matches: new Float64Array(0) }, cancelled: false }
  }

  const chunks = chunkedReadAhead(file, 0, size, { chunkSize, readAheadDepth: depth })

  const keepLen = pattern.length - 1
  let carry = new Uint8Array(0)
  let lastYield = now()
  let cancelled = false

  while (true) {
    if (isCancelled()) {
      cancelled = true
      break
    }

    const step = await chunks.next()
    if (step.done) break
    const { offset, bytes } = step.value

    // Matches starting in the carried tail of the previous chunk: only the
    // carry plus this chunk's first `keepLen` bytes can complete one, so the
    // boundary check is bounded by pattern length, never a full chunk copy.
    if (carry.length > 0) {
      const boundaryTail = bytes.subarray(0, Math.min(bytes.length, keepLen))
      const boundary = concat(carry, boundaryTail)
      const boundaryBase = offset - carry.length
      const limit = Math.min(carry.length - 1, boundary.length - pattern.length)
      for (let i = 0; i <= limit; i++) {
        if (matchesAt(boundary, i, pattern)) {
          matches.push(boundaryBase + i)
        }
      }
    }

    // Matches starting within this chunk itself.
    const limit = bytes.length - pattern.length
    for (let i = 0; i <= limit; i++) {
      if (matchesAt(bytes, i, pattern)) {
        matches.push(offset + i)
      }
    }

    carry = nextCarry(carry, bytes, keepLen)

    options.onProgress?.((offset + bytes.length) / size, { matchCount: matches.length })

    if (now() - lastYield >= yieldBudgetMs) {
      await yieldToEventLoop()
      lastYield = now()
    }
  }

  return { result: { matches: Float64Array.from(matches) }, cancelled }
}
