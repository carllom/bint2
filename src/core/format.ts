/**
 * Pure byte / offset formatting for the hex grid (plan §5). No masking, no
 * state, no DOM — table-tested in `__tests__/format.spec.ts`.
 */

import type { Selection } from './selection'
import { isCollapsed, rangeOf } from './selection'

/**
 * Uppercase hex, left-padded with `0` to at least `width` characters.
 *
 * Deliberately does **not** mask to a byte: `width` is a minimum, never a
 * ceiling, so the same function serves a phase-1.5 `u32` unchanged. Pinned by a
 * table row — `toHex(0xdeadbeef, 8) === 'DEADBEEF'` — with no observable
 * phase-1 effect.
 */
export function toHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

/** Uppercase hex offset, left-padded to `width` (see {@link addressWidthFor}). */
export function toAddress(offset: number, width = 8): string {
  return toHex(offset, width)
}

/**
 * Hex-digit width the address gutter needs for a document of `size` bytes:
 * enough for the largest offset (`size - 1`), a minimum of 8, rounded up to an
 * even number so the gutter widens to 10 then 12 as the file grows past 4 GiB.
 */
export function addressWidthFor(size: number): number {
  const maxOffset = Math.max(0, size - 1)
  const digits = maxOffset.toString(16).length
  return Math.max(8, digits + (digits % 2))
}

/** `0x20`–`0x7E` verbatim; every other byte (control, high-bit) renders as `.`. */
export function toAsciiChar(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'
}

/**
 * A run of bytes as a copyable hex string (#25): one uppercase pair per byte,
 * space-separated. The separator is deliberate — a spaced pair string is what
 * `bytes.fromhex`, CyberChef's "From Hex", `xxd -r -p` and a hex editor's
 * paste-as-hex all accept — and the Selection's copy goes to the clipboard in
 * exactly this shape. Empty in, empty out.
 *
 * Built in fixed-size chunks rather than a per-byte `string[]`: the copy runs at
 * up to the 8 MiB cap, and a whole-Selection intermediate array would be a
 * transient spike far larger than the byte tool's whole memory budget.
 */
export function toHexString(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return ''
  }
  const chunks: string[] = []
  let chunk = toHex(bytes[0]!)
  for (let i = 1; i < bytes.length; i++) {
    chunk += ' ' + toHex(bytes[i]!)
    if (chunk.length >= 8192) {
      chunks.push(chunk)
      chunk = ''
    }
  }
  chunks.push(chunk)
  return chunks.join('')
}

/**
 * Binary digits, left-padded with `0` to at least `width` characters. Mirrors
 * {@link toHex}: `width` is a minimum and never a mask, so `toBinary(0x100)`
 * keeps its ninth digit. The status bar's `bin` field for the byte under the
 * Cursor.
 */
export function toBinary(value: number, width = 8): string {
  return value.toString(2).padStart(width, '0')
}

/**
 * A byte read as a signed 8-bit two's-complement integer: `0x80`–`0xFF` map to
 * `-128`–`-1`, everything below is itself. The status bar's `i8` field.
 */
export function toSignedByte(byte: number): number {
  return byte >= 0x80 ? byte - 0x100 : byte
}

/**
 * Parse a reader-typed Goto offset (#24): a `0x`-prefixed hex value **or** a
 * plain decimal one, with `_` and `,` tolerated as digit separators (the status
 * bar prints the decimal offset with commas, so a paste of it round-trips).
 * Bare hex without the `0x` prefix is ambiguous and rejected; so is anything
 * signed or fractional. Returns a non-negative number, or `null` when the text
 * is neither form. Clamping an out-of-range result to the open document needs
 * the file size and is the caller's job, not this one's.
 */
export function parseOffset(text: string): number | null {
  const cleaned = text.trim().replace(/[_,]/g, '')
  let value = NaN
  if (/^0[xX][0-9a-fA-F]+$/.test(cleaned)) {
    value = parseInt(cleaned.slice(2), 16)
  } else if (/^[0-9]+$/.test(cleaned)) {
    value = parseInt(cleaned, 10)
  }
  return Number.isFinite(value) ? value : null
}

/**
 * A human-readable size for the status bar's document identity — binary units
 * (KiB/MiB/GiB…), since this is a byte-exact tool. Under 1 KiB stays an exact
 * byte count; at or above it, one decimal place. The precise byte count is shown
 * alongside this, not replaced by it.
 */
export function toByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/**
 * `toByteSize` plus the exact count beside it, "1.9 GiB (2,000,000,000
 * bytes)" — the shared form the status bar's document identity, the
 * Viewport's `aria-label` (#27), and the copy-cap refusal message (#25) all
 * show, so a wording change is made once rather than in three call sites.
 */
export function toByteSizeDetail(bytes: number): string {
  return `${toByteSize(bytes)} (${bytes.toLocaleString()} bytes)`
}

/**
 * The Viewport's cursor live region (#27, ADR-0005): the one sentence spoken
 * for the Selection, chosen by whether it is collapsed — there is one concept
 * here (ADR-0003), so this never invents a second. Collapsed →
 * `"offset 0x1F40, byte 4D, 'M'"`; extended → `"selection 0x1F40 to 0x1F4F, 16
 * bytes"` (the second address is the last byte in the range, not the half-open
 * end). `byte` is the value at the Cursor, or `null` while its point read is
 * still in flight — the announcement is withheld rather than speaking a
 * placeholder, since a stale ".." read out loud is worse than a beat of
 * silence.
 */
export function describeSelection(selection: Selection, byte: number | null): string | null {
  if (isCollapsed(selection)) {
    if (byte === null) {
      return null
    }
    return `offset 0x${toHex(selection.focus)}, byte ${toHex(byte)}, '${toAsciiChar(byte)}'`
  }
  const { start, end } = rangeOf(selection)
  return `selection 0x${toHex(start)} to 0x${toHex(end - 1)}, ${end - start} bytes`
}
