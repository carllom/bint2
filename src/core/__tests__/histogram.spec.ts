import { describe, expect, it } from 'vitest'
import { barHeight, histogramFrequencies, maxFrequency } from '../histogram'

// Pure core tests for the Byte histogram's normalization math (#108,
// CONTEXT.md's Byte histogram, ADR-0012, plan-phase2.md §4.5).

describe('histogramFrequencies — count[byte] / totalBytesInRange', () => {
  it('normalizes each byte-value count against the total', () => {
    const histogram = new Uint32Array(256)
    histogram[0x00] = 6
    histogram[0xff] = 2
    // 8 bytes total: byte 0 is 75%, byte 255 is 25%, everything else 0%.
    const frequencies = histogramFrequencies(histogram)
    expect(frequencies[0x00]).toBeCloseTo(0.75)
    expect(frequencies[0xff]).toBeCloseTo(0.25)
    expect(frequencies[0x01]).toBe(0)
  })

  it('matches a hand-computed distribution for a repeating pattern', () => {
    const histogram = new Uint32Array(256)
    // 'AABC' repeated 10 times: A x20, B x10, C x10, out of 40 bytes.
    histogram[0x41] = 20
    histogram[0x42] = 10
    histogram[0x43] = 10
    const frequencies = histogramFrequencies(histogram)
    expect(frequencies[0x41]).toBeCloseTo(0.5)
    expect(frequencies[0x42]).toBeCloseTo(0.25)
    expect(frequencies[0x43]).toBeCloseTo(0.25)
  })

  it('is all zero for an empty range rather than dividing by zero', () => {
    const frequencies = histogramFrequencies(new Uint32Array(256))
    expect(Array.from(frequencies).every((f) => f === 0)).toBe(true)
  })
})

describe('maxFrequency — the range\'s own scale', () => {
  it('returns the largest frequency present', () => {
    const histogram = new Uint32Array(256)
    histogram[0x10] = 3
    histogram[0x20] = 9
    histogram[0x30] = 1
    expect(maxFrequency(histogramFrequencies(histogram))).toBeCloseTo(9 / 13)
  })

  it('is 0 for an all-zero distribution', () => {
    expect(maxFrequency(histogramFrequencies(new Uint32Array(256)))).toBe(0)
  })
})

describe('barHeight — scaled to the range\'s own max, not a fixed axis', () => {
  it('scales proportionally to the max', () => {
    expect(barHeight(0.25, 0.5)).toBeCloseTo(0.5)
    expect(barHeight(0.5, 0.5)).toBeCloseTo(1)
    expect(barHeight(0, 0.5)).toBe(0)
  })

  it('is 0 when max is 0 (nothing to scale against)', () => {
    expect(barHeight(0, 0)).toBe(0)
  })
})
