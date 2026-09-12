import type { InjectionKey } from 'vue'
import { DerivedWorkClient } from '@/core'

/**
 * Turns an opened `File` into a {@link DerivedWorkClient}. The worker-side
 * counterpart to `ByteSourceFactory` (`byteSourceFactory.ts`) — the seam the
 * Search (#97/#100) and Entropy (#98) panels substitute in tests with a
 * fake-worker-backed `DerivedWorkClient` (`new DerivedWorkClient(file, {
 * createWorker: () => fakeWorker })`), never spinning up a real `Worker`.
 * Unlike `ByteSourceFactory` — typed to the plain `ByteSource` interface, so
 * a test can substitute a wholly synthetic fake — this factory's return type
 * is the concrete `DerivedWorkClient` class (real `#private` fields), so the
 * substitution seam is the injected worker, not the client itself.
 */
export type DerivedWorkClientFactory = (file: File) => DerivedWorkClient

export const defaultDerivedWorkClientFactory: DerivedWorkClientFactory = (file) =>
  new DerivedWorkClient(file)

export const derivedWorkClientFactoryKey: InjectionKey<DerivedWorkClientFactory> = Symbol(
  'derivedWorkClientFactory',
)
