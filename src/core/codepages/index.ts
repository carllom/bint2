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

/**
 * The glyph→byte inverse of {@link charFor}, for text-mode search (#105,
 * ticket #97's resolution). Restricted to **real, injective** entries: a
 * glyph qualifies only when exactly one byte (0–255) renders it, so a typed
 * character always resolves to one unambiguous source byte, never a guess
 * among several. Two kinds of byte are excluded on principle, not just by
 * counting to more than one:
 *
 * - Any byte whose glyph is {@link PLACEHOLDER_GLYPH} — even a codepage
 *   design that only ever produces it from one specific byte (AKAI's genuine
 *   `.` at 0x28, CP437's genuine `.` at 0x2E, both of which happen to share
 *   the placeholder's own character) stays out, so a typed `.` never risks
 *   resolving to whichever codepage-specific byte happens to be "the real
 *   one" this session — hex mode is the path for those bytes instead.
 * - A glyph duplicated across distinct real bytes (PETSCII's 0xC0–0xDF
 *   repeating 0x60–0x7F) — non-typeable anyway, since the reader can only
 *   type the glyph, never which byte they meant.
 *
 * Every codepage's table is static, so the result is cached per `codePage`
 * (there are only six, ever): `parseTextPattern` calls this from a Vue
 * `computed` that re-evaluates on every keystroke in text mode, and rebuilding
 * two 256-entry `Map`s per keystroke would be pure waste.
 */
const reverseTableCache = new Map<CodePage, ReadonlyMap<string, number>>()

export function buildReverseTable(codePage: CodePage): ReadonlyMap<string, number> {
  const cached = reverseTableCache.get(codePage)
  if (cached) {
    return cached
  }
  const bytesFor = new Map<string, number[]>()
  for (let byte = 0; byte <= 0xff; byte++) {
    const glyph = charFor(byte, codePage)
    const bytes = bytesFor.get(glyph)
    if (bytes) {
      bytes.push(byte)
    } else {
      bytesFor.set(glyph, [byte])
    }
  }
  const table = new Map<string, number>()
  for (const [glyph, bytes] of bytesFor) {
    if (bytes.length === 1 && glyph !== PLACEHOLDER_GLYPH) {
      table.set(glyph, bytes[0]!)
    }
  }
  reverseTableCache.set(codePage, table)
  return table
}

export { CP437, WINDOWS_1252, PETSCII, PETSCII_LOWER, AKAI }
