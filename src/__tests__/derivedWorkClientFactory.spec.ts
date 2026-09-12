import { describe, expect, it } from 'vitest'
import {
  defaultDerivedWorkClientFactory,
  derivedWorkClientFactoryKey,
} from '../derivedWorkClientFactory'

describe('derivedWorkClientFactory', () => {
  it('exposes a symbol injection key, mirroring byteSourceFactoryKey', () => {
    expect(typeof derivedWorkClientFactoryKey).toBe('symbol')
  })

  it('the default factory is a one-argument (file) => DerivedWorkClient function', () => {
    // Constructing the default factory's real DerivedWorkClient spins up an
    // actual `Worker`, which the test environment does not implement — so,
    // like `defaultByteSourceFactory`, this seam is only exercised through
    // substitution (a test-injected factory), never invoked for real here.
    expect(defaultDerivedWorkClientFactory).toBeInstanceOf(Function)
    expect(defaultDerivedWorkClientFactory.length).toBe(1)
  })
})
