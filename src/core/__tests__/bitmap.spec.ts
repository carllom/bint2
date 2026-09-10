import { describe, expect, it } from 'vitest'
import { bitmapOffsetAt, eofByteSlots, packBitmap, rowByteSpan } from '../bitmap'

// ── Prototype fixtures, reconstructed ───────────────────────────────────────
// Lifted verbatim from src/core/__prototype__/bitmap-packing.prototype.html on
// branch prototype/bitmap-packing (the #70 primary source). The `.#` art is the
// independent source of truth: `artToBytes` encodes it MSB-first via `0x80 >> i`;
// the tests decode `bits` via `(byte >> b) & 1` into column `7 - b`, a separate
// expression, so a round-trip that agrees is not tautological.

/** 8 strings of 8 chars → 8 bytes, one per row, `#` = set, leftmost = MSB. */
function artToBytes(rows: string[]): number[] {
  return rows.map((r) => {
    let v = 0
    for (let i = 0; i < 8; i++) if (r[i] === '#') v |= 0x80 >> i
    return v
  })
}

/** Render a packed row-major `bits` buffer back to `.#` art, one string per row. */
function bitsToArt(bits: Uint8Array, w: number, h: number): string[] {
  const rows: string[] = []
  for (let y = 0; y < h; y++) {
    let s = ''
    for (let x = 0; x < w; x++) s += bits[y * w + x] === 1 ? '#' : '.'
    rows.push(s)
  }
  return rows
}

const GLYPH_A = ['..###...', '.#...#..', '#.....#.', '#######.', '#.....#.', '#.....#.', '#.....#.', '........']
const GLYPH_B = ['######..', '#.....#.', '#.....#.', '######..', '#.....#.', '#.....#.', '######..', '........']
const GLYPH_J = ['..#####.', '....#...', '....#...', '....#...', '#...#...', '#...#...', '.###....', '........']

/** The prototype's padded framebuffer: 104-px content in 16 bytes/row, 48 rows,
 *  3 pad bytes per row. Correct view is Width 13 / Stride 16. */
const FB = { strideBytes: 16, rows: 48, wPx: 104 }
function buildFramebuffer(): Uint8Array {
  const { strideBytes, rows, wPx } = FB
  const buf = new Uint8Array(strideBytes * rows)
  const set = (x: number, y: number) => {
    if (x < 0 || x >= wPx || y < 0 || y >= rows) return
    buf[y * strideBytes + (x >> 3)]! |= 0x80 >> (x & 7)
  }
  for (let x = 0; x < wPx; x++) {
    set(x, 0)
    set(x, rows - 1)
  }
  for (let y = 0; y < rows; y++) {
    set(0, y)
    set(wPx - 1, y)
  }
  for (let x = 0; x < wPx; x++) set(x, Math.round((x * (rows - 1)) / (wPx - 1)))
  for (let y = 10; y < 22; y++) for (let x = 68; x < 94; x++) set(x, y)
  return buf
}

describe('rowByteSpan', () => {
  it('is stride·(height−1) + width — the #66 read span', () => {
    // Worked by hand: 63 full strides plus the last row's width.
    expect(rowByteSpan({ width: 4, stride: 4, height: 64 })).toBe(4 * 63 + 4)
    expect(rowByteSpan({ width: 13, stride: 16, height: 48 })).toBe(16 * 47 + 13)
  })

  it('a single row spans exactly its width, whatever the stride', () => {
    expect(rowByteSpan({ width: 13, stride: 16, height: 1 })).toBe(13)
    expect(rowByteSpan({ width: 2, stride: 999, height: 1 })).toBe(2)
  })

  it('the trailing gap of the last row is not counted', () => {
    // Two rows, stride 16, width 13: 16 for the first row, 13 for the second.
    expect(rowByteSpan({ width: 13, stride: 16, height: 2 })).toBe(29)
  })
})

