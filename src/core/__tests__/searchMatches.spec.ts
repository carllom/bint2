import { describe, expect, it } from 'vitest'
import { stepMatch } from '../searchMatches'

describe('stepMatch', () => {
  it('returns null with no matches at all — "No match found", never a wrap', () => {
    expect(stepMatch(new Float64Array(0), 0, 'next')).toBeNull()
    expect(stepMatch(new Float64Array(0), 0, 'previous')).toBeNull()
  })

  it('next finds the first match strictly past `from`', () => {
    const matches = Float64Array.of(5, 20, 40)
    expect(stepMatch(matches, 0, 'next')).toEqual({ offset: 5, wrapped: false })
    expect(stepMatch(matches, 5, 'next')).toEqual({ offset: 20, wrapped: false })
    expect(stepMatch(matches, 19, 'next')).toEqual({ offset: 20, wrapped: false })
  })

  it('next wraps to the first match once none remain past `from`', () => {
    const matches = Float64Array.of(5, 20, 40)
    expect(stepMatch(matches, 40, 'next')).toEqual({ offset: 5, wrapped: true })
    expect(stepMatch(matches, 999, 'next')).toEqual({ offset: 5, wrapped: true })
  })

  it('previous finds the last match strictly before `from`', () => {
    const matches = Float64Array.of(5, 20, 40)
    expect(stepMatch(matches, 999, 'previous')).toEqual({ offset: 40, wrapped: false })
    expect(stepMatch(matches, 40, 'previous')).toEqual({ offset: 20, wrapped: false })
    expect(stepMatch(matches, 21, 'previous')).toEqual({ offset: 20, wrapped: false })
  })

  it('previous wraps to the last match once none remain before `from`', () => {
    const matches = Float64Array.of(5, 20, 40)
    expect(stepMatch(matches, 5, 'previous')).toEqual({ offset: 40, wrapped: true })
    expect(stepMatch(matches, 0, 'previous')).toEqual({ offset: 40, wrapped: true })
  })

  it('a single match wraps onto itself when stepped past its own end', () => {
    const matches = Float64Array.of(10)
    expect(stepMatch(matches, 10, 'next')).toEqual({ offset: 10, wrapped: true })
    expect(stepMatch(matches, 10, 'previous')).toEqual({ offset: 10, wrapped: true })
  })
})
