import { describe, expect, it } from 'vitest'
import { entropyBlockAt, entropyBlockRange, entropyColor } from '../entropyMap'

// Pure core tests for the Entropy Map's click-to-cursor geometry and thermal
// gradient (#107, ADR-0012, plan-phase2.md §4.4/§7).

describe('entropyBlockAt — strip click -> block index', () => {
  it('scales x proportionally from the displayed width onto the block count', () => {
    // A 100px-wide strip rendering 4 blocks: each block owns a 25px band.
    expect(entropyBlockAt({ x: 0, displayWidth: 100, numBlocks: 4 })).toBe(0)
    expect(entropyBlockAt({ x: 24, displayWidth: 100, numBlocks: 4 })).toBe(0)
    expect(entropyBlockAt({ x: 25, displayWidth: 100, numBlocks: 4 })).toBe(1)
    expect(entropyBlockAt({ x: 74, displayWidth: 100, numBlocks: 4 })).toBe(2)
    expect(entropyBlockAt({ x: 75, displayWidth: 100, numBlocks: 4 })).toBe(3)
  })

  it('clamps the trailing edge onto the last block despite float rounding', () => {
    expect(entropyBlockAt({ x: 99.999, displayWidth: 100, numBlocks: 3 })).toBe(2)
  })

  it('returns null outside [0, displayWidth)', () => {
    expect(entropyBlockAt({ x: -1, displayWidth: 100, numBlocks: 4 })).toBeNull()
    expect(entropyBlockAt({ x: 100, displayWidth: 100, numBlocks: 4 })).toBeNull()
  })

  it('returns null with nothing rendered', () => {
    expect(entropyBlockAt({ x: 10, displayWidth: 100, numBlocks: 0 })).toBeNull()
    expect(entropyBlockAt({ x: 10, displayWidth: 0, numBlocks: 4 })).toBeNull()
  })
})

describe('entropyBlockRange — block index -> byte range', () => {
  it('gives every full block blockSize bytes, counting from rangeStart', () => {
    expect(
      entropyBlockRange({ rangeStart: 100, rangeEnd: 1100, blockSize: 256, blockIndex: 0 }),
    ).toEqual({ start: 100, end: 356 })
    expect(
      entropyBlockRange({ rangeStart: 100, rangeEnd: 1100, blockSize: 256, blockIndex: 1 }),
    ).toEqual({ start: 356, end: 612 })
  })

  it('clips the final block to rangeEnd when it is shorter than blockSize', () => {
    // range [100, 1100) at blockSize 256 -> 4 blocks, last one only 76 bytes.
    expect(
      entropyBlockRange({ rangeStart: 100, rangeEnd: 1100, blockSize: 256, blockIndex: 3 }),
    ).toEqual({ start: 868, end: 1100 })
  })
})

describe('entropyColor — the thermal gradient (green -> yellow -> red)', () => {
  it('pins the gradient endpoints and midpoint (dark theme)', () => {
    expect(entropyColor(0, 'dark')).toBe('hsl(120.0 70% 45%)')
    expect(entropyColor(4, 'dark')).toBe('hsl(60.0 70% 45%)')
    expect(entropyColor(8, 'dark')).toBe('hsl(0.0 70% 45%)')
  })

  it('clamps out-of-range entropy to the endpoints', () => {
    expect(entropyColor(-3, 'dark')).toBe(entropyColor(0, 'dark'))
    expect(entropyColor(99, 'dark')).toBe(entropyColor(8, 'dark'))
  })

  it('keeps the same hue across themes, adjusting only saturation/lightness', () => {
    const dark = entropyColor(4, 'dark')
    const light = entropyColor(4, 'light')
    expect(dark).toContain('60.0')
    expect(light).toContain('60.0')
    expect(dark).not.toBe(light)
  })

  it('defaults to the dark theme', () => {
    expect(entropyColor(4)).toBe(entropyColor(4, 'dark'))
  })
})
