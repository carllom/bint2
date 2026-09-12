import { describe, expect, it, vi } from 'vitest'
import { searchForward } from '../derivedWorkSearch'

/** Byte `i` holds `i & 0xff`, per the plan's synthetic-fixture convention. */
function fillerBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) bytes[i] = i & 0xff
  return bytes
}

function fileWithPatternAt(size: number, pattern: number[], positions: number[]): File {
  const bytes = fillerBytes(size)
  for (const position of positions) {
    bytes.set(pattern, position)
  }
  return new File([bytes], 'pattern.bin')
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

describe('searchForward', () => {
  it('finds every match, including ones straddling a chunk boundary', async () => {
    // size 40, chunkSize 16 -> chunks [0,16) [16,32) [32,40). A 4-byte pattern
    // at offset 14 straddles the first boundary; offset 34 sits in the final
    // partial chunk.
    const pattern = [0xaa, 0xbb, 0xcc, 0xdd]
    const file = fileWithPatternAt(40, pattern, [5, 14, 34])

    const { result, cancelled } = await searchForward(
      file,
      { pattern: Uint8Array.from(pattern) },
      { chunkSize: 16 },
    )

    expect(cancelled).toBe(false)
    expect(Array.from(result.matches)).toEqual([5, 14, 34])
  })

  it('finds overlapping matches within the same chunk', async () => {
    // "aaa" against pattern "aa" matches at both offset 0 and offset 1.
    const bytes = new Uint8Array([0xaa, 0xaa, 0xaa, 0x00, 0x00])
    const file = new File([bytes], 'overlap.bin')

    const { result } = await searchForward(file, { pattern: Uint8Array.from([0xaa, 0xaa]) })

    expect(Array.from(result.matches)).toEqual([0, 1])
  })

  it('returns no matches and does not throw on an empty pattern or empty file', async () => {
    const file = fileWithPatternAt(20, [0xaa], [])
    const empty = await searchForward(file, { pattern: new Uint8Array(0) })
    expect(Array.from(empty.result.matches)).toEqual([])

    const emptyFile = new File([], 'empty.bin')
    const onEmptyFile = await searchForward(emptyFile, { pattern: Uint8Array.of(0xaa) })
    expect(Array.from(onEmptyFile.result.matches)).toEqual([])
  })

  it('reports progress between chunks as offset/size, with a running match count', async () => {
    const pattern = [0xaa, 0xbb]
    const file = fileWithPatternAt(48, pattern, [3, 20, 40])
    const calls: Array<{ percent: number; matchCount: number }> = []

    await searchForward(
      file,
      { pattern: Uint8Array.from(pattern) },
      {
        chunkSize: 16,
        onProgress: (percent, extra) => calls.push({ percent, ...extra }),
      },
    )

    expect(calls.length).toBeGreaterThan(1)
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.percent).toBeGreaterThan(calls[i - 1]!.percent)
      expect(calls[i]!.matchCount).toBeGreaterThanOrEqual(calls[i - 1]!.matchCount)
    }
    expect(calls[calls.length - 1]!.percent).toBe(1)
    expect(calls[calls.length - 1]!.matchCount).toBe(3)
  })

  it('stops between chunks once cancelled, and never reports a match from a chunk after cancellation', async () => {
    const pattern = [0xaa, 0xbb]
    // A match in every chunk; cancellation should only let the first through.
    const file = fileWithPatternAt(48, pattern, [3, 20, 40])

    let chunksSeen = 0
    const { result, cancelled } = await searchForward(
      file,
      { pattern: Uint8Array.from(pattern) },
      {
        chunkSize: 16,
        onProgress: () => {
          chunksSeen++
        },
        isCancelled: () => chunksSeen >= 1,
      },
    )

    expect(cancelled).toBe(true)
    expect(Array.from(result.matches)).toEqual([3])
  })

  it('yields to the caller-provided event loop on a time budget, not a fixed chunk count', async () => {
    const pattern = [0xaa]
    const file = fileWithPatternAt(64, pattern, [])
    const yieldSpy = vi.fn(() => Promise.resolve())
    let clock = 0

    await searchForward(
      file,
      { pattern: Uint8Array.from(pattern) },
      {
        chunkSize: 16, // 4 chunks
        yieldBudgetMs: 1,
        now: () => (clock += 10), // every call blows the 1ms budget
        yieldToEventLoop: yieldSpy,
      },
    )

    expect(yieldSpy).toHaveBeenCalled()
  })

  it('never yields when the caller-provided clock stays within budget', async () => {
    const pattern = [0xaa]
    const file = fileWithPatternAt(64, pattern, [])
    const yieldSpy = vi.fn(() => Promise.resolve())

    await searchForward(
      file,
      { pattern: Uint8Array.from(pattern) },
      {
        chunkSize: 16,
        yieldBudgetMs: 1_000_000,
        now: () => 0,
        yieldToEventLoop: yieldSpy,
      },
    )

    expect(yieldSpy).not.toHaveBeenCalled()
  })

  it('propagates a chunk read failure (e.g. a source-gone File) as a rejection', async () => {
    await expect(
      searchForward(goneFile(64), { pattern: Uint8Array.of(0xaa) }, { chunkSize: 16 }),
    ).rejects.toBeInstanceOf(DOMException)
  })

  describe('caseInsensitive (#105)', () => {
    it('is exact by default — a differently-cased byte never matches', async () => {
      const file = new File([Uint8Array.from([0x68, 0x65, 0x6c, 0x6c, 0x6f])], 'text.bin') // "hello"
      const { result } = await searchForward(file, {
        pattern: Uint8Array.from([0x48, 0x45, 0x4c, 0x4c, 0x4f]), // "HELLO"
      })
      expect(Array.from(result.matches)).toEqual([])
    })

    it('folds ASCII letter case on both sides when set', async () => {
      const file = new File([Uint8Array.from([0x68, 0x65, 0x6c, 0x6c, 0x6f])], 'text.bin') // "hello"
      const { result } = await searchForward(file, {
        pattern: Uint8Array.from([0x48, 0x45, 0x4c, 0x4c, 0x4f]), // "HELLO"
        caseInsensitive: true,
      })
      expect(Array.from(result.matches)).toEqual([0])
    })

    it('never folds non-letter bytes — a digit or symbol still matches exactly', async () => {
      const file = new File([Uint8Array.from([0x31, 0x21])], 'text.bin') // "1!"
      const { result } = await searchForward(file, {
        pattern: Uint8Array.from([0x31, 0x21]),
        caseInsensitive: true,
      })
      expect(Array.from(result.matches)).toEqual([0])
    })
  })
})
