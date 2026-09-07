import { describe, expect, it } from 'vitest'
import {
  addressWidthFor,
  toAddress,
  toAsciiChar,
  toBinary,
  toByteSize,
  toHex,
  toSignedByte,
} from '../format'

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

describe('toBinary', () => {
  it.each([
    [0x00, 8, '00000000'],
    [0x4d, 8, '01001101'],
    [0x80, 8, '10000000'],
    [0xff, 8, '11111111'],
    // `width` is a minimum, never a mask — same contract as `toHex`.
    [0x100, 8, '100000000'],
    [0x0, 4, '0000'],
  ])('toBinary(%i, %i) === %s', (value, width, expected) => {
    expect(toBinary(value, width)).toBe(expected)
  })

  it('defaults the width to 8', () => {
    expect(toBinary(0xa)).toBe('00001010')
  })
})

describe('toSignedByte', () => {
  it.each([
    [0x00, 0],
    [0x01, 1],
    [0x7f, 127],
    [0x80, -128],
    [0x81, -127],
    [0xff, -1],
  ])('toSignedByte(%i) === %i', (byte, expected) => {
    expect(toSignedByte(byte)).toBe(expected)
  })
})

describe('toByteSize', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KiB'],
    [1536, '1.5 KiB'],
    [1024 * 1024, '1.0 MiB'],
    [5 * 1024 * 1024 + 512 * 1024, '5.5 MiB'],
    // The band this tool actually lives in.
    [2_000_000_000, '1.9 GiB'],
  ])('toByteSize(%i) === %s', (bytes, expected) => {
    expect(toByteSize(bytes)).toBe(expected)
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
