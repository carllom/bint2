# topByteOffset is the only coordinate; the viewport surface is frozen

`docs/plan-phase1.md` §3/§11 sketched a custom row-space `VirtualScrollbar` with
`topByteOffset` (an integer multiple of `bytesPerRow`) as the source of truth,
noted the thumb drag would be "inherently coarse" at ~100 k rows/px, and floated
a two-level "zoom" scrollbar in §12 as a way to make fine movement possible from
the scrollbar itself. It listed `viewport.ts`'s pure-function surface but did not
freeze it, and left `bytesPerRow`-change offset handling underspecified.
[#8](https://github.com/carllom/bint2/issues/8) drove a throwaway prototype
(branch `prototype/viewport-scrollbar-model`) through eight guided walkthroughs
at 700 MB / 2 GB / 8 GB / `MAX_SAFE_INTEGER` scale to settle the shape. This ADR
is the coordinate-model record the map left owed at M0.

**Decision:** `topByteOffset` is the sole coordinate; the pure viewport surface
is frozen; thumb drag is gross-only; there is no two-level zoom scrollbar in
phase 1; and changing `bytesPerRow` preserves the byte offset, not the row
index, with the resulting downward ratchet accepted.

## `topByteOffset` is the only source of truth

An integer, always a multiple of `bytesPerRow`, always clamped to
`[0, maxFirstRow * bytesPerRow]`. `firstRow` is derived
(`topByteOffset / bytesPerRow`) and never stored. Every navigation action —
wheel, `PageUp`/`PageDown`, `Home`/`End`, `Ctrl+Home`/`Ctrl+End`, Goto, thumb
drag — produces a candidate offset and funnels it through the one choke point,
`clampTopOffset`, which aligns the candidate **down** to a row boundary and then
clamps. There is no second representation to keep in sync: no `firstRow` state,
no pixel `scrollTop`, no fractional scroll position.

This is what makes a custom scrollbar the only viable one. The row counts in play
(a 700 MB file at 16 bpr is ~44 M rows; 2 GB is ~128 M) are past every engine's
maximum element height — Firefox caps layout at ~17.9 M px and *zeroes* the
scroll range beyond it rather than clamping, Chrome and Safari cap at ~33.5 M px
— so a full-height spacer scrolled natively is not an option at any size the tool
targets, and a hybrid that switched modes at a threshold would be two code paths
and a discontinuity for no gain. A row-space thumb driven off `topByteOffset`
sidesteps the pixel ceiling entirely. The custom-vs-hybrid question itself was
already closed by [#2](https://github.com/carllom/bint2/issues/2); [#8] did not
reopen it.

## The frozen pure surface

`viewport.ts` is pure functions over a `ViewportMetrics` input and nothing else —
no state, no Vue, no DOM. Frozen as of [#8]:

```ts
// Every byte quantity may exceed 2^32; all intermediate products stay below 2^53.
interface ViewportMetrics {
  size: number          // file size in bytes
  bytesPerRow: number   // 8 | 16 | 24 | 32
  viewportPx: number    // usable row-area height, CSS px
  rowPx: number         // rendered row height, CSS px — an input, see below
  trackPx: number       // scrollbar track height, CSS px
  minThumbPx: number    // thumb-height floor (grab target); default 24, pinned by a test
}

rowOfOffset(offset, bytesPerRow)     // Math.floor(offset / bytesPerRow)
offsetOfRow(row, bytesPerRow)        // row * bytesPerRow
rowCount(m)                          // Math.ceil(size / bytesPerRow)
visibleRows(m)                       // Math.max(1, Math.floor(viewportPx / rowPx))
maxFirstRow(m)                       // Math.max(0, rowCount - visibleRows)

// The single choke point: align an arbitrary byte offset DOWN to a row
// boundary, then clamp to [0, maxFirstRow * bytesPerRow].
clampTopOffset(offset, m)

// thumbH clamps to [minThumbPx, trackPx] (the exact fraction is sub-pixel past
// a few hundred MB). thumbY is computed divide-before-multiply —
// round(travel * (firstRow / maxFirstRow)) — so travel * firstRow never
// exceeds 2^53. travel = trackPx - thumbH.
thumbGeometry(topByteOffset, m)      // -> { thumbH, thumbY, travel }

// Inverse of thumbGeometry under clamp:
// frac = clamp(thumbTopPx / travel, 0, 1); firstRow = round(frac * maxFirstRow);
// then clampTopOffset.
offsetFromThumbPixel(thumbTopPx, m)  // -> aligned, clamped topByteOffset
```

- **`clampTopOffset` is the single navigation choke point.** Actions
  (`scrollByRows`, `pageBy`, `gotoOffset`, thumb drag) are one-line compositions
  over it and `offsetFromThumbPixel`, and they live in the store / a composable,
  **not** in `viewport.ts`. The pure module has no notion of "an action".
- **`thumbGeometry` and `offsetFromThumbPixel` stay inverses under clamp.** The
  prototype verified this in the min-thumb regime (8 GB): `thumbH` clamps to
  `minThumbPx`, `travel = trackPx - minThumbPx`, `Ctrl+End` puts `thumbY` at
  `travel` and `Ctrl+Home` at 0. This settles the old §12 "min thumb size vs.
  exact fraction" bullet.
- **All math is written for `size > 2^32`.** A `MAX_SAFE_INTEGER` overflow probe
  is a required test: at `size = 2^53 - 1`, `thumbY` stays finite, non-NaN and
  within `[0, travel]`, and `firstRow` is exact — the divide-before-multiply form
  in `thumbGeometry` is what keeps it so.

**Row height is an input, not a constant.** `rowPx` is measured from a rendered
probe glyph and re-measured on resize and browser zoom, then passed in via
`ViewportMetrics`. Zoom and OS font scaling therefore cost nothing and never
touch this surface — the same property
[ADR-0005](./0005-the-byte-grid-is-not-a-document.md) relies on for its
zoom/contrast commitments.

## Thumb drag is gross-only; no zoom scrollbar

At 2 GB / 16 bpr the thumb covers ~215 k rows (~3.4 MB) per pixel of travel
(~75 k rows/px at 700 MB). It cannot land on a chosen offset by physics, so its
only job is gross positioning — and that is accepted rather than worked around.

The fine-movement path is **wheel (row granularity) + keyboard + Goto**. In the
prototype that pairing was sufficient: drag-to-approximate then wheel/arrow to
exact felt fine (scenario D), and Goto — a single absolute jump — beat several
drag/re-centre cycles of a candidate zoom band (scenario H). The two-level "zoom"
scrollbar the earlier §12 floated is therefore **not in phase 1**. It stays a
possible later enhancement, not a commitment. This is load-bearing in one
direction: Goto is the reason the zoom scrollbar could be cut, which is why Goto
is M5-critical rather than M7.

Modifier-drag fine scrubbing (hold a modifier → ~one page per pixel, thumb does
not snap to the pointer) was raised in the same prototype and ruled out of
phase 1 — wheel + Goto suffice, and middle-click autoscroll may already cover the
need.

## `bytesPerRow` change preserves the byte offset

On a preset change the new top is
`clampTopOffset(topByteOffset, { ...m, bytesPerRow: next })` — the current byte
offset aligned down to a row boundary in the new width. The row *index* is not
preserved; the byte offset is, as closely as a row boundary allows.

**Consequence — an accepted downward ratchet.** Aligning down loses up to
`next - 1` bytes each change, so repeated changes walk the offset downward and a
16 → 24 → 16 round-trip is not lossless (prototype scenario E). Accepted:
`bytesPerRow` is toggled rarely, the drift is at most tens of bytes and always to
a valid row boundary, and a preserved-anchor scheme adds state for a case that
does not matter in practice. If real use disproves that, adding a preserved
anchor offset is a localised change behind this same frozen surface.

## Consequences

- **Plan §3/§11/§12 are reconciled at M0** to the above: the "94 M rows / 1.5 GB"
  wording is gone, the §12 "coarse drag" risk is accepted, the "min thumb size"
  risk is closed (handled in `thumbGeometry`, pinned by a test), and the §12
  zoom-scrollbar line becomes "possible later enhancement".
- **[ADR-0002](./0002-page-cache-sized-against-the-viewport.md)'s amendment
  stands:** no seam is owed in `viewport.ts` for the phase-1.5 element view.
  `bytesPerRow` is a byte count, an element grid changes only how a row's bytes
  are painted, and this surface is frozen regardless.
- Unlike the renderer's `render(view)` seam
  ([ADR-0003](./0003-selection-is-one-range-cursor-is-its-collapsed-form.md)),
  the frozen viewport surface carries **no** sanctioned rewrite — an element grid
  does not touch it, and an anchor-offset retrofit fits behind it.

## Considered options

- **A two-level "zoom" scrollbar in phase 1** — rejected: Goto is a cleaner fine
  path, and the prototype showed drag + wheel/keyboard + Goto sufficient. Kept on
  the table as a later enhancement.
- **A hybrid native scrollbar below a size threshold** — rejected (and already
  closed by [#2]): two code paths and a mode discontinuity, and Firefox zeroes
  the scroll range past ~17.9 M px, so the "native" branch would break well
  inside the target range.
- **Preserving the row index on `bytesPerRow` change** — rejected: it keeps the
  reader on a screen position rather than on their data; the byte they were
  looking at is what should stay put.
- **A preserved anchor offset so `bytesPerRow` round-trips are lossless** —
  deferred: state for a case that does not matter, and retrofittable behind the
  frozen surface if it turns out to.
- **Storing `firstRow` (or a fractional scroll position) alongside
  `topByteOffset`** — rejected: a second representation to keep in sync, and the
  source of exactly the drift bugs a single choke point prevents.
