import { describe, expect, it } from 'vitest'
import {
  decodeInspectorRow,
  INSPECTOR_READ_LENGTH,
  INSPECTOR_ROWS,
  type InspectorRow,
} from '../inspector'

/** Find a row by its key — the spec addresses rows the way the Panel does. */
function row(key: string): InspectorRow {
  const found = INSPECTOR_ROWS.find((r) => r.key === key)
  if (!found) throw new Error(`no inspector row ${key}`)
  return found
}

function decode(key: string, bytes: number[], byteOrder: 'le' | 'be', intHex = false): string {
  return decodeInspectorRow(row(key), Uint8Array.from(bytes), { byteOrder, intHex })
}

// The eight ascending bytes and one with every top bit set — the load-bearing
// window for signedness and byte order.
const ASC = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
const HIGH = [0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87]
const ALL_FF = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

describe('INSPECTOR_ROWS', () => {
  it('is the fixed list u8 i8 bin … f32 f64, grouped for the hairlines (plan §3.2)', () => {
    expect(INSPECTOR_ROWS.map((r) => r.key)).toEqual([
      'u8',
      'i8',
      'bin',
      'u16',
      'i16',
      'u32',
      'i32',
      'u64',
      'i64',
      'f32',
      'f64',
    ])
    expect(INSPECTOR_ROWS.map((r) => r.group)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  })

  it('has no f16 and no text line', () => {
    expect(INSPECTOR_ROWS.some((r) => r.key === 'f16')).toBe(false)
    expect(INSPECTOR_ROWS.some((r) => r.kind === ('text' as never))).toBe(false)
  })

  it('every row carries a full aria-label', () => {
    for (const r of INSPECTOR_ROWS) {
      expect(r.ariaLabel.length).toBeGreaterThan(2)
    }
  })

  it('never needs more than an 8-byte read', () => {
    expect(Math.max(...INSPECTOR_ROWS.map((r) => r.width))).toBe(INSPECTOR_READ_LENGTH)
  })
})

describe('decodeInspectorRow — decimal, little-endian', () => {
  it.each([
    ['u8', '1'],
    ['i8', '1'],
    ['bin', '00000001'],
    ['u16', '513'],
    ['i16', '513'],
    ['u32', '67305985'],
    ['i32', '67305985'],
    ['u64', '578437695752307201'],
    ['i64', '578437695752307201'],
  ])('%s of the ascending window === %s', (key, expected) => {
    expect(decode(key, ASC, 'le')).toBe(expected)
  })

  it.each([
    ['u8', '128'],
    ['i8', '-128'],
    ['bin', '10000000'],
    ['u16', '33152'],
    ['i16', '-32384'],
    ['u32', '2206368128'],
    ['i32', '-2088599168'],
    ['u64', '9765639646188044672'],
    ['i64', '-8681104427521506944'],
  ])('%s of the high-bit window === %s', (key, expected) => {
    expect(decode(key, HIGH, 'le')).toBe(expected)
  })
})

describe('decodeInspectorRow — byte order flips only the multi-byte rows', () => {
  it('u8 / i8 / bin are width-1 and identical either way (plan §3.3, §4.5)', () => {
    for (const key of ['u8', 'i8', 'bin']) {
      expect(decode(key, ASC, 'le')).toBe(decode(key, ASC, 'be'))
    }
  })

  it.each([
    ['u16', '258'],
    ['i16', '258'],
    ['u32', '16909060'],
    ['i32', '16909060'],
    ['u64', '72623859790382856'],
    ['i64', '72623859790382856'],
  ])('%s big-endian of the ascending window === %s', (key, expected) => {
    expect(decode(key, ASC, 'be')).toBe(expected)
  })
})

describe('decodeInspectorRow — the hex toggle (plan §3.3)', () => {
  it('shows the raw N-byte pattern unsigned, zero-padded to type width', () => {
    expect(decode('u16', ASC, 'le', true)).toBe('0201')
    expect(decode('u32', ASC, 'le', true)).toBe('04030201')
    expect(decode('u64', ASC, 'le', true)).toBe('0807060504030201')
    expect(decode('u16', ASC, 'be', true)).toBe('0102')
  })

  it('makes a signed row byte-identical to its unsigned sibling', () => {
    expect(decode('i16', HIGH, 'le', true)).toBe(decode('u16', HIGH, 'le', true))
    expect(decode('i32', HIGH, 'be', true)).toBe(decode('u32', HIGH, 'be', true))
    expect(decode('i64', HIGH, 'le', true)).toBe(decode('u64', HIGH, 'le', true))
    expect(decode('i64', HIGH, 'le', true)).toBe('8786858483828180')
  })

  it('leaves bin at 8 binary digits — unaffected by hex', () => {
    expect(decode('bin', HIGH, 'le', true)).toBe('10000000')
    expect(decode('bin', HIGH, 'be', true)).toBe('10000000')
  })

  it('does not touch the float rows', () => {
    expect(decode('f32', ASC, 'le', true)).toBe(decode('f32', ASC, 'le', false))
  })

  it('u8 / i8 in hex are the two-digit byte', () => {
    expect(decode('u8', HIGH, 'le', true)).toBe('80')
    expect(decode('i8', HIGH, 'le', true)).toBe('80')
  })
})

describe('decodeInspectorRow — floats via String(value) (plan §3.3)', () => {
  it('a clean f32 / f64 round-trips to a short decimal', () => {
    // f32 LE 1.0 = 00 00 80 3F; f64 LE 1.0 = 00 00 00 00 00 00 F0 3F.
    expect(decode('f32', [0x00, 0x00, 0x80, 0x3f, 0, 0, 0, 0], 'le')).toBe('1')
    expect(decode('f64', [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f], 'le')).toBe('1')
  })

  it('auto-exponential at the extremes', () => {
    expect(decode('f64', ASC, 'le')).toBe('5.447603722011605e-270')
  })

  it('NaN / Infinity / -Infinity are shown literally', () => {
    expect(decode('f32', ALL_FF, 'le')).toBe('NaN')
    expect(decode('f64', ALL_FF, 'be')).toBe('NaN')
    // f32 +Inf = 7F 80 00 00 (BE); -Inf = FF 80 00 00 (BE).
    expect(decode('f32', [0x7f, 0x80, 0x00, 0x00, 0, 0, 0, 0], 'be')).toBe('Infinity')
    expect(decode('f32', [0xff, 0x80, 0x00, 0x00, 0, 0, 0, 0], 'be')).toBe('-Infinity')
  })
})

describe('decodeInspectorRow — all-FF window', () => {
  it.each([
    ['u8', '255'],
    ['i8', '-1'],
    ['u16', '65535'],
    ['i16', '-1'],
    ['u32', '4294967295'],
    ['i32', '-1'],
    ['u64', '18446744073709551615'],
    ['i64', '-1'],
  ])('%s === %s (order-independent for all-FF)', (key, expected) => {
    expect(decode(key, ALL_FF, 'le')).toBe(expected)
    expect(decode(key, ALL_FF, 'be')).toBe(expected)
  })
})

describe('decodeInspectorRow — reads from a byte offset into a larger buffer', () => {
  it('honours byteOffset / byteLength rather than the whole backing buffer', () => {
    const backing = Uint8Array.from([0x99, 0x99, ...ASC, 0x99])
    const windowed = backing.subarray(2, 2 + 8)
    expect(decodeInspectorRow(row('u32'), windowed, { byteOrder: 'le', intHex: false })).toBe(
      '67305985',
    )
  })
})
