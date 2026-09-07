/**
 * Pure byte / offset formatting for the hex grid (plan §5). No masking, no
 * state, no DOM — table-tested in `__tests__/format.spec.ts`.
 */

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
