/**
 * Find Next/Previous (#103, ADR-0013, plan §3.3): stepping through a cached,
 * ascending match-offset array rather than re-dispatching a `'search'` job on
 * every keypress. `SearchParams` (`DerivedWork.ts`) carries only a pattern —
 * no "from offset", no direction — so a `'search'` job always answers for the
 * whole file at once; the Find box runs the job once per term and walks the
 * result locally from here, which is also why Find Next/Previous cost nothing
 * once the first result for a term has landed.
 *
 * Also home to the two pure pieces text mode and Selection scoping add
 * (#105, ticket #97's resolution): {@link parseTextPattern}, converting a
 * typed term to bytes via a Code page's reverse table, and
 * {@link scopeMatches}, filtering a whole-file match array down to a
 * captured range. Both stay here rather than growing `format.ts` — that
 * module is imported by `src/core/codepages`, so importing the reverse
 * table back from there would cycle.
 */

import { buildReverseTable } from './codepages'
import type { CodePage } from './codepages'

export type SearchDirection = 'next' | 'previous'

export interface MatchStep {
  readonly offset: number
  readonly wrapped: boolean
}

/**
 * The match `direction` reaches from `from` (the Cursor), strictly past it in
 * that direction so pressing the same key again always advances rather than
 * re-landing on a match already under the Cursor. Wrapping past either end is
 * silent here — `wrapped: true` — the caller turns that into the shared
 * status message (plan §3.3); `null` only when `matches` is empty ("No match
 * found"), a case the caller never confuses with a wrap.
 */
export function stepMatch(
  matches: Float64Array,
  from: number,
  direction: SearchDirection,
): MatchStep | null {
  if (matches.length === 0) {
    return null
  }
  if (direction === 'next') {
    for (let i = 0; i < matches.length; i++) {
      if (matches[i]! > from) {
        return { offset: matches[i]!, wrapped: false }
      }
    }
    return { offset: matches[0]!, wrapped: true }
  }
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i]! < from) {
      return { offset: matches[i]!, wrapped: false }
    }
  }
  return { offset: matches[matches.length - 1]!, wrapped: true }
}

/**
 * Text mode's term → byte pattern (#105), the counterpart to `parseHexPattern`
 * (`format.ts`) for the other input mode. Every character must resolve
 * through `codePage`'s reverse table ({@link buildReverseTable}) — one typed
 * character the table can't place unambiguously (a duplicated glyph, or one
 * that only ever renders the placeholder) makes the whole term invalid,
 * `null`, the same "no best-effort partial parse" rule `parseHexPattern`
 * follows. An empty term is invalid for the same reason it is in hex mode —
 * nothing to search for.
 */
export function parseTextPattern(text: string, codePage: CodePage): Uint8Array | null {
  if (text.length === 0) {
    return null
  }
  const table = buildReverseTable(codePage)
  const bytes: number[] = []
  for (const char of text) {
    const byte = table.get(char)
    if (byte === undefined) {
      return null
    }
    bytes.push(byte)
  }
  return Uint8Array.from(bytes)
}

/** A half-open byte range, as {@link scopeMatches} filters against. */
export interface MatchScopeRange {
  readonly start: number
  readonly end: number
}

/**
 * Selection scoping's capture-once filter (#105, plan §3.4): `matches` is
 * always the *whole-file* result a `'search'` job answered with — scoping
 * never reaches the worker (ADR-0013's protocol carries no range for
 * `'search'`) — so "search only the Selection" is this: narrow the cached,
 * ascending array to the range captured at the moment scope was toggled on,
 * before `stepMatch` walks it. `range: null` (whole-file scope) is a pass-
 * through so the Find box never special-cases the two scopes beyond calling
 * this once. The input's ascending order is preserved.
 */
export function scopeMatches(matches: Float64Array, range: MatchScopeRange | null): Float64Array {
  if (range === null) {
    return matches
  }
  const scoped: number[] = []
  for (let i = 0; i < matches.length; i++) {
    const offset = matches[i]!
    if (offset >= range.start && offset < range.end) {
      scoped.push(offset)
    }
  }
  return Float64Array.from(scoped)
}
