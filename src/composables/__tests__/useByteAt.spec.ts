import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import type { EffectScope, Ref } from 'vue'
import { ByteSourceError } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { useByteAt } from '../useByteAt'

// Shared by the status bar's `u8`/`i8`/`bin` fields (#23) and the Viewport's
// cursor live region (#27) — the one place "read the byte at an offset,
// safely across an async gap" is implemented, so both consumers behave
// identically and a future fix to it lands once.

class SyncSource implements ByteSource {
  readonly size: number
  readonly #bytes: Uint8Array
  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.length
  }
  readSync(offset: number, length: number): Uint8Array | null {
    if (offset + length > this.size) return null
    return this.#bytes.slice(offset, offset + length)
  }
  read(offset: number, length: number): Promise<Uint8Array> {
    return Promise.resolve(this.#bytes.slice(offset, offset + length))
  }
  prefetch(): void {}
  close(): void {}
}

/** `readSync` always misses; `read` stays pending until resolved/rejected by hand. */
class DeferredSource implements ByteSource {
  readonly size = 64
  #resolvers: ((bytes: Uint8Array) => void)[] = []
  #rejecters: ((error: unknown) => void)[] = []
  readSync(): Uint8Array | null {
    return null
  }
  read(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.#resolvers.push(resolve)
      this.#rejecters.push(reject)
    })
  }
  prefetch(): void {}
  close(): void {}
  resolveNext(byte: number): void {
    this.#resolvers.shift()?.(Uint8Array.of(byte))
  }
  rejectNext(error: unknown): void {
    this.#rejecters.shift()?.(error)
  }
}

/** Drains every pending microtask (Vue's watcher scheduler plus any Promise
 *  chain), unlike a single `nextTick()` — the `.then().catch()` in `useByteAt`
 *  needs more than one tick to settle after a hand-resolved/rejected Promise. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let pinia: Pinia
let scope: EffectScope | null = null

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  scope?.stop()
  scope = null
})

/** Run `useByteAt` inside a detached reactive scope, torn down after the test. */
function setup(
  source: ByteSource | null,
  offset: number | null,
): { byte: Ref<number | null>; sourceRef: Ref<ByteSource | null>; offsetRef: Ref<number | null> } {
  // shallowRef, matching the store's own `source` (ADR-0001): a ByteSource
  // wraps a `File` and manages its own state, and Vue must not deep-proxy it.
  const sourceRef = shallowRef(source)
  const offsetRef = ref(offset) as Ref<number | null>
  scope = effectScope()
  const byte = scope.run(() => useByteAt(sourceRef, offsetRef))!
  return { byte, sourceRef, offsetRef }
}

describe('useByteAt', () => {
  it('is null with no source or no offset', () => {
    expect(setup(null, null).byte.value).toBeNull()
    expect(setup(new SyncSource(Uint8Array.of(1, 2, 3)), null).byte.value).toBeNull()
  })

  it('resolves synchronously from a resident byte via readSync', () => {
    const { byte } = setup(new SyncSource(Uint8Array.of(0x4d, 0x5a)), 0)
    expect(byte.value).toBe(0x4d)
  })

  it('falls back to the async read when readSync misses', async () => {
    const source = new DeferredSource()
    const { byte } = setup(source, 5)
    expect(byte.value).toBeNull() // still settling

    source.resolveNext(0x99)
    await flush()
    expect(byte.value).toBe(0x99)
  })

  it('drops a resolution for an offset the caller has since moved off', async () => {
    const source = new DeferredSource()
    const { byte, offsetRef } = setup(source, 5)

    offsetRef.value = 6 // still pending — readSync misses again for 6 too
    source.resolveNext(0x11) // resolves the *first* read, issued for offset 5
    await flush()

    expect(byte.value).toBeNull() // stale — dropped, not shown for offset 6 either
  })

  it('drops a resolution for a source the caller has since replaced', async () => {
    const first = new DeferredSource()
    const second = new SyncSource(Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff))
    const { byte, sourceRef } = setup(first, 5)

    sourceRef.value = second // resident at offset 5 on the new source: 0xff
    await flush()
    expect(byte.value).toBe(0xff)

    first.resolveNext(0x11) // a late resolution for the replaced source
    await flush()

    expect(byte.value).toBe(0xff) // unchanged
  })

  it('reports null again once the source is cleared', async () => {
    const { byte, sourceRef } = setup(new SyncSource(Uint8Array.of(1)), 0)
    await flush()
    expect(byte.value).toBe(1)

    sourceRef.value = null
    await flush()
    expect(byte.value).toBeNull()
  })

  it('raises the dead-source banner on a source-gone rejection', async () => {
    const source = new DeferredSource()
    const { byte } = setup(source, 0)
    const store = useDocumentStore(pinia)
    expect(store.sourceHealth).toBe('ok')

    source.rejectNext(new ByteSourceError('source-gone'))
    await flush()

    expect(store.sourceHealth).toBe('gone')
    expect(byte.value).toBeNull()
  })

  it('does not escalate on read-failed — that stays the row-fetch path’s own counter (#26)', async () => {
    const source = new DeferredSource()
    setup(source, 0)
    const store = useDocumentStore(pinia)

    source.rejectNext(new ByteSourceError('read-failed'))
    await flush()

    expect(store.sourceHealth).toBe('ok')
  })

  it('ignores a source-gone rejection for a read the caller has since abandoned', async () => {
    const source = new DeferredSource()
    const { offsetRef } = setup(source, 0)
    const store = useDocumentStore(pinia)

    offsetRef.value = 1 // moved on before the old read settles
    source.rejectNext(new ByteSourceError('source-gone'))
    await flush()

    expect(store.sourceHealth).toBe('ok') // the abandoned read's failure is not this offset's problem
  })
})
