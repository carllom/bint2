/**
 * The pure viewport surface (ADR-0006). Pure functions over a {@link
 * ViewportMetrics} input and nothing else — no state, no Vue, no DOM.
 *
 * **Frozen.** `topByteOffset` is the sole coordinate: an integer, always a
 * clamped multiple of `bytesPerRow`. `firstRow` is derived (`rowOfOffset`),
 * never stored. Every navigation action funnels through {@link clampTopOffset},
 * the single choke point. Actions themselves (`scrollByRows`, thumb drag, Goto)
 * are one-line compositions over this surface and live in the store, not here.
 *
 * All math is written for `size > 2^32`; every intermediate product stays below
 * 2^53. `src/core/__tests__/viewport.spec.ts` pins the round-trips, the clamp,
 * the min-thumb regime and a `MAX_SAFE_INTEGER` overflow probe.
 */

export interface ViewportMetrics {
  /** File size in bytes. May exceed 2^32. */
  size: number
  /** Bytes shown per row: 8 | 16 | 24 | 32. */
  bytesPerRow: number
  /** Usable row-area height, CSS px. */
  viewportPx: number
  /** Rendered row height, CSS px — measured from a probe glyph, an input here. */
  rowPx: number
  /** Scrollbar track height, CSS px. */
  trackPx: number
  /** Thumb-height floor so it stays a grab target; default 24. */
  minThumbPx: number
}

export interface ThumbGeometry {
  /** Thumb height, clamped to `[minThumbPx, trackPx]`. */
  thumbH: number
  /** Thumb top, in `[0, travel]`. */
  thumbY: number
  /** `trackPx - thumbH` — the pixels the thumb can move. */
  travel: number
}

/** `Math.floor(offset / bytesPerRow)`. */
export function rowOfOffset(offset: number, bytesPerRow: number): number {
  return Math.floor(offset / bytesPerRow)
}

/** `row * bytesPerRow`. */
export function offsetOfRow(row: number, bytesPerRow: number): number {
  return row * bytesPerRow
}

/** Total rows in the document, rounding up so a short final row still counts. */
export function rowCount(m: ViewportMetrics): number {
  return Math.ceil(m.size / m.bytesPerRow)
}

/** Whole rows that fit in the row area, floored, never below 1. */
export function visibleRows(m: ViewportMetrics): number {
  return Math.max(1, Math.floor(m.viewportPx / m.rowPx))
}

/** The last row that can sit at the top of the viewport, never below 0. */
export function maxFirstRow(m: ViewportMetrics): number {
  return Math.max(0, rowCount(m) - visibleRows(m))
}

/**
 * The single navigation choke point: align an arbitrary byte offset **down** to
 * a row boundary, then clamp to `[0, maxFirstRow * bytesPerRow]`. A non-finite
 * candidate is coerced to a valid boundary rather than propagating NaN, so
 * `topByteOffset` is always an integer multiple of `bytesPerRow`.
 */
export function clampTopOffset(offset: number, m: ViewportMetrics): number {
  const lastRow = maxFirstRow(m)
  if (!Number.isFinite(offset)) {
    return (offset > 0 ? lastRow : 0) * m.bytesPerRow
  }
  const alignedRow = Math.floor(offset / m.bytesPerRow)
  const clampedRow = Math.min(Math.max(alignedRow, 0), lastRow)
  return clampedRow * m.bytesPerRow
}

/**
 * Thumb height and position for a given `topByteOffset`.
 *
 * `thumbH` is the track scaled by the visible fraction, **divided before
 * multiplied** (`trackPx * (visibleRows / rowCount)`) so the product never needs
 * to exceed 2^53, then clamped to `[minThumbPx, trackPx]`. `thumbY` is likewise
 * `round(travel * (firstRow / maxFirstRow))` — `firstRow / maxFirstRow` is a
 * fraction in `[0, 1]`, so `travel * frac` stays a small number.
 */
export function thumbGeometry(topByteOffset: number, m: ViewportMetrics): ThumbGeometry {
  const total = rowCount(m)
  const lastRow = maxFirstRow(m)

  const rawThumbH = total === 0 ? m.trackPx : m.trackPx * (visibleRows(m) / total)
  const thumbH = Math.min(m.trackPx, Math.max(m.minThumbPx, rawThumbH))
  const travel = m.trackPx - thumbH

  const firstRow = rowOfOffset(topByteOffset, m.bytesPerRow)
  const frac = lastRow === 0 ? 0 : firstRow / lastRow
  const thumbY = Math.round(travel * frac)

  return { thumbH, thumbY, travel }
}

/**
 * Inverse of {@link thumbGeometry} under clamp: a thumb-top pixel back to an
 * aligned, clamped `topByteOffset`.
 *
 * `frac = clamp(thumbTopPx / travel, 0, 1)`; `firstRow = round(frac *
 * maxFirstRow)`; then through {@link clampTopOffset}. Coarse at large sizes
 * (~215 k rows/px at 2 GB) but a stable inverse — feeding the result back
 * through `thumbGeometry` returns the same pixel.
 */
export function offsetFromThumbPixel(thumbTopPx: number, m: ViewportMetrics): number {
  const { travel } = thumbGeometry(0, m)
  const frac = travel === 0 ? 0 : Math.min(1, Math.max(0, thumbTopPx / travel))
  const firstRow = Math.round(frac * maxFirstRow(m))
  return clampTopOffset(offsetOfRow(firstRow, m.bytesPerRow), m)
}