describe('packBitmap — shape and MSB-first handedness', () => {
  it('the image is width·8 × height pixels, one bits entry per pixel', () => {
    const out = packBitmap(new Uint8Array(64), { width: 4, stride: 4, height: 8, invert: false })
    expect([out.w, out.h]).toEqual([32, 8])
    expect(out.bits).toHaveLength(32 * 8)
  })

  it('MSB is the leftmost pixel, LSB the rightmost (independent literals)', () => {
    const pack1 = (byte: number) =>
      Array.from(packBitmap(Uint8Array.of(byte), { width: 1, stride: 1, height: 1, invert: false }).bits)
    expect(pack1(0x81)).toEqual([1, 0, 0, 0, 0, 0, 0, 1])
    expect(pack1(0xc0)).toEqual([1, 1, 0, 0, 0, 0, 0, 0])
    expect(pack1(0x03)).toEqual([0, 0, 0, 0, 0, 0, 1, 1])
  })

  it('renders an 8×8 font glyph upright and correctly handed', () => {
    // Width 1 / Stride 1 / Height 8 — the prototype "font ROM as a 1-glyph column".
    for (const art of [GLYPH_A, GLYPH_B, GLYPH_J]) {
      const bytes = Uint8Array.from(artToBytes(art))
      const out = packBitmap(bytes, { width: 1, stride: 1, height: 8, invert: false })
      // Byte-identical art back ⇒ no vertical flip and no horizontal mirror.
      expect(bitsToArt(out.bits, out.w, out.h)).toEqual(art)
    }
  })
})

