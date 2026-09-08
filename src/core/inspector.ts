/**
 * The Inspector's pure decode (#54, plan §3). Given the bytes at the Cursor and
 * the two panel-wide toggles — byte order (#55) and the `hex` integer format
 * (#54, plan §3.3) — turn each primitive numeric type into its displayed
 * string. No DOM, no store; the empty states (`—` with no Cursor / near EOF,
 * `··` while bytes are not yet resident) belong to the Panel, which only calls
 * in here once it has `row.width` bytes in hand.
 *
 * Table-tested in `__tests__/inspector.spec.ts`.
 */

import { toBinary, toHex, toSignedByte } from './format'

/** How a row reads its bytes — drives both the decode and the label wording. */
export type InspectorRowKind = 'uint' | 'int' | 'bin' | 'float'

export interface InspectorRow {
  /** Stable key and terse visible label — `u8`, `i16`, `bin`, `f64`. */
  readonly key: string
  /** Full `aria-label` / `title` — "unsigned 16-bit integer". */
  readonly ariaLabel: string
  readonly kind: InspectorRowKind
  /** Bytes the decode consumes: 1, 2, 4 or 8. */
  readonly width: 1 | 2 | 4 | 8
  /** 1-based group index; a hairline is drawn where it changes (plan §3.2). */
  readonly group: number
}

/**
 * The fixed row list, top to bottom (plan §3.2). All visible in v1 — per-row
 * hide waits for the preferences page (plan §10). No `f16`, no text line.
 */
export const INSPECTOR_ROWS: readonly InspectorRow[] = [
  { key: 'u8', ariaLabel: 'unsigned 8-bit integer', kind: 'uint', width: 1, group: 1 },
  { key: 'i8', ariaLabel: 'signed 8-bit integer', kind: 'int', width: 1, group: 1 },
  { key: 'bin', ariaLabel: '8 binary digits', kind: 'bin', width: 1, group: 1 },
  { key: 'u16', ariaLabel: 'unsigned 16-bit integer', kind: 'uint', width: 2, group: 2 },
  { key: 'i16', ariaLabel: 'signed 16-bit integer', kind: 'int', width: 2, group: 2 },
  { key: 'u32', ariaLabel: 'unsigned 32-bit integer', kind: 'uint', width: 4, group: 3 },
  { key: 'i32', ariaLabel: 'signed 32-bit integer', kind: 'int', width: 4, group: 3 },
  { key: 'u64', ariaLabel: 'unsigned 64-bit integer', kind: 'uint', width: 8, group: 4 },
  { key: 'i64', ariaLabel: 'signed 64-bit integer', kind: 'int', width: 8, group: 4 },
  { key: 'f32', ariaLabel: '32-bit float', kind: 'float', width: 4, group: 5 },
  { key: 'f64', ariaLabel: '64-bit float', kind: 'float', width: 8, group: 5 },
] as const

/** Widest byte run any row needs — the Panel reads exactly this at the Cursor. */
export const INSPECTOR_READ_LENGTH = 8

export interface DecodeOptions {
  /** Little- or big-endian (#55). Structurally the `preferences` store's `ByteOrder`. */
  readonly byteOrder: 'le' | 'be'
  /** The panel-wide `hex` toggle — integer rows only (plan §3.3). */
  readonly intHex: boolean
}

/**
 * Bigint hex, uppercase, left-padded to at least `width` — the `BigInt` mirror
 * of {@link toHex}: `width` is a minimum, never a mask.
 */
function toBigHex(value: bigint, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

/**
 * Decode one row from `bytes` (which the caller guarantees is at least
 * `row.width` long, taken at the Cursor).
 *
 * - Integers are decimal by default; the `hex` toggle shows the **raw N-byte
 *   pattern, unsigned**, zero-padded to the type width, so a signed row in hex
 *   is byte-identical to its unsigned sibling (plan §3.3).
 * - `bin` is always 8 binary digits — unaffected by `hex` **and** by byte order.
 * - Floats use `String(value)` — shortest round-trip, `NaN` / `Infinity` /
 *   `-Infinity` shown literally.
 * - `u64` / `i64` go through `BigInt`.
 */
export function decodeInspectorRow(
  row: InspectorRow,
  bytes: Uint8Array,
  { byteOrder, intHex }: DecodeOptions,
): string {
  const le = byteOrder === 'le'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  switch (row.key) {
    case 'bin':
      return toBinary(bytes[0]!)
    case 'u8':
      return intHex ? toHex(bytes[0]!, 2) : String(bytes[0]!)
    case 'i8':
      return intHex ? toHex(bytes[0]!, 2) : String(toSignedByte(bytes[0]!))
    case 'u16':
      return intHex ? toHex(view.getUint16(0, le), 4) : String(view.getUint16(0, le))
    case 'i16':
      return intHex ? toHex(view.getUint16(0, le), 4) : String(view.getInt16(0, le))
    case 'u32':
      return intHex ? toHex(view.getUint32(0, le), 8) : String(view.getUint32(0, le))
    case 'i32':
      return intHex ? toHex(view.getUint32(0, le), 8) : String(view.getInt32(0, le))
    case 'u64':
      return intHex ? toBigHex(view.getBigUint64(0, le), 16) : view.getBigUint64(0, le).toString()
    case 'i64':
      return intHex ? toBigHex(view.getBigUint64(0, le), 16) : view.getBigInt64(0, le).toString()
    case 'f32':
      return String(view.getFloat32(0, le))
    case 'f64':
      return String(view.getFloat64(0, le))
    default:
      return ''
  }
}
