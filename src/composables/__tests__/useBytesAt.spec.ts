import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, ref, shallowRef } from 'vue'
import type { EffectScope, Ref } from 'vue'
import { ByteSourceError } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { useBytesAt } from '../useBytesAt'

// The generalisation of `useByteAt` the Inspector reads through (#54, plan §3.4):
// a short run at an offset, resident-synchronous when it can be, short at EOF
// rather than failing, and guarded against a moved offset / swapped source.

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
    const end = Math.min(offset + length, this.size)
    return Promise.resolve(this.#bytes.slice(offset, end))
  }
  prefetch(): void {}
  close(): void {}
}

/** `readSync` always misses; `read` stays pending until resolved / rejected by hand. */
class DeferredSource implements ByteSource {
  readonly size: number
  #resolvers: ((bytes: Uint8Array) => void)[] = []
  #rejecters: ((error: unknown) => void)[] = []
  constructor(size = 64) {
    this.size = size
  }
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
  resolveNext(bytes: number[]): void {
    this.#resolvers.shift()?.(Uint8Array.from(bytes))
  }
  rejectNext(error: unknown): void {
    this.#rejecters.shift()?.(error)
  }
}

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

function setup(
  source: ByteSource | null,
  offset: number | null,
  length: number,
): { run: Ref<Uint8Array | null>; sourceRef: Ref<ByteSource | null>; offsetRef: Ref<number | null> } {
  const sourceRef = shallowRef(source)
  const offsetRef = ref(offset) as Ref<number | null>
  scope = effectScope()
  const run = scope.run(() => useBytesAt(sourceRef, offsetRef, length))!
  return { run, sourceRef, offsetRef }
}

const ASC = Uint8Array.from({ length: 32 }, (_u, i) => i)

describe('useBytesAt', () => {
  it('is null with no source or no offset', () => {
    expect(setup(null, null, 8).run.value).toBeNull()
    expect(setup(new SyncSource(ASC), null, 8).run.value).toBeNull()
  })

  it('serves a resident run synchronously through readSync', () => {
    const { run } = setup(new SyncSource(ASC), 4, 8)
    expect([...run.value!]).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('falls back to the async read when readSync misses', async () => {
    const source = new DeferredSource()
    const { run } = setup(source, 0, 8)
    expect(run.value).toBeNull() // pending — the Panel shows ··

    source.resolveNext([10, 11, 12, 13, 14, 15, 16, 17])
    await flush()
    expect([...run.value!]).toEqual([10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('comes back short near EOF rather than failing — never a pending run', () => {
    // 6 bytes exist; ask for 8 at offset 3 -> a 3-byte run, resident.
    const { run } = setup(new SyncSource(Uint8Array.of(0, 1, 2, 3, 4, 5)), 3, 8)
    expect([...run.value!]).toEqual([3, 4, 5])
  })

  it('is an empty run, not pending, when the offset is at EOF', () => {
    const { run } = setup(new SyncSource(Uint8Array.of(0, 1, 2, 3)), 4, 8)
    expect(run.value).toEqual(new Uint8Array(0))
  })

  it('drops a resolution for an offset the caller has since moved off', async () => {
    const source = new DeferredSource()
    const { run, offsetRef } = setup(source, 5, 8)

    offsetRef.value = 6
    source.resolveNext([1, 2, 3, 4, 5, 6, 7, 8]) // resolves the read issued for offset 5
    await flush()

    expect(run.value).toBeNull() // stale — dropped
  })

  it('drops a resolution for a source the caller has since replaced', async () => {
    const first = new DeferredSource()
    const second = new SyncSource(ASC)
    const { run, sourceRef } = setup(first, 5, 4)

    sourceRef.value = second
    await flush()
    expect([...run.value!]).toEqual([5, 6, 7, 8])

    first.resolveNext([0, 0, 0, 0])
    await flush()
    expect([...run.value!]).toEqual([5, 6, 7, 8]) // unchanged
  })

  it('reports null again once the source is cleared', async () => {
    const { run, sourceRef } = setup(new SyncSource(ASC), 0, 4)
    expect(run.value).not.toBeNull()

    sourceRef.value = null
    await flush()
    expect(run.value).toBeNull()
  })

  it('raises the dead-source banner on a source-gone rejection', async () => {
    const source = new DeferredSource()
    setup(source, 0, 8)
    const store = useDocumentStore(pinia)
    expect(store.sourceHealth).toBe('ok')

    source.rejectNext(new ByteSourceError('source-gone'))
    await flush()
    expect(store.sourceHealth).toBe('gone')
  })

  it('does not escalate on read-failed', async () => {
    const source = new DeferredSource()
    setup(source, 0, 8)
    const store = useDocumentStore(pinia)

    source.rejectNext(new ByteSourceError('read-failed'))
    await flush()
    expect(store.sourceHealth).toBe('ok')
  })

  it('ignores a source-gone rejection for a read the caller has since abandoned', async () => {
    const source = new DeferredSource()
    const { offsetRef } = setup(source, 0, 8)
    const store = useDocumentStore(pinia)

    offsetRef.value = 1
    source.rejectNext(new ByteSourceError('source-gone'))
    await flush()
    expect(store.sourceHealth).toBe('ok')
  })
})
