import type { SelectionRange } from './selection'

/**
 * Pure geometry for the Entropy panel's Map view (#107, CONTEXT.md's Entropy
 * map, ADR-0012, plan-phase2.md §4.4) — the positional-strip counterpart to
 * `bitmap.ts`'s pixel-grid geometry. The Map renders one completed `'stats'`
 * result (`StatsResult.entropy`) as a single horizontal strip, one canvas
 * pixel per block; these functions are the click <-> block-index mapping and
 * the block-index -> byte-range mapping, kept framework-free so they are
 * directly unit-testable against known fixtures.
 */

export interface EntropyBlockAtParams {
  /** Canvas-relative x in CSS px — `event.clientX - canvas.getBoundingClientRect().left`. */
  readonly x: number
  /** The canvas element's *displayed* (CSS) width — `getBoundingClientRect().width` — distinct from its intrinsic pixel width (`numBlocks`), since the strip is stretched to fill the panel. */
  readonly displayWidth: number
  /** `StatsResult.entropy.length` for the result currently rendered. */
  readonly numBlocks: number
}

/**
 * The block index a strip click lands on: `x` scaled from the canvas's
 * *displayed* width onto `numBlocks` — the mirror of `bitmapOffsetAt`'s pixel
 * math, but one-dimensional and proportional rather than a fixed pixel grid,
 * since the strip is CSS-stretched to the panel's width. `null` outside
 * `[0, displayWidth)`, or with nothing rendered (`numBlocks <= 0`).
 */
export function entropyBlockAt({ x, displayWidth, numBlocks }: EntropyBlockAtParams): number | null {
  if (numBlocks <= 0 || displayWidth <= 0 || x < 0 || x >= displayWidth) {
    return null
  }
  const index = Math.floor((x / displayWidth) * numBlocks)
  // Floating-point rounding at the strip's trailing edge could otherwise land
  // exactly on `numBlocks` — clamp back onto the last real block.
  return Math.min(index, numBlocks - 1)
}

export interface EntropyBlockRangeParams {
  /** The scanned range's first byte (`StatsParams.range.start` the current result answers for). */
  readonly rangeStart: number
  /** The scanned range's end, exclusive (`StatsParams.range.end`) — bounds the final, possibly short, block. */
  readonly rangeEnd: number
  /** Bytes per block (`StatsParams.blockSize`) for the current result. */
  readonly blockSize: number
  /** Which block, `0`-based. */
  readonly blockIndex: number
}

/**
 * The half-open byte range `[start, end)` a block covers — mirrors
 * `computeStats`'s own `bytesInBlock`: every block is `blockSize` bytes
 * except a shorter final one clipped to `rangeEnd`. Click-to-cursor (plan
 * §4.4) reads `start` for a plain click and `end - 1` (the block's last byte)
 * for Shift-click.
 */
export function entropyBlockRange({
  rangeStart,
  rangeEnd,
  blockSize,
  blockIndex,
}: EntropyBlockRangeParams): SelectionRange {
  const start = rangeStart + blockIndex * blockSize
  const end = Math.min(start + blockSize, rangeEnd)
  return { start, end }
}

export type EntropyColorTheme = 'dark' | 'light'

/** Shannon entropy is bounded `[0, 8]` bits per byte over a 256-value alphabet. */
const MAX_ENTROPY_BITS = 8
/** Green (low entropy) -> red (high entropy), passing through yellow at the midpoint. */
const HUE_LOW_ENTROPY = 120
const HUE_HIGH_ENTROPY = 0

/**
 * The Map's thermal gradient (plan §4.4): green -> yellow -> red as entropy
 * rises from 0 to 8 bits/byte, a straight hue interpolation. Saturation and
 * lightness are theme-adjusted constants, not hue-swapped — a deliberate
 * exception to the app's otherwise monochrome palette (ADR-0012), chosen so
 * the same entropy value reads as the same color under either theme, just at
 * a legible lightness against that theme's background. `entropyBits` is
 * clamped to `[0, 8]` — a caller never needs to pre-clamp a scan's output.
 */
export function entropyColor(entropyBits: number, theme: EntropyColorTheme = 'dark'): string {
  const t = Math.min(Math.max(entropyBits, 0), MAX_ENTROPY_BITS) / MAX_ENTROPY_BITS
  const hue = HUE_LOW_ENTROPY + t * (HUE_HIGH_ENTROPY - HUE_LOW_ENTROPY)
  const { saturation, lightness } = theme === 'dark' ? { saturation: 70, lightness: 45 } : { saturation: 65, lightness: 50 }
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`
}
