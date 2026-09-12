/**
 * Pure normalization math for the Entropy panel's Histogram view (#108,
 * CONTEXT.md's Byte histogram, ADR-0012, plan-phase2.md §4.5) — the bar-chart
 * counterpart to `entropyMap.ts`'s strip geometry. Both renderings share one
 * `StatsResult` (ADR-0012); these functions turn its raw `histogram` counts
 * into what the panel actually draws, kept framework-free so they are
 * directly unit-testable against known distributions.
 */

/** One normalized frequency per byte value (`histogram.length`, always 256). */
export type HistogramFrequencies = Float64Array

/**
 * `value[byte] = count[byte] / totalBytesInRange` (CONTEXT.md's Byte
 * histogram definition) — no positional axis, just each byte value's share
 * of the scanned range. All zero for an empty range rather than dividing by
 * zero.
 */
export function histogramFrequencies(histogram: Uint32Array): HistogramFrequencies {
  let total = 0
  for (let i = 0; i < histogram.length; i++) {
    total += histogram[i]!
  }
  const frequencies = new Float64Array(histogram.length)
  if (total === 0) {
    return frequencies
  }
  for (let i = 0; i < histogram.length; i++) {
    frequencies[i] = histogram[i]! / total
  }
  return frequencies
}

/** The largest frequency present — the range's own scale (plan §4.5), not a fixed 0-100% axis. */
export function maxFrequency(frequencies: HistogramFrequencies): number {
  let max = 0
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i]! > max) {
      max = frequencies[i]!
    }
  }
  return max
}

/**
 * A bar's height as a fraction of the tallest bar in the range — `0` when
 * `max` is `0` (an empty range, nothing to scale against) rather than `NaN`.
 */
export function barHeight(frequency: number, max: number): number {
  return max > 0 ? frequency / max : 0
}
