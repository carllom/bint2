/**
 * The renderer seam (ADR-0003, plan §4). The viewer hands {@link
 * HexRowRenderer.render} a batch of rows plus the one Selection and the hovered
 * byte, and never reaches into the grid DOM itself; {@link
 * HexRowRenderer.byteAtPoint} is the only channel back. A canvas renderer can
 * replace {@link DomHexRenderer} behind this interface without touching the data
 * layer.
 *
 * Knowingly **single-range** for phase 1 — one Selection, its collapsed form
 * the Cursor, no Annotation list. Widening it when Annotations arrive is
 * sanctioned in advance (ADR-0003).
 */

/** One grid row. `bytes` is `null` until its read resolves. */
export interface HexRowView {
  readonly offset: number
  readonly bytes: Uint8Array | null
}

/**
 * The one Selection, resolved to what the grid paints: the half-open `[start,
 * end)` byte range to fill and the focus byte the Cursor marker sits on. An
 * **empty range (`start === end`) is the Cursor** — it spans no bytes, so
 * nothing fills, but the marker still lands on `cursor`. Both panes paint from
 * these offsets, never from pixel geometry — the linked highlight is a
 * consequence.
 */
export interface SelectionView {
  /** First byte of the fill range. */
  readonly start: number
  /** One past the last byte of the fill range; `start === end` ⇔ the Cursor. */
  readonly end: number
  /** The focus byte — where the Cursor marker sits, filled range or not. */
  readonly cursor: number
}

export interface HexGridView {
  readonly rows: readonly HexRowView[]
  readonly bytesPerRow: number
  readonly addressWidth: number
  /** The one Selection, or `null` before the reader has pointed at a byte. */
  readonly selection: SelectionView | null
  /**
   * The byte offset the pointer is over, or `null` when it is over no byte.
   * Marked in both panes down the same byte-offset path as {@link selection} —
   * never from pixel geometry — and styled distinctly from the Selection and the
   * Cursor (#30).
   */
  readonly hoveredByte: number | null
}

export interface HexRowRenderer {
  /** Paint `view` into the recycled row pool. Safe to call repeatedly. */
  render(view: HexGridView): void
  /**
   * The byte offset under a point in client coordinates (the space
   * `getBoundingClientRect` reports in), or `null` if the point is not on a
   * rendered byte. It returns a **byte index** — no sub-byte position is
   * representable — and is the renderer's only output.
   */
  byteAtPoint(x: number, y: number): number | null
}
