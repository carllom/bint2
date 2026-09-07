import { describe, expect, it } from 'vitest'
import { cursorAt, extendTo, isCollapsed, rangeOf } from '../selection'

describe('cursorAt', () => {
  it('puts both ends on the same byte — the Cursor is the collapsed Selection', () => {
    const cursor = cursorAt(0x1f40)
    expect(cursor).toEqual({ anchor: 0x1f40, focus: 0x1f40 })
    expect(isCollapsed(cursor)).toBe(true)
  })

  it('covers exactly one byte as a range, and spans none as a Cursor', () => {
    // `rangeOf` still yields a one-byte span; "spans no bytes" is the semantic
    // the viewer honours by not filling a collapsed Selection.
    expect(rangeOf(cursorAt(7))).toEqual({ start: 7, end: 8 })
    expect(isCollapsed(cursorAt(7))).toBe(true)
  })
})

describe('rangeOf', () => {
  it('derives a half-open [start, end) with end one past the last byte', () => {
    expect(rangeOf({ anchor: 0x1f40, focus: 0x1f4f })).toEqual({ start: 0x1f40, end: 0x1f50 })
  })

  it('is the same range whichever end is the anchor — direction does not change the bytes', () => {
    const forwards = rangeOf({ anchor: 10, focus: 20 })
    const backwards = rangeOf({ anchor: 20, focus: 10 })
    expect(forwards).toEqual({ start: 10, end: 21 })
    expect(backwards).toEqual({ start: 10, end: 21 })
  })
})

describe('isCollapsed', () => {
  it('is true only when the ends coincide', () => {
    expect(isCollapsed({ anchor: 5, focus: 5 })).toBe(true)
    expect(isCollapsed({ anchor: 5, focus: 6 })).toBe(false)
    expect(isCollapsed({ anchor: 6, focus: 5 })).toBe(false)
  })
})

describe('extendTo', () => {
  it('moves the focus and keeps the anchor', () => {
    expect(extendTo({ anchor: 10, focus: 12 }, 20)).toEqual({ anchor: 10, focus: 20 })
  })

  it('extends a backwards Selection backwards — it moves the end the reader grabbed', () => {
    const backwards = extendTo({ anchor: 20, focus: 15 }, 8)
    expect(backwards).toEqual({ anchor: 20, focus: 8 })
    expect(rangeOf(backwards)).toEqual({ start: 8, end: 21 })
  })

  it('can collapse a Selection back to the Cursor by extending onto the anchor', () => {
    const collapsed = extendTo({ anchor: 10, focus: 20 }, 10)
    expect(isCollapsed(collapsed)).toBe(true)
  })

  it('crosses the anchor, flipping direction, in a single extend', () => {
    const flipped = extendTo({ anchor: 10, focus: 15 }, 4)
    expect(flipped).toEqual({ anchor: 10, focus: 4 })
    expect(rangeOf(flipped)).toEqual({ start: 4, end: 11 })
  })
})
