import { describe, expect, it } from 'vitest'
import type { ByteSource } from '../ByteSource'
import { ByteSourceError, FileByteSource } from '../FileByteSource'

/** A file whose byte `i` holds `i & 0xff`, per the plan's testing section. */
function syntheticFile(size: number, name = 'synthetic.bin'): File {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    bytes[i] = i & 0xff
  }
  return new File([bytes], name)
}

/**
 * A rejecting blob stub (plan §11's "failing" substitution, at the `File`
 * seam): byte `i` holds `i & 0xff` up to `goneAfterByte`, past which every
 * `slice(...).arrayBuffer()` rejects the way a real `File` does once the
 * underlying file has moved or been truncated out from under it (ADR-0001).
 * `sliceCalls` proves the latch really does stop touching the "disk".
 */
function goneAfterFile(
  size: number,
  goneAfterByte: number,
): { file: File; sliceCalls: () => number } {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    bytes[i] = i & 0xff
  }
  let calls = 0
  const file = {
    size,
    slice(start: number, end: number) {
      calls++
      return {
        arrayBuffer(): Promise<ArrayBuffer> {
          if (start >= goneAfterByte) {
            return Promise.reject(new DOMException('file moved', 'NotFoundError'))
          }
          return Promise.resolve(bytes.slice(start, end).buffer)
        },
      }
    },
  } as unknown as File
  return { file, sliceCalls: () => calls }
}

