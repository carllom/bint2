import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { rowByteSpan } from '@/core'
import type { ByteSource } from '@/core'
import { usePreferencesStore } from '../preferences'
import { useDocumentStore } from '../document'
import { useBitmapStore } from '../bitmap'

/** A bytes-only stub — neither store reads it, they only track identity / size. */
function sourceOfSize(size: number): ByteSource {
  return {
    size,
    read: () => Promise.resolve(new Uint8Array()),
    readSync: () => null,
    prefetch: () => {},
    close: () => {},
  }
}

// The follow/lock Origin state machine (ADR-0008, plan-phase1.75 §4.4). The
// component wiring — `L`, the header toggle, the nudge keys, survival across the
// section's `unmount-on-hide` — is covered at the app-shell seam in
// `components/__tests__/BitmapPanel.spec.ts`. Here: the store's own contract.

describe('the Bitmap store — the Origin state machine', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts in Follow with no locked offset (every reload starts in Follow)', () => {
    const bitmap = useBitmapStore()
    expect(bitmap.originLocked).toBe(false)
    expect(bitmap.lockedOffset).toBeNull()
  })

  it('lockOrigin freezes at the given offset; followCursor drops it', () => {
    const bitmap = useBitmapStore()

    bitmap.lockOrigin(0x1f40)
    expect(bitmap.originLocked).toBe(true)
    expect(bitmap.lockedOffset).toBe(0x1f40)

    bitmap.followCursor()
    expect(bitmap.originLocked).toBe(false)
    expect(bitmap.lockedOffset).toBeNull()
  })

  it('nudgeOrigin / jumpOrigin move a locked Origin, clamped to [0, size]; no-op while following', () => {
    const documentStore = useDocumentStore()
    const bitmap = useBitmapStore()
    documentStore.open(sourceOfSize(4096), 'a.bin')

    bitmap.nudgeOrigin(40) // following — ignored
    bitmap.jumpOrigin(40)
    expect(bitmap.lockedOffset).toBeNull()

    bitmap.lockOrigin(100)
    bitmap.nudgeOrigin(40)
    expect(bitmap.lockedOffset).toBe(140)

    bitmap.nudgeOrigin(-1000) // clamps at 0
    expect(bitmap.lockedOffset).toBe(0)

    bitmap.jumpOrigin(999_999) // clamps at size — not size − 1 (plan §4.10)
    expect(bitmap.lockedOffset).toBe(4096)
  })

  it('drops the lock when another document is opened (the universal reset)', () => {
    const documentStore = useDocumentStore()
    const bitmap = useBitmapStore()
    documentStore.open(sourceOfSize(4096), 'a.bin')

    bitmap.lockOrigin(2048)
    expect(bitmap.originLocked).toBe(true)

    documentStore.open(sourceOfSize(8192), 'b.bin')
    expect(bitmap.originLocked).toBe(false)
    expect(bitmap.lockedOffset).toBeNull()
  })
})

describe('the Bitmap store — the locked Extent (plan §4.8, ADR-0011)', () => {
  beforeEach(() => {
    localStorage.clear() // preferences persists; keep each case on the defaults
    setActivePinia(createPinia())
  })

  it('is null in Follow mode — the linkage there is the Cursor', () => {
    const bitmap = useBitmapStore()
    expect(bitmap.extent).toBeNull()
  })

  it('is [Origin, Origin + Stride·(Height−1) + Width) once the Origin is locked', () => {
    const prefs = usePreferencesStore()
    const bitmap = useBitmapStore()
    prefs.setBitmapWidth(4)
    bitmap.setRenderHeight(64)

    bitmap.lockOrigin(1000)
    const span = rowByteSpan({ width: 4, stride: 4, height: 64 })
    expect(bitmap.extent).toEqual({ start: 1000, end: 1000 + span })
  })

  it('tracks Width / Stride / render height while locked, and clears on followCursor', () => {
    const prefs = usePreferencesStore()
    const bitmap = useBitmapStore()
    prefs.setBitmapWidth(4)
    bitmap.setRenderHeight(32)
    bitmap.lockOrigin(0)

    prefs.setBitmapWidth(13)
    prefs.setBitmapStrideOffset(3) // Stride = 16
    bitmap.setRenderHeight(48)
    expect(bitmap.extent).toEqual({
      start: 0,
      end: rowByteSpan({ width: 13, stride: 16, height: 48 }),
    })

    bitmap.followCursor()
    expect(bitmap.extent).toBeNull()
  })

  it('a contiguous hull even when Stride > Width — ends at + Width, not + Stride', () => {
    const prefs = usePreferencesStore()
    const bitmap = useBitmapStore()
    prefs.setBitmapWidth(2)
    prefs.setBitmapStrideOffset(6) // Stride 8, a 6-byte per-row gap
    bitmap.setRenderHeight(3)
    bitmap.lockOrigin(100)

    // 8 + 8 + 2 — the last row contributes only its Width, gaps are not in the run.
    expect(bitmap.extent).toEqual({ start: 100, end: 100 + 18 })
  })

  it('setRenderHeight floors at 1 row', () => {
    const bitmap = useBitmapStore()
    bitmap.setRenderHeight(0)
    bitmap.lockOrigin(0)
    expect(bitmap.extent).toEqual({ start: 0, end: usePreferencesStore().bitmapWidth })
  })
})