describe('packBitmap — Stride > Width skips exactly the trailing Stride−Width bytes', () => {
  // Two content bytes then one 0xFF pad byte per row, three rows.
  const padded = Uint8Array.from([0xaa, 0x55, 0xff, 0xaa, 0x55, 0xff, 0xaa, 0x55, 0xff])

  it('reads only the leading Width bytes of each row; the pad never renders', () => {
    const out = packBitmap(padded, { width: 2, stride: 3, height: 3, invert: false })
    expect(out.bytesRead).toBe(6)
    expect(out.bytesMissing).toBe(0)
    // Every rendered row is the packing of [0xAA, 0x55] and nothing else.
    const row = [1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1]
    expect(Array.from(out.bits)).toEqual([...row, ...row, ...row])
  })

  it('at Stride === Width the skipped bytes leak straight in', () => {
    const out = packBitmap(padded, { width: 2, stride: 2, height: 3, invert: false })
    // Row 1 now starts at byte 2 (0xFF) → its first eight pixels are all set.
    expect(Array.from(out.bits.slice(16, 24))).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('the padded framebuffer squares up only at Width 13 / Stride 16', () => {
    const fb = buildFramebuffer()
    const squared = packBitmap(fb, { width: 13, stride: 16, height: 48, invert: false })
    expect([squared.w, squared.h]).toEqual([104, 48])
    // 13 bytes/row read, the 3 pad bytes/row skipped; span 765 ≤ buffer 768.
    expect(squared.bytesRead).toBe(13 * 48)
    expect(squared.bytesMissing).toBe(0)
    const at = (x: number, y: number) => squared.bits[y * squared.w + x]
    // All four borders intact.
    for (let x = 0; x < 104; x++) expect([at(x, 0), at(x, 47)]).toEqual([1, 1])
    for (let y = 0; y < 48; y++) expect([at(0, y), at(103, y)]).toEqual([1, 1])

    // Drop the stride to 13 and the same bytes shear: row 1 begins on a pad
    // byte, so the left border breaks.
    const sheared = packBitmap(fb, { width: 13, stride: 13, height: 48, invert: false })
    expect(sheared.bits[1 * sheared.w + 0]).toBe(0)
  })
})

describe('packBitmap — invert is foreground/background only', () => {
  it('flips every bit value and changes nothing else', () => {
    const fb = buildFramebuffer()
    const params = { width: 13, stride: 16, height: 48, invert: false }
    const plain = packBitmap(fb, params)
    const flipped = packBitmap(fb, { ...params, invert: true })

    expect([flipped.w, flipped.h]).toEqual([plain.w, plain.h])
    expect(flipped.bytesRead).toBe(plain.bytesRead)
    expect(flipped.bytesMissing).toBe(plain.bytesMissing)
    for (let i = 0; i < plain.bits.length; i++) {
      expect(flipped.bits[i]).toBe(1 - plain.bits[i]!)
    }
  })

  it('draws missing bytes as background under invert too', () => {
    // No input at all → every pixel is background, which invert makes 1.
    const out = packBitmap(new Uint8Array(0), { width: 2, stride: 2, height: 2, invert: true })
    expect(Array.from(out.bits)).toEqual(new Array(2 * 8 * 2).fill(1))
  })
})

describe('packBitmap — bytesRead / bytesMissing at and past the end of the input', () => {
  it('a full span reads every visited byte and misses none', () => {
    const span = rowByteSpan({ width: 4, stride: 4, height: 4 }) // 16
    const out = packBitmap(new Uint8Array(span), { width: 4, stride: 4, height: 4, invert: false })
    expect([out.bytesRead, out.bytesMissing]).toEqual([16, 0])
  })

  it('a short input reads what exists and counts the rest missing, rendered background', () => {
    const out = packBitmap(new Uint8Array(10).fill(0xff), {
      width: 4,
      stride: 4,
      height: 4,
      invert: false,
    })
    expect([out.bytesRead, out.bytesMissing]).toEqual([10, 6])
    // Row 3 (source bytes 12–15) is entirely past the end → all background.
    expect(Array.from(out.bits.slice(3 * out.w, 4 * out.w))).toEqual(new Array(out.w).fill(0))
  })

  it('an empty input misses exactly Width·Height bytes — the trailing gap is never visited', () => {
    const out = packBitmap(new Uint8Array(0), { width: 2, stride: 5, height: 3, invert: false })
    expect([out.bytesRead, out.bytesMissing]).toEqual([0, 6])
  })

  it('counts against Width·Height, not the read span, when Stride > Width', () => {
    // span = 5·2 + 2 = 12, but only 6 byte slots are ever visited.
    const out = packBitmap(new Uint8Array(7), { width: 2, stride: 5, height: 3, invert: false })
    expect(out.bytesRead + out.bytesMissing).toBe(6)
    expect([out.bytesRead, out.bytesMissing]).toEqual([4, 2])
  })
})

describe('eofByteSlots — the past-EOF region (plan §4.10, #72)', () => {
  it('is all zeroes when the whole span sits before size', () => {
    const slots = eofByteSlots({ origin: 0, width: 4, stride: 4, height: 4, size: 1000 })
    expect(slots).toHaveLength(16)
    expect(Array.from(slots)).toEqual(new Array(16).fill(0))
  })

  it('is all ones when the Origin is at or past size — the whole canvas is EOF-fill', () => {
    const atEof = eofByteSlots({ origin: 64, width: 4, stride: 4, height: 4, size: 64 })
    expect(Array.from(atEof)).toEqual(new Array(16).fill(1))
    const pastEof = eofByteSlots({ origin: 999, width: 2, stride: 2, height: 3, size: 64 })
    expect(Array.from(pastEof)).toEqual(new Array(6).fill(1))
  })

  it('marks a row that straddles size per-byte: data before, EOF after', () => {
    // size 6, origin 0, width 4, stride 4, height 3 → slot offsets 0..3, 4..7, 8..11.
    const slots = eofByteSlots({ origin: 0, width: 4, stride: 4, height: 3, size: 6 })
    expect(Array.from(slots)).toEqual([
      0, 0, 0, 0, // row 0: offsets 0–3, all before EOF
      0, 0, 1, 1, // row 1: offsets 4,5 before; 6,7 past
      1, 1, 1, 1, // row 2: offsets 8–11, all past
    ])
  })

  it('keys off the real source offset, so Stride > Width shifts the boundary', () => {
    // width 2, stride 5: row r's slots are at origin + 5r + {0,1}; the 3-byte
    // skip-gap holds no slots, so an EOF that falls in a gap changes nothing.
    const slots = eofByteSlots({ origin: 10, width: 2, stride: 5, height: 4, size: 17 })
    expect(Array.from(slots)).toEqual([
      0, 0, // row 0: offsets 10,11
      0, 0, // row 1: offsets 15,16  (12,13,14 are gap, size 17 falls in it)
      1, 1, // row 2: offsets 20,21
      1, 1, // row 3: offsets 25,26
    ])
  })

  it('lines up slot-for-slot with packBitmap’s bytesMissing when the array is the live span', () => {
    // A span read short at EOF: packBitmap counts the tail missing, eofByteSlots
    // marks the same slots — the two passes agree on where the bytes stop.
    const params = { width: 3, stride: 3, height: 4, invert: false }
    const span = rowByteSpan(params) // 12
    const size = 7
    const packed = packBitmap(new Uint8Array(size), params)
    const slots = eofByteSlots({ origin: 0, ...params, size })
    expect(packed.bytesMissing).toBe(span - size) // 5
    expect(Array.from(slots).filter((s) => s === 1)).toHaveLength(span - size)
  })
})

describe('packBitmap — the fog paths are carried but not shipped', () => {
  const bytes = Uint8Array.of(0x81)
  const base = { width: 1, stride: 1, height: 1, invert: false }

  it("bitOrder 'lsb' throws — LSB-first stays in the fog", () => {
    expect(() => packBitmap(bytes, { ...base, bitOrder: 'lsb' })).toThrow(/lsb/i)
  })

  it("order 'col' throws — column-major stays in the fog", () => {
    expect(() => packBitmap(bytes, { ...base, order: 'col' })).toThrow(/col/i)
  })

  it("defaults to 'msb' / 'row' when the params are omitted", () => {
    const implicit = packBitmap(bytes, base)
    const explicit = packBitmap(bytes, { ...base, bitOrder: 'msb', order: 'row' })
    expect(Array.from(implicit.bits)).toEqual(Array.from(explicit.bits))
  })
})

describe('bitmapOffsetAt — a pixel click back to a document byte offset (plan §4.9)', () => {
  const geom = { origin: 1000, width: 4, stride: 4, height: 64 }

  it('maps origin + row·stride + floor(col / 8), pixel coords divided by Zoom', () => {
    // Zoom 1: the top-left pixel is the Origin itself.
    expect(bitmapOffsetAt({ x: 0, y: 0, zoom: 1, ...geom })).toBe(1000)
    // col 8 (the 2nd byte of row 0), still row 0.
    expect(bitmapOffsetAt({ x: 8, y: 0, zoom: 1, ...geom })).toBe(1001)
    // Any pixel within a byte's 8-wide cell resolves to that byte.
    expect(bitmapOffsetAt({ x: 15, y: 0, zoom: 1, ...geom })).toBe(1001)
    // row 3, byte 2 → 1000 + 3·4 + 2.
    expect(bitmapOffsetAt({ x: 20, y: 3, zoom: 1, ...geom })).toBe(1014)
  })

  it('divides the CSS pixel coords by Zoom before the grid math', () => {
    // Zoom 2: a 30 px / 6 px click is intrinsic pixel (15, 3) → row 3, byte 1.
    expect(bitmapOffsetAt({ x: 30, y: 6, zoom: 2, ...geom })).toBe(1000 + 3 * 4 + 1)
  })

  it('honours Stride > Width — rows advance by Stride, not Width', () => {
    const strided = { origin: 0, width: 3, stride: 8, height: 10 }
    // row 2, byte 0 → 0 + 2·8 + 0.
    expect(bitmapOffsetAt({ x: 0, y: 2, zoom: 1, ...strided })).toBe(16)
  })

  it('returns null for a point outside the width·8 × height pixel grid', () => {
    expect(bitmapOffsetAt({ x: -1, y: 0, zoom: 1, ...geom })).toBeNull()
    expect(bitmapOffsetAt({ x: 0, y: -1, zoom: 1, ...geom })).toBeNull()
    expect(bitmapOffsetAt({ x: geom.width * 8, y: 0, zoom: 1, ...geom })).toBeNull() // one past the last column
    expect(bitmapOffsetAt({ x: 0, y: geom.height, zoom: 1, ...geom })).toBeNull() // one past the last row
  })
})
