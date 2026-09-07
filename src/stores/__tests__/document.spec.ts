import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ByteSource } from '@/core'
import { BYTES_PER_ROW_PRESETS, useDocumentStore } from '../document'

/** A bytes-only stub — the store never reads, it only tracks identity and size. */
function sourceOfSize(size: number): ByteSource {
  return {
    size,
    read: () => Promise.resolve(new Uint8Array()),
    readSync: () => null,
    prefetch: () => {},
    close: () => {},
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('bytes-per-row presets (#19)', () => {
  it('offers 8 / 16 / 24 / 32, and every one is a multiple of 8', () => {
    expect([...BYTES_PER_ROW_PRESETS]).toEqual([8, 16, 24, 32])
    expect(BYTES_PER_ROW_PRESETS.every((n) => n % 8 === 0)).toBe(true)
  })

  it('defaults to 16', () => {
    expect(useDocumentStore().bytesPerRow).toBe(16)
  })

  it('setBytesPerRow switches to another preset', () => {
    const store = useDocumentStore()
    store.setBytesPerRow(24)
    expect(store.bytesPerRow).toBe(24)
    store.setBytesPerRow(8)
    expect(store.bytesPerRow).toBe(8)
  })

  it('ignores a value that is not one of the presets', () => {
    const store = useDocumentStore()
    for (const bad of [0, 10, 13, 20, 40, -16, Number.NaN]) {
      store.setBytesPerRow(bad)
      expect(store.bytesPerRow).toBe(16)
    }
  })

  it('leaves topByteOffset untouched — realigning it is the Viewport’s job (ADR-0006)', () => {
    const store = useDocumentStore()
    store.topByteOffset = 992
    store.setBytesPerRow(24)
    // The store only flips the preset; clampTopOffset runs from the metrics
    // watcher in HexViewer, exercised in the app-shell integration test.
    expect(store.topByteOffset).toBe(992)
  })
})

describe('the Selection: one range, byte-snapped (#22, ADR-0003)', () => {
  it('has no Selection until the reader first points at a byte', () => {
    expect(useDocumentStore().selection).toBeNull()
  })

  it('setCursor puts a collapsed Selection — the Cursor — on a byte', () => {
    const store = useDocumentStore()
    store.open(sourceOfSize(256), 'x.bin')
    store.setCursor(0x40)
    expect(store.selection).toEqual({ anchor: 0x40, focus: 0x40 })
  })

  it('a plain setCursor replaces the Selection — there is never more than one range', () => {
    const store = useDocumentStore()
    store.open(sourceOfSize(256), 'x.bin')
    store.extendSelectionTo(10)
    store.extendSelectionTo(30)
    expect(store.selection).toEqual({ anchor: 10, focus: 30 })
    store.setCursor(5)
    expect(store.selection).toEqual({ anchor: 5, focus: 5 })
  })

  it('extendSelectionTo moves the focus and keeps the anchor, direction preserved', () => {
    const store = useDocumentStore()
    store.open(sourceOfSize(256), 'x.bin')
    store.setCursor(20)
    store.extendSelectionTo(12)
    expect(store.selection).toEqual({ anchor: 20, focus: 12 })
    store.extendSelectionTo(8)
    expect(store.selection).toEqual({ anchor: 20, focus: 8 })
  })

  it('extendSelectionTo with no Selection yet anchors where it lands', () => {
    const store = useDocumentStore()
    store.open(sourceOfSize(256), 'x.bin')
    store.extendSelectionTo(50)
    expect(store.selection).toEqual({ anchor: 50, focus: 50 })
  })

  it('snaps an out-of-range offset to a real byte — never past the last one', () => {
    const store = useDocumentStore()
    store.open(sourceOfSize(64), 'x.bin')
    store.setCursor(999)
    expect(store.selection).toEqual({ anchor: 63, focus: 63 })
    store.setCursor(-4)
    expect(store.selection).toEqual({ anchor: 0, focus: 0 })
    store.setCursor(Number.NaN)
    expect(store.selection).toEqual({ anchor: 0, focus: 0 })
  })

  it('does nothing with no source open', () => {
    const store = useDocumentStore()
    store.setCursor(10)
    store.extendSelectionTo(20)
    expect(store.selection).toBeNull()
  })

  it('does nothing for a zero-byte file — there is no byte to point at', () => {
    const store = useDocumentStore()
    store.open(sourceOfSize(0), 'empty.bin')
    store.setCursor(0)
    expect(store.selection).toBeNull()
  })

  it('does not survive opening another document', () => {
    const store = useDocumentStore()
    store.open(sourceOfSize(256), 'a.bin')
    store.setCursor(0x30)
    expect(store.selection).not.toBeNull()
    store.open(sourceOfSize(256), 'b.bin')
    expect(store.selection).toBeNull()
  })
})
