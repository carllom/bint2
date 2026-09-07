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

  it('readSync is always a miss', () => {
    const source: ByteSource = new FileByteSource(syntheticFile(64))
    expect(source.readSync(0, 16)).toBeNull()
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
})
