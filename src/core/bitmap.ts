/**
 * The pure Bitmap packing transform (plan-phase1.75 §4.7, #70), lifted from the
 * validated prototype at `src/core/__prototype__/bitmap-packing.prototype.html`
 * on branch `prototype/bitmap-packing`. No DOM, no store, no Vue — colour and
 * `Zoom` upscale live one level up in the Bitmap Panel.
 *
 * `packBitmap` is **pure**: it packs whatever `bytes` it is handed. Bytes past
 * the end of the array are drawn as background bits and counted in
 * `bytesMissing` — the function is EOF- and residency-agnostic, with no
 * knowledge of `size` and no read path. The `null`-tracks-Width and
 * bidirectional-Stride behaviour is the Bitmap component's Width/Stride state,
 * not here.
 *
 * Only the shipped `'msb'` + `'row'` paths are implemented. `bitOrder: 'lsb'`
 * and `order: 'col'` are carried in the signature but stay in the fog (§9); they
 * throw. Both were made concrete in the #70 prototype and graduate as their own
 * ticket if an LSB-first or column-packed dump ever turns up.
 *
 * Unit-tested in `__tests__/bitmap.spec.ts` against the prototype fixtures.
 */

/** Which bit of a byte maps to the first pixel. `'msb'` ships; `'lsb'` is fog. */
export type BitOrder = 'msb' | 'lsb'

/** Byte layout. `'row'` (row-major) ships; `'col'` (column-major) is fog. */
export type PackOrder = 'row' | 'col'

export interface RowByteSpanParams {
  /** Bytes drawn per row, each contributing eight pixels. */
  width: number
  /** Bytes advanced from one row's Origin to the next; `>= width`. */
  stride: number
  /** Rows. */
  height: number
}

export interface EofByteSlotsParams extends RowByteSpanParams {
  /** The document byte offset the top-left byte-slot maps to (the Origin). */
  origin: number
  /** The document size in bytes. A slot at or past this is past EOF. */
  size: number
}

export interface BitmapOffsetAtParams extends RowByteSpanParams {
  /** Canvas-relative x in CSS px — `event.clientX - canvas.getBoundingClientRect().left`. */
  x: number
  /** Canvas-relative y in CSS px — `event.clientY - canvas.getBoundingClientRect().top`. */
  y: number
  /** Integer upscale the canvas is drawn at; pixel coords are divided by it. */
  zoom: number
  /** The document byte offset the top-left pixel maps to (the Origin). */
  origin: number
}

export interface PackBitmapParams extends RowByteSpanParams {
  /** Swap foreground / background bit values only — no geometry change. */
  invert: boolean
  /** Which bit is the first pixel. Default `'msb'` (the shipped path). */
  bitOrder?: BitOrder
  /** Byte layout. Default `'row'` (the shipped path). */
  order?: PackOrder
}

export interface PackedBitmap {
  /** One entry per pixel, `0` (background) or `1` (foreground), row-major. */
  bits: Uint8Array
  /** Image width in pixels — `width * 8` for row-major. */
  w: number
  /** Image height in pixels — `height` for row-major. */
  h: number
  /** Bytes actually consumed from `bytes` (`<= width * height`). */
  bytesRead: number
  /** Byte slots past the end of `bytes`, drawn as background (`<= width * height`). */
  bytesMissing: number
}

/**
 * Bytes a render needs, counting from the Origin: every row but the last
 * consumes a full Stride; the last consumes only Width (#66).
 */
export function rowByteSpan({ width, stride, height }: RowByteSpanParams): number {
  return stride * (height - 1) + width
}

