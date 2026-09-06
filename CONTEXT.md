# bint2

A browser hex/char viewer for very large local files. The whole design turns on
one constraint: the document is never held in memory in full, so every concept
here is about serving a bounded window of bytes on demand.

## Language

**ByteSource**:
The abstraction over an open document's bytes. It answers for any byte range on
demand and never holds the whole document.
_Avoid_: reader, provider, file adapter

**Paging**:
Fetching byte ranges of the document to satisfy the view. The bytes come back as
bytes; nothing is computed from them.
_Avoid_: loading, streaming

**Derived work**:
Sustained computation over the document's bytes that produces something other
than those bytes — searching, entropy maps, decoding. The counterpart to paging,
and out of scope for phase 1.
_Avoid_: analysis, processing

**Page**:
The fixed-size unit in which the document's bytes are fetched and held. Every
read is served by assembling whole pages.
_Avoid_: block, chunk, buffer

**Resident**:
Held in memory right now, and therefore answerable without going back to the
document.
_Avoid_: cached, loaded, warm

**Direct read**:
A read too large to serve as pages, satisfied straight from the document and
leaving nothing resident behind it.
_Avoid_: bypass, streaming read

**Dead source**:
A document whose bytes can no longer be fetched, permanently — the file moved or
was truncated out from under the open document. Bytes that are already resident
stay answerable; nothing else ever will be. Distinct from closing, which the
reader does on purpose by opening another document.
_Avoid_: closed, lost, broken, error state

**Viewport**:
The bounded window of the document that is on screen — the rows shown right now,
and the position that fixes which rows those are. Never the document: it holds
tens of rows of a document that may hold millions.
_Avoid_: view, window, screen, grid

**Selection**:
The one range of bytes the reader has marked right now. There is never more than
one, the next click replaces it, and it does not survive the document being
closed.
_Avoid_: highlight, marked range, region

**Cursor**:
The selection when it spans no bytes — the single position keyboard navigation
moves. Not a second concept alongside the selection; the same thing, collapsed.
_Avoid_: caret, insertion point, focus

**Annotation**:
A range of bytes that carries meaning of its own — a highlight, a comment — and
stays put while the reader goes on selecting elsewhere. Many can exist at once.
Out of scope for phase 1, named here so that it never gets called a selection.
_Avoid_: selected range, highlight, marker, tag

**Element**:
A fixed-width multi-byte value decoded from the document's bytes — a u16, an
i32, an f64 — as opposed to the bytes themselves. Reading one requires knowing a
width and a byte order; a byte requires neither. Out of scope for phase 1, named
here so that it never gets called a byte.
_Avoid_: field, word, value, datum

**Inspector**:
The surface that decodes the bytes at the cursor into every element type at
once. Distinct from an element grid, which would render the document itself as
elements rather than bytes; the inspector leaves the document's rendering
byte-oriented. Out of scope for phase 1.
_Avoid_: data panel, decoder, preview
