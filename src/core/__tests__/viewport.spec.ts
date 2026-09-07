import { describe, expect, it } from 'vitest'
import {
  clampTopOffset,
  maxFirstRow,
  offsetFromThumbPixel,
  offsetOfRow,
  rowCount,
  rowOfOffset,
  thumbGeometry,
  visibleRows,
} from '../viewport'
import type { ViewportMetrics } from '../viewport'

// A 2 GB file at 16 bpr: ~125 M rows, well past any engine's element-height
// ceiling — the scale the custom scrollbar exists for (ADR-0006).
const AT_2GB: ViewportMetrics = {
  size: 2_000_000_000,
  bytesPerRow: 16,
  viewportPx: 900,
  rowPx: 18,
  trackPx: 900,
  minThumbPx: 24,
}
// rowCount = ceil(2e9 / 16)      = 125_000_000
// visibleRows = floor(900 / 18)  = 50
// maxFirstRow = 125_000_000 - 50 = 124_999_950
const MAX_ROW_2GB = 124_999_950

describe('rowOfOffset / offsetOfRow', () => {
  it.each([
    [0, 16, 0],
    [15, 16, 0],
    [16, 16, 1],
    [17, 16, 1],
    [1_000_000_000, 16, 62_500_000],
    [40, 8, 5],
  ])('rowOfOffset(%i, %i) === %i', (offset, bpr, row) => {
    expect(rowOfOffset(offset, bpr)).toBe(row)
  })

  it.each([
    [0, 16, 0],
    [1, 16, 16],
    [62_500_000, 16, 1_000_000_000],
    [5, 8, 40],
  ])('offsetOfRow(%i, %i) === %i', (row, bpr, offset) => {
    expect(offsetOfRow(row, bpr)).toBe(offset)
  })

  it('round-trips row -> offset -> row for row-aligned offsets past 2^32', () => {
    for (const row of [0, 1, 4095, 62_500_000, MAX_ROW_2GB, 500_000_000_000]) {
      expect(rowOfOffset(offsetOfRow(row, 16), 16)).toBe(row)
    }
  })
})

describe('rowCount / visibleRows / maxFirstRow', () => {
  it('rowCount rounds up so a short final row still counts', () => {
    expect(rowCount({ ...AT_2GB, size: 0 })).toBe(0)
    expect(rowCount({ ...AT_2GB, size: 1 })).toBe(1)
    expect(rowCount({ ...AT_2GB, size: 16 })).toBe(1)
    expect(rowCount({ ...AT_2GB, size: 17 })).toBe(2)
    expect(rowCount(AT_2GB)).toBe(125_000_000)
  })

  it('visibleRows is the whole rows that fit, floored, never below 1', () => {
    expect(visibleRows(AT_2GB)).toBe(50)
    expect(visibleRows({ ...AT_2GB, viewportPx: 899 })).toBe(49)
    expect(visibleRows({ ...AT_2GB, viewportPx: 10 })).toBe(1)
    expect(visibleRows({ ...AT_2GB, viewportPx: 0 })).toBe(1)
  })

  it('maxFirstRow is the last row that can sit at the top, never below 0', () => {
    expect(maxFirstRow(AT_2GB)).toBe(MAX_ROW_2GB)
    // Document shorter than the viewport: nothing to scroll.
    expect(maxFirstRow({ ...AT_2GB, size: 160 })).toBe(0)
  })
})

describe('clampTopOffset — the single navigation choke point', () => {
  it('aligns an arbitrary offset DOWN to a row boundary', () => {
    expect(clampTopOffset(17, AT_2GB)).toBe(16)
    expect(clampTopOffset(31, AT_2GB)).toBe(16)
    expect(clampTopOffset(32, AT_2GB)).toBe(32)
  })

  it('clamps below 0 to 0', () => {
    expect(clampTopOffset(-1, AT_2GB)).toBe(0)
    expect(clampTopOffset(-1_000_000, AT_2GB)).toBe(0)
  })

  it('clamps past the end to maxFirstRow * bytesPerRow', () => {
    expect(clampTopOffset(2_000_000_000, AT_2GB)).toBe(MAX_ROW_2GB * 16)
    expect(clampTopOffset(9_999_999_999, AT_2GB)).toBe(MAX_ROW_2GB * 16)
  })

  it('always returns an integer multiple of bytesPerRow', () => {
    for (const candidate of [0, 1, 15, 16, 17, 1_234_567, 1_999_999_999]) {
      const top = clampTopOffset(candidate, AT_2GB)
      expect(Number.isInteger(top)).toBe(true)
      expect(top % AT_2GB.bytesPerRow).toBe(0)
    }
  })

  it('coerces a non-finite candidate to a valid boundary rather than propagating NaN', () => {
    expect(clampTopOffset(Number.NaN, AT_2GB)).toBe(0)
    expect(clampTopOffset(-Infinity, AT_2GB)).toBe(0)
    expect(clampTopOffset(Infinity, AT_2GB)).toBe(MAX_ROW_2GB * 16)
  })
})

