import { describe, expect, it, vi } from 'vitest'
import { computeStats } from '../derivedWorkStats'

function fileOf(bytes: number[]): File {
  return new File([Uint8Array.from(bytes)], 'stats.bin')
}

/** A file whose `.slice().arrayBuffer()` rejects, like a moved/truncated File. */
function goneFile(size: number): File {
  const file = {
    size,
    slice() {
      return {
        arrayBuffer(): Promise<ArrayBuffer> {
          return Promise.reject(new DOMException('file moved', 'NotFoundError'))
        },
      }
    },
  } as unknown as File
  return file
}

describe('computeStats', () => {
  it('reports entropy 0 for an all-zero block', async () => {
    const file = fileOf(new Array(32).fill(0))

    const { result, cancelled } = await computeStats(file, {
      range: { start: 0, end: 32 },
      blockSize: 32,
    })

    expect(cancelled).toBe(false)
    expect(result.entropy.length).toBe(1)
    expect(result.entropy[0]).toBe(0)
  })

  it('reports entropy close to 8 for a uniformly distributed block', async () => {
    // One of each of the 256 byte values — the maximal-entropy case.
    const bytes = Array.from({ length: 256 }, (_, i) => i)
    const file = fileOf(bytes)

    const { result } = await computeStats(file, {
      range: { start: 0, end: 256 },
      blockSize: 256,
    })

    expect(result.entropy.length).toBe(1)
    expect(result.entropy[0]).toBeCloseTo(8, 5)
  })

  it('matches a hand-computed frequency count for a small repeating pattern', async () => {
    // 0x41 x2, 0x42 x2, 0x43 x1
    const file = fileOf([0x41, 0x42, 0x41, 0x42, 0x43])

    const { result } = await computeStats(file, {
      range: { start: 0, end: 5 },
      blockSize: 5,
    })

    expect(result.histogram[0x41]).toBe(2)
    expect(result.histogram[0x42]).toBe(2)
    expect(result.histogram[0x43]).toBe(1)
    const total = result.histogram.reduce((a, b) => a + b, 0)
    expect(total).toBe(5)
  })

  it('produces ceil(range length / blockSize) blocks for a whole-file scan, including a short final block', async () => {
    const file = fileOf(new Array(100).fill(0).map((_, i) => i & 0xff))

    const { result } = await computeStats(file, {
      range: { start: 0, end: 100 },
      blockSize: 32,
    })

    expect(result.entropy.length).toBe(Math.ceil(100 / 32))
  })

  it('produces ceil(range length / blockSize) blocks for an arbitrary Selection-shaped sub-range', async () => {
    const file = fileOf(new Array(100).fill(0).map((_, i) => i & 0xff))

    const { result } = await computeStats(file, {
      range: { start: 10, end: 90 }, // length 80
      blockSize: 32,
    })

    expect(result.entropy.length).toBe(Math.ceil(80 / 32))
  })

  it('accumulates a block correctly even when it straddles a chunk boundary', async () => {
    // blockSize 40, chunkSize 16: block 0 spans chunks [0,16) [16,32) [32,40).
    const bytes = new Array(80).fill(0)
    for (let i = 0; i < 40; i++) bytes[i] = 0xaa // block 0: uniform
    for (let i = 40; i < 80; i++) bytes[i] = i % 2 === 0 ? 0xaa : 0xbb // block 1: mixed
    const file = fileOf(bytes)

    const { result } = await computeStats(
      file,
      { range: { start: 0, end: 80 }, blockSize: 40 },
      { chunkSize: 16 },
    )

    expect(result.entropy.length).toBe(2)
    expect(result.entropy[0]).toBe(0) // block 0: single byte value, entropy 0
    expect(result.entropy[1]).toBeCloseTo(1, 5) // block 1: 50/50 split, entropy 1
    expect(result.histogram[0xaa]).toBe(40 + 20)
    expect(result.histogram[0xbb]).toBe(20)
  })

  it('returns an empty result and does not throw for an empty range', async () => {
    const file = fileOf([0xaa, 0xbb])

    const { result, cancelled } = await computeStats(file, {
      range: { start: 1, end: 1 },
      blockSize: 16,
    })

    expect(cancelled).toBe(false)
    expect(result.entropy.length).toBe(0)
    expect(Array.from(result.histogram)).toEqual(new Array(256).fill(0))
  })

  it('reports progress between chunks as processed/range-length, ending at 1', async () => {
    const file = fileOf(new Array(48).fill(0).map((_, i) => i & 0xff))
    const calls: number[] = []

    await computeStats(
      file,
      { range: { start: 0, end: 48 }, blockSize: 16 },
      { chunkSize: 16, onProgress: (percent) => calls.push(percent) },
    )

    expect(calls.length).toBeGreaterThan(1)
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!).toBeGreaterThan(calls[i - 1]!)
    }
    expect(calls[calls.length - 1]).toBe(1)
  })

  it('stops between chunks once cancelled', async () => {
    const file = fileOf(new Array(48).fill(0).map((_, i) => i & 0xff))
    let chunksSeen = 0

    const { cancelled } = await computeStats(
      file,
      { range: { start: 0, end: 48 }, blockSize: 16 },
      {
        chunkSize: 16,
        onProgress: () => {
          chunksSeen++
        },
        isCancelled: () => chunksSeen >= 1,
      },
    )

    expect(cancelled).toBe(true)
  })

  it('yields to the caller-provided event loop on a time budget, not a fixed chunk count', async () => {
    const file = fileOf(new Array(64).fill(0))
    const yieldSpy = vi.fn(() => Promise.resolve())
    let clock = 0

    await computeStats(
      file,
      { range: { start: 0, end: 64 }, blockSize: 16 },
      {
        chunkSize: 16,
        yieldBudgetMs: 1,
        now: () => (clock += 10),
        yieldToEventLoop: yieldSpy,
      },
    )

    expect(yieldSpy).toHaveBeenCalled()
  })

  it('propagates a chunk read failure (e.g. a source-gone File) as a rejection', async () => {
    await expect(
      computeStats(
        goneFile(64),
        { range: { start: 0, end: 64 }, blockSize: 16 },
        { chunkSize: 16 },
      ),
    ).rejects.toBeInstanceOf(DOMException)
  })
})
