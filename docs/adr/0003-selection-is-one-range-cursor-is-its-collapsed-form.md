# Selection is one range; the cursor is its collapsed form

`docs/plan-phase1.md` §7 lists "byte cursor" and "selection" as separate
interaction features, and
[#7](https://github.com/carllom/bint2/issues/7) established that native text
selection is unusable in this view — one drag spans both the hex and ascii
renderings of the same bytes and concatenates them — so the viewport sets
`user-select: none` and phase 1 builds a custom byte-range selection model from
day one. That left the model's own shape unspecified.

**Decision:** there is **one** concept, not two. The selection is a single range
held as `{ anchor, focus }` byte offsets — direction preserved, so `Shift`-click
and `Shift`+arrows extend the correct end — from which `start = min` and
`end = max + 1` derive a half-open byte range. When `anchor === focus` the
selection spans no bytes and *is* the cursor. Click and drag are one gesture;
the status bar shows its start / end / length fields exactly when the selection
is non-collapsed.

Snapping to whole bytes falls out rather than being implemented: `byteAtPoint(x, y)`
— frozen by [#7](https://github.com/carllom/bint2/issues/7) as the renderer's only
channel back — returns a **byte index**, so no sub-byte position is representable
anywhere in the model. The linked hex↔ascii highlight follows for the same
reason: both panes paint from the same byte range, never from pixel geometry.

## Considered options

Generalising the paint path now — `HexRow` taking `ranges: { start, end, kind }[]`
with M5 always passing at most one — was considered and **rejected**. The
motivation was real: annotations (persistent, independently addressable,
possibly commented byte ranges — see `CONTEXT.md`) are an anticipated later
feature, and #7 froze `HexRowRenderer.render(view)` as receiving the rows plus
*a* selection and *a* cursor, which is a single-range shape.

It was rejected because the questions annotations actually pose — overlap and
z-order against the live selection, per-range styling, where comment text lives,
how ranges survive a document being reopened — cannot be answered before the
feature has requirements, and a seam generalised against guesses is not better
than a seam generalised against needs.

## Consequences

The frozen `render(view)` seam is knowingly single-range, and **rewriting it
when annotations arrive is sanctioned in advance**, not a defect and not a
violation of #7's freeze — that freeze governs phase 1. A future reader adding
annotations should expect to reshape the seam and should not read its
single-range shape as a constraint they must work around.

The vocabulary is reserved now to keep that rewrite honest: **selection** is the
one transient range, **cursor** is its collapsed form, **annotation** is the
future many. Nothing that outlives a click may be called a selection.
