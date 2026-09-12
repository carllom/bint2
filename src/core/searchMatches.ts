/**
 * Find Next/Previous (#103, ADR-0013, plan §3.3): stepping through a cached,
 * ascending match-offset array rather than re-dispatching a `'search'` job on
 * every keypress. `SearchParams` (`DerivedWork.ts`) carries only a pattern —
 * no "from offset", no direction — so a `'search'` job always answers for the
 * whole file at once; the Find box runs the job once per term and walks the
 * result locally from here, which is also why Find Next/Previous cost nothing
 * once the first result for a term has landed.
 */

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
