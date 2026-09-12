import { describe, expect, it } from 'vitest'
import { parseTextPattern, scopeMatches, stepMatch } from '../searchMatches'

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

describe('parseTextPattern (#105)', () => {
  it('converts each character to its ascii byte', () => {
    expect(parseTextPattern('MZ', 'ascii')).toEqual(Uint8Array.of(0x4d, 0x5a))
  })

  it('is case-sensitive at the byte level — the reverse table is exact, folding happens at match time', () => {
    expect(parseTextPattern('mz', 'ascii')).toEqual(Uint8Array.of(0x6d, 0x7a))
  })

  it('rejects an empty term, the same as parseHexPattern', () => {
    expect(parseTextPattern('', 'ascii')).toBeNull()
  })

  it('rejects a term containing an unreachable glyph — a typed "." never resolves in ascii', () => {
    expect(parseTextPattern('a.b', 'ascii')).toBeNull()
  })

  it('rejects a term containing a glyph the codepage never renders', () => {
    // ascii never renders '♥'
    expect(parseTextPattern('♥', 'ascii')).toBeNull()
  })

  it('resolves against the requested codepage, not always ascii', () => {
    // cp437's genuine '.' is excluded like every codepage's, but its
    // signature box-drawing corner is a real, injective entry.
    expect(parseTextPattern('╔', 'cp437')).toEqual(Uint8Array.of(0xc9))
  })
})

describe('scopeMatches (#105)', () => {
  const matches = Float64Array.of(2, 5, 9, 20, 41)

  it('passes the array through unchanged for whole-file scope (range: null)', () => {
    expect(scopeMatches(matches, null)).toBe(matches)
  })

  it('keeps only offsets within the half-open captured range', () => {
    expect(Array.from(scopeMatches(matches, { start: 5, end: 20 }))).toEqual([5, 9])
  })

  it('excludes the range end itself — half-open, like SelectionRange', () => {
    expect(Array.from(scopeMatches(matches, { start: 0, end: 9 }))).toEqual([2, 5])
  })

  it('returns an empty array when nothing falls in range', () => {
    expect(Array.from(scopeMatches(matches, { start: 100, end: 200 }))).toEqual([])
  })
})
