import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ByteSource } from '@/core'
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
