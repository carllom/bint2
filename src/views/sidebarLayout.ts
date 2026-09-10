// Pure layout arithmetic for the phase-1.75 shell split (plan-phase1.75.md §3.2,
// ADR-0010). Kept out of the `.vue` file so it can be unit-tested on its own,
// and out of `src/core` because it is app-shell chrome, not domain
// (CONTEXT.md) — no framework, no store, just numbers.

/** The Sidebar's own minimum width in CSS px — its floor at every window size. */
export const SIDEBAR_MIN_PX = 200

/** Double-clicking the splitter handle resets the Sidebar to this width (plan §3.2). */
export const DEFAULT_SIDEBAR_WIDTH = 320

/**
 * CSS px width of one `ch` in the shell monospace at `--font-size: 13px`
 * (a typical mono metric, ~0.6 em). The grid minimum only bounds a drag handle,
 * so this fixed approximation is enough — no probe measurement is wired.
 */
export const APPROX_CH_PX = 7.8

/**
 * The hex grid's minimum comfortable width in `ch`, recomputed from the current
 * `bytesPerRow` (plan §3.2): the offset gutter (8) + the two row gaps (2·2) +
 * the hex column (two `ch` per byte, one `ch` between → `3·bpr − 1`) + the char
 * column (one `ch` per byte) + the grid's own horizontal padding (2). Anchored
 * to the phase-1.5 `141ch` figure at 32 bytes per row.
 */
export function gridMinCh(bytesPerRow: number): number {
  return 8 + 2 * 2 + (3 * bytesPerRow - 1) + bytesPerRow + 2
}

/** {@link gridMinCh} in CSS px, rounded up. */
export function gridMinPx(bytesPerRow: number): number {
  return Math.ceil(gridMinCh(bytesPerRow) * APPROX_CH_PX)
}

/**
 * The Sidebar splitter panel's dynamic `max-size` (plan §3.2): the container
 * width less the grid's current minimum, so the handle can never drag the grid
 * below that minimum — but never less than the Sidebar's own 200 px floor (a
 * window narrower than `gridMin + 200` makes the grid yield instead, clipping
 * under `overflow: hidden`).
 */
export function sidebarMaxSize(containerWidth: number, bytesPerRow: number): number {
  return Math.max(SIDEBAR_MIN_PX, containerWidth - gridMinPx(bytesPerRow))
}
