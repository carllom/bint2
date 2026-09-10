# The Bitmap's Origin follows or locks to the Cursor

The **Bitmap** (map [#63](https://github.com/carllom/bint2/issues/63),
[#65](https://github.com/carllom/bint2/issues/65)) renders a contiguous run of
the document's bytes as 1-bpp pixels, starting at an **Origin** offset. The
question this ADR settles is how the Origin is navigated.

**Decision:** the Origin has no navigation of its own — it couples to the
**Cursor** in one of two modes.

- **Follow** (default). Origin equals the Cursor's byte offset exactly,
  unaligned to Width or Stride. Byte-stepping the Cursor in the hex grid slides
  the Bitmap one byte at a time, and that is how column alignment is dialled in.
- **Lock**. One action — `L`, or the section's state toggle — freezes the
  Origin at its current offset. The Cursor then moves independently and the
  render is a pure function of `[Origin, Width, Stride, Height, Zoom, invert]`
  and the bytes, with no Cursor input. While the Bitmap section is focused and
  locked, its own arrow / page keys nudge the Origin (±1 byte, ±Stride,
  ±page); in Follow mode those keys are inert. Toggling back to Follow snaps the
  Origin to the Cursor's current offset and resumes tracking.

The two named actions are **Lock Origin** and **Follow Cursor**. Lock Origin is
unavailable until a Cursor exists.

## Considered options

- **Always follow the Cursor.** Rejected: it makes it impossible to hold a
  framebuffer or font-table region on screen while reading its bytes in the hex
  grid, which is the core workflow.
- **Anchor the Origin to the visible page / Viewport.** Rejected: the bytes
  worth seeing as pixels are usually *not* the ones currently on screen — an LCD
  font table far from the current scroll position — so tying the Origin to the
  Viewport fights the intent.
- **A bare numeric Origin field as the primary mechanism.** Rejected: typing hex
  offsets to hunt for alignment is far worse than nudging a byte at a time and
  watching the pixels shift into register. Kept in the fog as a possible later
  convenience.

## Consequences

- **Origin mode and a locked Origin are session-only.** Every reload starts in
  Follow. This is a starting choice, not a principle: persisting the mode — and
  named, saved Bitmap views as part of per-document metadata — is a sanctioned
  later extension, and would land near the **Annotation** concept.
- **"The section is focused" is load-bearing.** It gates both the Origin-nudge
  keys and the Width / Stride keys (`Comma` / `Period`, `Shift` for Stride,
  bound by `KeyboardEvent.code` so keyboard layout is irrelevant). The focus
  plumbing itself belongs to the shell-migration ticket
  ([#68](https://github.com/carllom/bint2/issues/68)).
- **The extent marker is a separate concern.** Showing *where* a locked Bitmap
  sits in the hex grid is [#71](https://github.com/carllom/bint2/issues/71);
  this ADR only establishes that a locked Origin has no Cursor coupling left to
  render.
