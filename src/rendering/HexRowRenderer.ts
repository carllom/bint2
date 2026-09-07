/**
 * The renderer seam (ADR-0003, plan §4). The viewer hands {@link
 * HexRowRenderer.render} a batch of rows and never reaches into the grid DOM
 * itself; {@link HexRowRenderer.byteAtPoint} is the only channel back. A canvas
 * renderer can replace {@link DomHexRenderer} behind this interface without
 * touching the data layer.
 *
 * Knowingly single-purpose for phase 1 — no selection, no cursor, no annotation
 * list. Widening it when those arrive is sanctioned in advance (ADR-0003).
 */

/** One grid row. `bytes` is `null` until its read resolves. */
export interface HexRowView {
  readonly offset: number
  readonly bytes: Uint8Array | null
}

export interface HexGridView {
  readonly rows: readonly HexRowView[]
  readonly bytesPerRow: number
  readonly addressWidth: number
}

export interface HexRowRenderer {
  /** Paint `view` into the recycled row pool. Safe to call repeatedly. */
  render(view: HexGridView): void
  /**
   * The byte offset under a viewport-relative point, or `null` if the point is
   * not on a rendered byte. The renderer's only output.
   */
  byteAtPoint(x: number, y: number): number | null
}
