import { describe, expect, it } from 'vitest'
import {
  AKAI,
  charFor,
  CODE_PAGES,
  CP437,
  PETSCII,
  PETSCII_LOWER,
  PLACEHOLDER_GLYPH,
  WINDOWS_1252,
} from '../index'

// The char-column code pages (#56, plan §5). Following the `format.spec.ts`
// precedent: each table pins its load-bearing and boundary entries — 0x00 0x1F
// 0x20 0x7F 0x80 0xA0 0xFF plus the table's signature glyphs — not all 256
// (exact retro glyph shapes beyond these are visual, low-value, plan §8).

describe('CODE_PAGES', () => {
  it('is the shipping six in <select> order, ascii first', () => {
    expect([...CODE_PAGES]).toEqual([
      'ascii',
      'cp437',
      'windows-1252',
      'petscii',
      'petscii-lower',
      'akai',
    ])
  })

  it('every non-ascii table is a full 256-entry map', () => {
    for (const table of [CP437, WINDOWS_1252, PETSCII, PETSCII_LOWER, AKAI]) {
      expect(table).toHaveLength(256)
    }
  })

  it('the shared placeholder is a single "."', () => {
    expect(PLACEHOLDER_GLYPH).toBe('.')
  })
})

describe('charFor — ascii (== toAsciiChar, plan §5.5)', () => {
  it.each([
    [0x00, '.'],
    [0x1f, '.'],
    [0x20, ' '],
    [0x41, 'A'],
    [0x7e, '~'],
    [0x7f, '.'],
    [0x80, '.'],
    [0xa0, '.'],
    [0xff, '.'],
  ])('charFor(%i, ascii) === %j', (byte, glyph) => {
    expect(charFor(byte, 'ascii')).toBe(glyph)
  })
})

describe('charFor — cp437 (full hardware glyph set, no placeholder ever)', () => {
  it.each([
    [0x00, ' '], // blank, not a control picture
    [0x01, '☺'],
    [0x03, '♥'],
    [0x1f, '▼'],
    [0x20, ' '],
    [0x7f, '⌂'],
    [0x80, 'Ç'],
    [0xc9, '╔'], // the signature box-drawing corner
    [0xdb, '█'],
    [0xe0, 'α'],
    [0xff, ' '], // NBSP — a glyph, still not the placeholder
  ])('charFor(%i, cp437) === %j', (byte, glyph) => {
    expect(charFor(byte, 'cp437')).toBe(glyph)
  })

  it.each([[0x00], [0x07], [0x1f], [0x7f], [0x80], [0xa0], [0xff]])(
    'never renders the shared placeholder for control / high byte %i (only 0x2E is ".")',
    (byte) => {
      expect(charFor(byte, 'cp437')).not.toBe(PLACEHOLDER_GLYPH)
    },
  )
})

describe('charFor — windows-1252 (WHATWG index, five real holes)', () => {
  it.each([
    [0x00, '.'],
    [0x1f, '.'],
    [0x20, ' '],
    [0x7f, '.'],
    [0x80, '€'],
    [0x95, '•'],
    [0xa0, '.'], // NBSP — not a visible glyph
    [0xad, '.'], // SHY
    [0xe9, 'é'],
    [0xff, 'ÿ'],
  ])('charFor(%i, windows-1252) === %j', (byte, glyph) => {
    expect(charFor(byte, 'windows-1252')).toBe(glyph)
  })

  it.each([[0x81], [0x8d], [0x8f], [0x90], [0x9d]])(
    'renders the shared placeholder for the unassigned slot %i',
    (byte) => {
      expect(charFor(byte, 'windows-1252')).toBe(PLACEHOLDER_GLYPH)
    },
  )
})

describe('charFor — petscii (unshifted, uppercase/graphics)', () => {
  it.each([
    [0x00, '.'],
    [0x1f, '.'],
    [0x20, ' '],
    [0x40, '@'],
    [0x41, 'A'],
    [0x5a, 'Z'],
    [0x5c, '£'],
    [0x5e, '↑'],
    [0x5f, '←'],
    [0x61, '♠'], // card suits from the graphics block
    [0x73, '♥'],
    [0x78, '♣'],
    [0x7a, '♦'],
    [0x7e, 'π'],
    [0x80, '.'], // control range
    [0x9f, '.'],
    [0xa0, '█'], // shift-space reverse block
    [0xff, 'π'],
  ])('charFor(%i, petscii) === %j', (byte, glyph) => {
    expect(charFor(byte, 'petscii')).toBe(glyph)
  })

  it('0xC0–0xDF duplicate 0x60–0x7F', () => {
    for (let b = 0xc0; b <= 0xdf; b++) {
      expect(charFor(b, 'petscii')).toBe(charFor(b - 0x60, 'petscii'))
    }
  })
})

describe('charFor — petscii-lower (shifted, lowercase/uppercase)', () => {
  it.each([
    [0x00, '.'],
    [0x20, ' '],
    [0x41, 'a'], // lowercase where the unshifted set has uppercase
    [0x5a, 'z'],
    [0x61, 'A'], // uppercase where the unshifted set has the graphics block
    [0x7a, 'Z'],
    [0x80, '.'],
    [0xff, 'π'],
  ])('charFor(%i, petscii-lower) === %j', (byte, glyph) => {
    expect(charFor(byte, 'petscii-lower')).toBe(glyph)
  })
})

describe('charFor — akai (S1000/S3000 sampler name codec)', () => {
  it.each([
    [0x00, '0'],
    [0x09, '9'],
    [0x0a, ' '],
    [0x0b, 'A'],
    [0x24, 'Z'],
    [0x25, '#'],
    [0x26, '+'],
    [0x27, '-'],
    [0x28, '.'], // a genuine "." glyph — the last mapped code
    [0x29, '.'], // first byte past the name range — the placeholder, same glyph
    [0x41, '.'], // ASCII 'A' is code 65, well past 40 — placeholder
    [0xff, '.'],
  ])('charFor(%i, akai) === %j', (byte, glyph) => {
    expect(charFor(byte, 'akai')).toBe(glyph)
  })
})

describe('charFor — byte is masked to 0–255', () => {
  it('ignores bits above the low byte', () => {
    expect(charFor(0x141, 'ascii')).toBe(charFor(0x41, 'ascii'))
    expect(charFor(0x1c9, 'cp437')).toBe(charFor(0xc9, 'cp437'))
  })
})
