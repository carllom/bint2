# The extent marker is a passive gutter overlay, outside the hex renderer

The **Bitmap** (ADR-0008) can **lock** its **Origin**, detaching the rendered run
of bytes from the **Cursor**. [#71](https://github.com/carllom/bint2/issues/71)
adds an **extent marker**: chrome in the byte grid showing where that locked run
— the **Extent** — sits, since those bytes are usually scrolled out of view. This
ADR settles where the marker lives in the rendering architecture.

**Decision:** the extent marker is a **passive overlay element**, a sibling of
the byte grid inside the row area, positioned purely from `topByteOffset` and the
measured row height — the same viewport math the grid already derives its rows
from (ADR-0006). It is **not** a field on `HexGridView`, and `DomHexRenderer` does
not paint it.

- The `HexRowRenderer` seam (ADR-0003) and its recycled DOM pool stay frozen: no
  new input, no new class, no per-row modifier for the Extent.
- The overlay only reads `topByteOffset` and the row height; it holds no
  coordinate authority and nothing reads back from it. `byteAtPoint` is still the
  renderer's only output.
- The overlay is decorative: `aria-hidden`, no live region (ADR-0005 — the byte
  grid is not a document). It renders only while the Origin is locked and the
  Bitmap Panel is mounted.

## Considered options

- **An extent range on `HexGridView`, painted by `DomHexRenderer` as a row
  modifier.** Rejected: it reopens the frozen renderer seam for a purely
  decorative concern and ties the marker's lifetime to a repaint. The freeze
  exists to protect the coordinate / paging path — the recycled pool,
  `byteAtPoint`, and the ADR-0002 / ADR-0006 math as the single source of row
  geometry; a translucent band does not belong there. A passive layer keyed off
  `topByteOffset` adds no authority to that path, so it does not count as
  unfreezing the renderer.
- **A stripe in the `VirtualScrollbar`.** Rejected: the scrollbar shows position
  within the whole document, whereas the marker's value is its alignment with the
  actual visible rows and the address gutter. A file-scale minimap mark is a
  different, weaker signal — left in the fog as a possible addition, not a
  replacement.

## Consequences

- The overlay recomputes from the same metrics as the grid, so bytes-per-row
  changes, zoom and resize keep it aligned for free.
- The Extent is drawn as a **contiguous hull** `[Origin, Origin + Stride·(Height−1)
  + Width)` even when `Stride > Width`; the per-row gaps are not shown.
- When the locked Extent is entirely off-screen the overlay shows an edge
  chevron; clicking it scrolls the grid to the Extent. That chevron is the
  overlay's only interactive surface — the band is `pointer-events: none`, so byte
  clicks pass straight through to the cells beneath.
- Click-to-cursor runs the other way and is **not** part of this overlay: a
  Bitmap pixel click drives the Cursor through the store (ADR-0003), the same
  path a grid click takes.
- A canvas hex renderer swapped in behind `HexRowRenderer` would not affect the
  marker.
