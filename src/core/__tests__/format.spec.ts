import { describe, expect, it } from 'vitest'
import { addressWidthFor, toAddress, toAsciiChar, toHex } from '../format'

describe('toHex', () => {
  it.each([
    [0x00, 2, '00'],
    [0x4d, 2, '4D'],
    [0xff, 2, 'FF'],
    [0x00, 4, '0000'],
    [0x1f40, 4, '1F40'],
    // `width` is a minimum, not a mask — the phase-1.5 pin:
    [0xdeadbeef, 8, 'DEADBEEF'],
    [0x1234, 2, '1234'],
    [0x0, 8, '00000000'],
  ])('toHex(%i, %i) === %s', (value, width, expected) => {
    expect(toHex(value, width)).toBe(expected)
  })

  it('defaults the width to 2', () => {
    expect(toHex(0xa)).toBe('0A')
  })
})

describe('toAsciiChar', () => {
  it.each([
    [0x00, '.'],
    [0x1f, '.'],
    [0x20, ' '],
    [0x41, 'A'],
    [0x7e, '~'],
    [0x7f, '.'],
    [0x80, '.'],
    [0xff, '.'],
  ])('toAsciiChar(%i) === %j', (byte, expected) => {
    expect(toAsciiChar(byte)).toBe(expected)
  })
})

describe('toAddress', () => {
  it.each([
    [0, 8, '00000000'],
    [0x1f40, 8, '00001F40'],
    [0x1f40, 10, '0000001F40'],
  ])('toAddress(%i, %i) === %s', (offset, width, expected) => {
    expect(toAddress(offset, width)).toBe(expected)
  })

  it('defaults the width to 8', () => {
    expect(toAddress(0x1f40)).toBe('00001F40')
  })
})

describe('addressWidthFor', () => {
  it.each([
    [0, 8],
    [100, 8],
    // 4 GiB: the largest offset is 0xFFFFFFFF, 8 hex digits.
    [0xffffffff + 1, 8],
    // One byte past 4 GiB: 9 digits, so the gutter widens to 10.
    [0xffffffff + 2, 10],
    // 2^48: the largest offset is 0xFFFFFFFFFFFF, 12 digits.
    [2 ** 48, 12],
  ])('addressWidthFor(%i) === %i', (size, expected) => {
    expect(addressWidthFor(size)).toBe(expected)
  })
})
