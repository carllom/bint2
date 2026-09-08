/**
 * Code pages (#56, plan §5): the char column's `byte → glyph` tables. Pure and
 * framework-free — the selection *state* lives in the `preferences` store, but
 * the tables and this lookup are core, and `DomHexRenderer` calls
 * {@link charFor} in place of `toAsciiChar`.
 *
 * The mirror image of byte order (ADR-0007): a code page governs *only* the
 * char column's glyphs and decodes nothing, where byte order governs every
 * numeric decode and never the char column.
 */

import { toAsciiChar } from '../format'
import { CP437 } from './cp437'
import { WINDOWS_1252 } from './windows1252'
import { PETSCII } from './petscii'
import { PETSCII_LOWER } from './petsciiLower'
import { AKAI } from './akai'

/**
 * The six code pages that ship, in `<select>` order: `ascii` first (the default
 * and the familiar one), the two PETSCII rows adjacent (plan §5.1).
 */
export const CODE_PAGES = [
  'ascii',
  'cp437',
  'windows-1252',
  'petscii',
  'petscii-lower',
  'akai',
] as const
export type CodePage = (typeof CODE_PAGES)[number]

/** The one shared glyph a table shows for a byte it does not render (plan §5.2). */
export const PLACEHOLDER_GLYPH = '.'

// The five hand-authored tables. `ascii` is not a table here — it *is*
// `toAsciiChar`, unchanged (plan §5.5), and the live region's renderer too.
const TABLES: Record<Exclude<CodePage, 'ascii'>, readonly string[]> = {
  cp437: CP437,
  'windows-1252': WINDOWS_1252,
  petscii: PETSCII,
  'petscii-lower': PETSCII_LOWER,
  akai: AKAI,
}

/**
 * The glyph `codePage` renders for `byte` (0–255). Strictly one glyph per byte
 * — no multi-byte decoding. A byte a table leaves unmapped comes back as
 * {@link PLACEHOLDER_GLYPH}; CP437 never does, ASCII's own `.` for the
 * control / high-bit range is its table entry, not a fallback.
 */
export function charFor(byte: number, codePage: CodePage): string {
  const value = byte & 0xff
  if (codePage === 'ascii') {
    return toAsciiChar(value)
  }
  return TABLES[codePage][value] ?? PLACEHOLDER_GLYPH
}

export { CP437, WINDOWS_1252, PETSCII, PETSCII_LOWER, AKAI }
