import { describe, expect, it } from 'vitest'
import {
  addressWidthFor,
  describeSelection,
  parseHexPattern,
  parseOffset,
  toAddress,
  toAsciiChar,
  toBinary,
  toByteSize,
  toHex,
  toHexString,
  toRawText,
  toSignedByte,
} from '../format'
import { cursorAt, extendTo } from '../selection'

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

describe('toHexString', () => {
  it('joins uppercase byte pairs with a single space', () => {
    expect(toHexString(Uint8Array.of(0x4d, 0x5a, 0x90, 0x00))).toBe('4D 5A 90 00')
  })

  it('pads every byte to two digits', () => {
    expect(toHexString(Uint8Array.of(0x00, 0x0a, 0x0f, 0xff))).toBe('00 0A 0F FF')
  })

  it('is empty for an empty run — no stray separator', () => {
    expect(toHexString(new Uint8Array(0))).toBe('')
  })

  it('a single byte has no separator', () => {
    expect(toHexString(Uint8Array.of(0x7f))).toBe('7F')
  })

  it('round-trips through a spaced-hex parser', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_u, i) => (i * 7 + 3) & 0xff)
    const parsed = Uint8Array.from(toHexString(bytes).split(' '), (pair) => parseInt(pair, 16))
    expect(parsed).toEqual(bytes)
  })
})

describe('toRawText', () => {
  it('decodes plain ASCII bytes unchanged', () => {
    expect(toRawText(Uint8Array.of(0x68, 0x65, 0x6c, 0x6c, 0x6f))).toBe('hello')
  })

  it('is empty for an empty run', () => {
    expect(toRawText(new Uint8Array(0))).toBe('')
  })

  it('decodes a multi-byte UTF-8 sequence as one character', () => {
    // U+00E9 é = 0xC3 0xA9; U+1F600 😀 = 0xF0 0x9F 0x98 0x80.
    expect(toRawText(Uint8Array.of(0x63, 0x61, 0x66, 0xc3, 0xa9))).toBe('café')
    expect(toRawText(Uint8Array.of(0xf0, 0x9f, 0x98, 0x80))).toBe('😀')
  })

  it('replaces an undecodable byte with U+FFFD rather than dropping it', () => {
    // 0xFF is never valid UTF-8; the run keeps its length in code points.
    expect(toRawText(Uint8Array.of(0x41, 0xff, 0x42))).toBe('A�B')
  })

  it('keeps a leading BOM instead of silently swallowing three bytes', () => {
    expect(toRawText(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41))).toBe('﻿A')
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

describe('parseOffset', () => {
  it.each([
    // Plain decimal.
    ['0', 0],
    ['8000', 8000],
    ['  16  ', 16], // surrounding whitespace is trimmed
    ['1999999360', 1999999360],
    // 0x-prefixed hex, either case of the prefix and the digits.
    ['0x0', 0],
    ['0x1F40', 8000],
    ['0X1f40', 8000],
    ['0xDEADBEEF', 0xdeadbeef],
    // `_` and `,` are digit separators — the status bar prints the decimal
    // offset with commas, so a paste of it round-trips.
    ['1,999,999,360', 1999999360],
    ['0x1_F40', 8000],
    // Absurdly large is still a number — the caller clamps it to the file.
    ['0xFFFFFFFFFFFFFFFF', 0xffffffffffffffff],
  ])('parseOffset(%j) === %i', (text, expected) => {
    expect(parseOffset(text)).toBe(expected)
  })

  it.each([
    [''],
    ['   '],
    ['1F40'], // bare hex without the 0x prefix is ambiguous, so rejected
    ['0x'], // prefix with no digits
    ['0xGG'],
    ['12abc'],
    ['-5'], // an offset is never signed
    ['3.5'],
    ['0x1.8'],
    ['nonsense'],
  ])('parseOffset(%j) === null', (text) => {
    expect(parseOffset(text)).toBeNull()
  })
})

describe('parseHexPattern (#103)', () => {
  it('parses uppercase and lowercase byte pairs', () => {
    expect(parseHexPattern('4D5A')).toEqual(Uint8Array.of(0x4d, 0x5a))
    expect(parseHexPattern('4d5a')).toEqual(Uint8Array.of(0x4d, 0x5a))
  })

  it('ignores whitespace between bytes — a copied "toHexString" Selection pastes back in', () => {
    expect(parseHexPattern('04 05 06 07')).toEqual(Uint8Array.of(4, 5, 6, 7))
    expect(parseHexPattern('  4D 5A  ')).toEqual(Uint8Array.of(0x4d, 0x5a))
  })

  it('rejects an odd digit count', () => {
    expect(parseHexPattern('4D5')).toBeNull()
    expect(parseHexPattern('4')).toBeNull()
  })

  it('rejects a non-hex character', () => {
    expect(parseHexPattern('4G5A')).toBeNull()
    expect(parseHexPattern('zz')).toBeNull()
  })

  it('rejects an empty (or all-whitespace) term — nothing to search for', () => {
    expect(parseHexPattern('')).toBeNull()
    expect(parseHexPattern('   ')).toBeNull()
  })
})

describe('describeSelection', () => {
  it('speaks the offset and the byte there when the Selection is collapsed (the Cursor)', () => {
    expect(describeSelection(cursorAt(0x1f40), 0x4d)).toBe("offset 0x1F40, byte 4D, 'M'")
  })

  it('renders a non-printable byte with the same "." the ASCII pane shows', () => {
    expect(describeSelection(cursorAt(0), 0x00)).toBe("offset 0x00, byte 00, '.'")
  })

  it('withholds the sentence while the point read for a collapsed Selection is in flight', () => {
    expect(describeSelection(cursorAt(0x1f40), null)).toBeNull()
  })

  it('speaks the range and its length — inclusive on the second address — when extended', () => {
    expect(describeSelection(extendTo(cursorAt(0x1f40), 0x1f4f), null)).toBe(
      'selection 0x1F40 to 0x1F4F, 16 bytes',
    )
  })

  it('a backwards extended Selection still speaks the range low-to-high', () => {
    expect(describeSelection(extendTo(cursorAt(0x10), 0x0), null)).toBe(
      'selection 0x00 to 0x10, 17 bytes',
    )
  })

  it('ignores the byte argument for an extended Selection — there is nothing extra to invent', () => {
    expect(describeSelection(extendTo(cursorAt(0), 5), 0xff)).toBe(
      'selection 0x00 to 0x05, 6 bytes',
    )
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