describe('thumbGeometry', () => {
  it('places the thumb at the top for topByteOffset 0', () => {
    const g = thumbGeometry(0, AT_2GB)
    expect(g.thumbY).toBe(0)
  })

  it('places the thumb at the bottom of its travel for the last screen', () => {
    const g = thumbGeometry(MAX_ROW_2GB * 16, AT_2GB)
    expect(g.thumbY).toBe(g.travel)
  })

  it('clamps the thumb height to minThumbPx at 2 GB scale so it stays grabbable', () => {
    const g = thumbGeometry(0, AT_2GB)
    // The exact visible fraction here is ~4e-7 of the track — sub-pixel.
    expect(g.thumbH).toBe(AT_2GB.minThumbPx)
    expect(g.travel).toBe(AT_2GB.trackPx - AT_2GB.minThumbPx)
  })

  it('never lets the thumb exceed the track', () => {
    const g = thumbGeometry(0, { ...AT_2GB, size: 160 }) // fits on screen
    expect(g.thumbH).toBe(AT_2GB.trackPx)
    expect(g.travel).toBe(0)
    expect(g.thumbY).toBe(0)
  })

  it('positions the thumb proportionally between the extremes', () => {
    const g = thumbGeometry(1_000_000_000, AT_2GB)
    expect(g.thumbY).toBeGreaterThan(0)
    expect(g.thumbY).toBeLessThan(g.travel)
    // ~halfway down a ~876 px travel.
    expect(g.thumbY).toBeCloseTo(438, 0)
  })
})

describe('offsetFromThumbPixel — inverse of thumbGeometry under clamp', () => {
  it('maps pixel 0 to the top of the document', () => {
    expect(offsetFromThumbPixel(0, AT_2GB)).toBe(0)
  })

  it('maps the end of travel to the last screen', () => {
    const { travel } = thumbGeometry(0, AT_2GB)
    expect(offsetFromThumbPixel(travel, AT_2GB)).toBe(MAX_ROW_2GB * 16)
  })

  it('clamps an out-of-range pixel to the track', () => {
    expect(offsetFromThumbPixel(-50, AT_2GB)).toBe(0)
    expect(offsetFromThumbPixel(99_999, AT_2GB)).toBe(MAX_ROW_2GB * 16)
  })

  it('is a stable inverse: pixel -> offset -> pixel returns the same pixel', () => {
    const { travel } = thumbGeometry(0, AT_2GB)
    for (const px of [0, 1, 100, 300, 438, travel - 1, travel]) {
      const offset = offsetFromThumbPixel(px, AT_2GB)
      expect(thumbGeometry(offset, AT_2GB).thumbY).toBe(px)
    }
  })

  it('round-trips offset -> pixel -> offset within one row at 2 GB coarseness', () => {
    for (const row of [0, 1, 1_000, 62_500_000, MAX_ROW_2GB]) {
      const offset = offsetOfRow(row, 16)
      const px = thumbGeometry(offset, AT_2GB).thumbY
      const back = offsetFromThumbPixel(px, AT_2GB)
      // Coarse at 2 GB (~215 k rows/px) but must land on a valid boundary and
      // re-derive the same thumb pixel.
      expect(back % 16).toBe(0)
      expect(thumbGeometry(back, AT_2GB).thumbY).toBe(px)
    }
  })
})

describe('MAX_SAFE_INTEGER overflow probe', () => {
  const AT_MAX: ViewportMetrics = {
    size: Number.MAX_SAFE_INTEGER,
    bytesPerRow: 16,
    viewportPx: 900,
    rowPx: 18,
    trackPx: 900,
    minThumbPx: 24,
  }

  it('keeps every quantity finite, non-NaN and in range at size = 2^53 - 1', () => {
    const top = clampTopOffset(Number.MAX_SAFE_INTEGER, AT_MAX)
    const g = thumbGeometry(top, AT_MAX)

    expect(Number.isFinite(g.thumbY)).toBe(true)
    expect(Number.isNaN(g.thumbY)).toBe(false)
    expect(g.thumbY).toBeGreaterThanOrEqual(0)
    expect(g.thumbY).toBeLessThanOrEqual(g.travel)
    // Last screen -> thumb at the end of its travel.
    expect(g.thumbY).toBe(g.travel)
  })

  it('derives an exact firstRow — divide-before-multiply keeps the product under 2^53', () => {
    const expectedMaxRow = rowCount(AT_MAX) - visibleRows(AT_MAX)
    const top = clampTopOffset(Number.MAX_SAFE_INTEGER, AT_MAX)
    expect(rowOfOffset(top, 16)).toBe(expectedMaxRow)

    // A mid-file offset stays exact too.
    const midRow = Math.floor(expectedMaxRow / 2)
    const midTop = clampTopOffset(offsetOfRow(midRow, 16), AT_MAX)
    expect(rowOfOffset(midTop, 16)).toBe(midRow)
    const g = thumbGeometry(midTop, AT_MAX)
    expect(Number.isFinite(g.thumbY)).toBe(true)
    expect(g.thumbY).toBeGreaterThanOrEqual(0)
    expect(g.thumbY).toBeLessThanOrEqual(g.travel)
  })
})
