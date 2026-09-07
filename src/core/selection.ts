/**
 * The Selection model (CONTEXT.md, ADR-0003). There is **one** concept here, not
 * two: the Selection is a single range held as `{ anchor, focus }` byte offsets
 * with direction preserved, from which a half-open `[start, end)` derives. When
 * `anchor === focus` the range spans no bytes and *is* the Cursor — there is no
 * separate cursor state.
 *
 * Pure and framework-free. Offsets are **byte indices**, never pixels, so no
 * sub-byte position is representable anywhere in the model. Clamping to a real
 * byte needs the document size and lives in the store, not here.
 * `src/core/__tests__/selection.spec.ts` pins the derivations and the
 * direction-preserving extend.
 */

export interface Selection {
  /** The end that stays put under extension — where the range was anchored. */
  readonly anchor: number
  /** The end Shift+click, drag and Shift+arrows move. */
  readonly focus: number
}

export interface SelectionRange {
  /** First byte in the range. */
  readonly start: number
  /** One past the last byte — `[start, end)` is half-open. */
  readonly end: number
}

/** The Cursor: a Selection collapsed onto `offset`, spanning no bytes. */
export function cursorAt(offset: number): Selection {
  return { anchor: offset, focus: offset }
}

/**
 * Move the focus to `offset`, keeping the anchor. A backwards Selection stays
 * backwards; crossing the anchor flips the direction in one step.
 */
export function extendTo(selection: Selection, offset: number): Selection {
  return { anchor: selection.anchor, focus: offset }
}

/** `start = min(anchor, focus)`, `end = max(anchor, focus) + 1`. */
export function rangeOf(selection: Selection): SelectionRange {
  return {
    start: Math.min(selection.anchor, selection.focus),
    end: Math.max(selection.anchor, selection.focus) + 1,
  }
}

/** `anchor === focus` — the range spans no bytes and is the Cursor. */
export function isCollapsed(selection: Selection): boolean {
  return selection.anchor === selection.focus
}