/**
 * The byte-slots of a `width × height` frame whose source offset lands **at or
 * past `size`** — the past-EOF region the Bitmap Panel paints as a muted,
 * `invert`-independent fill (plan-phase1.75 §4.10, #72). Pure geometry, the
 * mirror of `packBitmap`'s own slot walk: slot `(row, bx)` reads source offset
 * `origin + row·stride + bx`, and the trailing `stride − width` bytes of each
 * row are skip-gap, never a slot — so EOF inside a gap is not represented here.
 *
 * Returns a row-major `Uint8Array` of length `width · height`: `1` where the
 * slot is past EOF, `0` before it. `origin >= size` ⇒ every slot `1` (the whole
 * canvas is EOF-fill, the "nudged off the end" state); a span wholly before
 * `size` ⇒ every slot `0`.
 *
 * `packBitmap` stays EOF-agnostic (§4.7): this is the separate, size-aware pass.
 */
export function eofByteSlots({ origin, width, stride, height, size }: EofByteSlotsParams): Uint8Array {
  const slots = new Uint8Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let bx = 0; bx < width; bx++) {
      if (origin + row * stride + bx >= size) {
        slots[row * width + bx] = 1
      }
    }
  }
  return slots
}

/**
 * The document byte offset a Bitmap pixel click lands on (plan-phase1.75 §4.9,
 * #71): `origin + row·stride + floor(col / 8)`, where `row` / `col` are the
 * canvas-relative CSS pixel coords divided by `zoom`. Pure geometry — the
 * mirror of `packBitmap`'s slot walk. The trailing `stride − width` bytes of a
 * row are skip-gap and never receive pixels, so a `col` always lands inside the
 * `width·8` painted span.
 *
 * Returns `null` when the point is outside the `width·8 × height` pixel grid
 * (a click in the scroll-box margin past the image). EOF and residency are the
 * caller's to check — this function has no `size` and no read path.
 */
export function bitmapOffsetAt({ x, y, zoom, origin, width, stride, height }: BitmapOffsetAtParams): number | null {
  const col = Math.floor(x / zoom)
  const row = Math.floor(y / zoom)
  if (col < 0 || row < 0 || col >= width * 8 || row >= height) {
    return null
  }
  return origin + row * stride + Math.floor(col / 8)
}

/**
 * Pack a byte run into a 1-bit-per-pixel buffer.
 *
 * `bytes` starts **at** the Origin — the caller slices. For each row, the
 * leading `width` bytes are packed and the trailing `stride − width` bytes are
 * skipped; a source index past `bytes.length` contributes a background bit and
 * increments `bytesMissing`. MSB-first means bit 7 of each byte is its leftmost
 * pixel; `invert` flips the `0` / `1` bit values and nothing else.
 */
export function packBitmap(bytes: Uint8Array, p: PackBitmapParams): PackedBitmap {
  const { width, stride, height, invert } = p
  const bitOrder = p.bitOrder ?? 'msb'
  const order = p.order ?? 'row'

  if (bitOrder !== 'msb') {
    throw new Error(`packBitmap: bitOrder '${bitOrder}' is not shipped (LSB-first stays in the fog, §9)`)
  }
  if (order !== 'row') {
    throw new Error(`packBitmap: order '${order}' is not shipped (column-major stays in the fog, §9)`)
  }

  const bg = invert ? 1 : 0
  const fg = invert ? 0 : 1

  const w = width * 8
  const bits = new Uint8Array(w * height)

  let bytesRead = 0
  let bytesMissing = 0

  for (let row = 0; row < height; row++) {
    for (let bx = 0; bx < width; bx++) {
      const si = row * stride + bx
      let byte: number
      if (si < bytes.length) {
        byte = bytes[si]!
        bytesRead++
      } else {
        byte = 0
        bytesMissing++
      }
      const rowBase = row * w + bx * 8
      for (let b = 0; b < 8; b++) {
        // MSB-first: bit 7 is the leftmost pixel, bit 0 the rightmost.
        bits[rowBase + (7 - b)] = ((byte >> b) & 1) === 1 ? fg : bg
      }
    }
  }

  return { bits, w, h: height, bytesRead, bytesMissing }
}
