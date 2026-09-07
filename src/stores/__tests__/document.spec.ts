import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { BYTES_PER_ROW_PRESETS, useDocumentStore } from '../document'

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
