# Entropy map and byte histogram share one panel because they share one scan

The **Entropy map** and **Byte histogram** (map [#95](https://github.com/carllom/bint2/issues/95),
[#98](https://github.com/carllom/bint2/issues/98)) render differently — a
positional heatmap strip vs. a 256-bar distribution with no positional axis —
but both fall out of one pass over the same byte range: per-block counts that
are summed into the histogram's global counts and reduced into the entropy
map's per-block values. This ADR settles how that shared scan is exposed in
the UI.

**Decision:** one Sidebar Panel, "Entropy," holding both renderings behind a
Map/Histogram mode toggle — a pure view-swap over one computed result, the
same shape as the Bitmap's Follow/Lock toggle. One "Compute" action always
runs the full joint scan and populates both renderings together, regardless
of which mode is showing; the toggle never retriggers it. The block-size
control (an input to the scan, needed only by the Map view) stays visible in
both modes for the same reason: it's an input to the one result the reader is
looking at, not to whichever half of it is currently on screen. Slots into
the Sidebar's fixed order right after Bitmap: Inspector, Bitmap, Entropy.

## Considered options

- **Two independent Panels, each with its own Compute.** This was the
  starting answer during grilling, and it's the natural read of `CONTEXT.md`'s
  **Panel** definition ("one titled, independently collapsible region...
  holding one tool") — Entropy map and Byte histogram are arguably two tools.
  It was reversed once the shared scan was taken seriously: computing them
  independently means either (a) each Panel repeats the byte-reading scan the
  other already paid for, doubling the cost of a pass #96 already found can
  run 18–24s continuously, or (b) one Panel's Compute silently populates the
  other's data too, which is a real cross-Panel coupling with no honest way to
  show it — a "Compute" button in the Histogram panel that also fills in a
  collapsed Entropy panel's state is not something the independently-collapsible
  Panel model can express cleanly. One joint Panel makes the shared scan an
  honest, visible fact instead of a hidden side effect.
- **Compute per mode, cached per range/block-size.** Keep one Panel and one
  toggle, but only run the half of the scan the visible mode needs, filling in
  the other half lazily if the toggle is flipped. Rejected: the scan is a
  single pass over the bytes with no meaningfully separable histogram-only or
  entropy-only cost — splitting it back apart to save work that isn't
  separable just reintroduces option one's problem with extra bookkeeping.

## Consequences

- Opening the Entropy panel to check the histogram costs exactly the same
  Compute as checking the entropy map — there is no cheaper path to just one
  of the two views. This is accepted: the map's Notes already commit
  derived-work jobs to explicit, visible compute (#95/#96), so the two views
  sharing that one cost is not a new burden, just a shared one.
- A future reader should not "clean up" the toggle into two Panels without
  re-reading this: doing so either doubles the scan or reintroduces the
  hidden-coupling problem this ADR rejected.
- Neither the Panel nor the joint scan itself gets a `CONTEXT.md` term: the
  Panel just hosts the two reader-facing concepts (**Entropy map**, **Byte
  histogram**), and the scan is internal plumbing this ADR fully explains —
  it doesn't shape reader-visible behavior the way `ByteSource`/`Page` do.