describe('FileByteSource', () => {
  it('reports the file size', () => {
    expect(new FileByteSource(syntheticFile(1234)).size).toBe(1234)
  })

  it('reads a range from the middle of the file', async () => {
    const source = new FileByteSource(syntheticFile(512))
    const bytes = await source.read(300, 16)
    expect(Array.from(bytes)).toEqual(Array.from({ length: 16 }, (_, i) => (300 + i) & 0xff))
  })

  it('returns min(length, size - offset) bytes across the end', async () => {
    const source = new FileByteSource(syntheticFile(40))
    const bytes = await source.read(32, 16)
    expect(bytes).toHaveLength(8)
    expect(Array.from(bytes)).toEqual([32, 33, 34, 35, 36, 37, 38, 39])
  })

  it('returns an empty array when the offset is at or past the end', async () => {
    const source = new FileByteSource(syntheticFile(40))
    expect(await source.read(40, 16)).toHaveLength(0)
    expect(await source.read(100, 16)).toHaveLength(0)
  })

  it('throws only for negative or NaN arguments', async () => {
    const source = new FileByteSource(syntheticFile(64))
    await expect(source.read(-1, 8)).rejects.toBeInstanceOf(RangeError)
    await expect(source.read(0, -8)).rejects.toBeInstanceOf(RangeError)
    await expect(source.read(Number.NaN, 8)).rejects.toBeInstanceOf(RangeError)
    await expect(source.read(0, Number.NaN)).rejects.toBeInstanceOf(RangeError)
    await expect(source.read(0, 0)).resolves.toHaveLength(0)
  })

  it('hands back a fresh, caller-owned array on each read', async () => {
    const source = new FileByteSource(syntheticFile(64))
    const first = await source.read(0, 16)
    first[0] = 0xff
    const second = await source.read(0, 16)
    expect(second[0]).toBe(0)
  })

  it('readSync misses until the covering bytes are resident, then hits', async () => {
    const source: ByteSource = new FileByteSource(syntheticFile(512))
    expect(source.readSync(300, 16)).toBeNull() // cold

    await source.read(300, 16)

    const hit = source.readSync(300, 16)
    expect(hit).not.toBeNull()
    expect(Array.from(hit!)).toEqual(Array.from({ length: 16 }, (_u, i) => (300 + i) & 0xff))
    // A hit is a fresh, caller-owned copy — mutating it must not poison the cache.
    hit![0] = 0xff
    expect(source.readSync(300, 16)![0]).toBe(300 & 0xff)
  })

  it('prefetch warms the bytes so a later readSync hits without an await', async () => {
    const source: ByteSource = new FileByteSource(syntheticFile(4096))
    source.prefetch(1000, 64)

    // The fetch is async; give it a turn of the event loop to settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const hit = source.readSync(1000, 64)
    expect(hit).not.toBeNull()
    expect(Array.from(hit!)).toEqual(Array.from({ length: 64 }, (_u, i) => (1000 + i) & 0xff))
  })

  it('prefetch returns void and never throws', () => {
    const source: ByteSource = new FileByteSource(syntheticFile(64))
    expect(source.prefetch(0, 16)).toBeUndefined()
    expect(source.prefetch(-1, -1)).toBeUndefined()
  })

  describe('close', () => {
    it('is idempotent', () => {
      const source = new FileByteSource(syntheticFile(64))
      expect(() => {
        source.close()
        source.close()
      }).not.toThrow()
    })

    it('rejects in-flight reads with source-closed', async () => {
      const source = new FileByteSource(syntheticFile(1 << 16))
      const inFlight = source.read(0, 1 << 16)
      source.close()
      await expect(inFlight).rejects.toBeInstanceOf(ByteSourceError)
      await expect(inFlight).rejects.toMatchObject({ code: 'source-closed' })
    })

    it('rejects subsequent reads and keeps readSync null', async () => {
      const source: ByteSource = new FileByteSource(syntheticFile(64))
      source.close()
      await expect(source.read(0, 16)).rejects.toMatchObject({ code: 'source-closed' })
      expect(source.readSync(0, 16)).toBeNull()
    })
  })

  describe('the source-gone latch (#26, ADR-0001 / ADR-0004)', () => {
    it('rejects with source-gone when the file has moved or been truncated out from under it', async () => {
      const { file } = goneAfterFile(64, 0) // gone from the very first byte
      const source = new FileByteSource(file)
      await expect(source.read(0, 16)).rejects.toBeInstanceOf(ByteSourceError)
      await expect(source.read(0, 16)).rejects.toMatchObject({ code: 'source-gone' })
    })

    it('latches: subsequent reads reject immediately without touching the file again', async () => {
      const { file, sliceCalls } = goneAfterFile(64, 0)
      const source = new FileByteSource(file)

      await expect(source.read(0, 16)).rejects.toMatchObject({ code: 'source-gone' })
      expect(sliceCalls()).toBe(1)

      await expect(source.read(0, 16)).rejects.toMatchObject({ code: 'source-gone' })
      await expect(source.read(32, 8)).rejects.toMatchObject({ code: 'source-gone' })
      expect(sliceCalls()).toBe(1) // no further disk touch once latched

      // Never resident to begin with, so readSync stays null — not because
      // `readSync` special-cases the latch, but because there is nothing to
      // serve.
      expect(source.readSync(0, 16)).toBeNull()
    })

    it('prefetch also stops touching the file once latched', async () => {
      const { file, sliceCalls } = goneAfterFile(64, 0)
      const source = new FileByteSource(file)
      await expect(source.read(0, 16)).rejects.toMatchObject({ code: 'source-gone' })

      const before = sliceCalls()
      source.prefetch(0, 16)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(sliceCalls()).toBe(before)
    })

    it('keeps resident Pages answering readSync after the source has latched — the cache never sees the File', async () => {
      const PAGE = 64 * 1024
      const { file } = goneAfterFile(PAGE * 2, PAGE) // page 0 readable, page 1 gone
      const source = new FileByteSource(file)

      await source.read(0, 16) // populates page 0
      expect(source.readSync(0, 16)).not.toBeNull()

      await expect(source.read(PAGE, 16)).rejects.toMatchObject({ code: 'source-gone' })

      // Latched, but the resident page still answers — poisoning the cache on
      // latch was rejected by ADR-0004.
      expect(source.readSync(0, 16)).not.toBeNull()
      // A range that was never resident stays null forever.
      expect(source.readSync(PAGE, 16)).toBeNull()
      await expect(source.read(0, 16)).rejects.toMatchObject({ code: 'source-gone' }) // read still latched
    })
  })
})
