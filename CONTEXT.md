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

**Byte order**:
The order — little- or big-endian — in which a multi-byte Element's bytes are
read into a number. One view-wide setting, persisted, that every numeric decode
of the document obeys: the inspector now, the element grid later. It never
reaches the char column or a raw-byte copy, which render bytes one at a time and
have no order to choose.
_Avoid_: endianness (as the setting's name), LE/BE (in prose)

**Code page**:
A 256-entry table mapping each byte value to one glyph, used to render the char
column. One view-wide setting, persisted, like Byte order — and like Byte order
it decodes nothing: it never changes how a byte is read as a number, copied, or
addressed, only which glyph it shows. Bytes a table leaves unmapped fall back to
one shared placeholder glyph.
_Avoid_: encoding, charset, character set, character map

**Char column**:
The column of the byte grid that shows one glyph per byte, beside the hex
column. Always exactly one glyph per byte — never a decoded multi-byte string —
and which glyph is the Code page's choice.
_Avoid_: ASCII pane, char pane, text column

**Sidebar**:
The resizable region down the right edge of the app shell, holding the stack of
Panels. Shown only while a document is open. A draggable splitter sets its width
— persisted — and collapses it to nothing and back. It never holds the byte
grid, which keeps the rest of the width.
_Avoid_: drawer, dock, side panel

**Panel**:
One titled, independently collapsible region within the Sidebar, holding one
tool. Two exist — the Inspector and the Bitmap — in a fixed order. No docking,
no bottom placement, no drag-to-rearrange, no tear-off. Each opens and closes on
its own, and that open state is persisted.
_Avoid_: pane, dock, widget, accordion section

**Inspector**:
The panel that decodes the bytes at the cursor into each primitive numeric type
at once — the signed and unsigned integers at 8, 16, 32 and 64 bits, and the 32-
and 64-bit floats — read in the view's current byte order. It shows its values
on demand as the cursor moves and is never spoken. Distinct from an element
grid, which would render the document itself as elements rather than bytes; the
inspector leaves the document's rendering byte-oriented, and leaves glyphs to
the char column.
_Avoid_: data panel, decoder, preview

**Bitmap**:
A 1-bit-per-pixel monochrome rendering of a contiguous run of the document's
bytes: each byte is eight horizontal pixels, most-significant bit leftmost, a
set bit painting the foreground. The bytes are the pixels — nothing is decoded
from them.
_Avoid_: image view, pixel view, raster, preview

**Origin**:
The document byte offset the Bitmap's top-left pixel maps to. It either follows
the Cursor, tracking it byte-for-byte as it moves, or is locked — frozen at a
committed offset while the Cursor moves on independently.
_Avoid_: start offset, anchor, base address

**Width**:
The number of document bytes the Bitmap draws per row, each contributing eight
pixels. Distinct from an Element's byte-width: a row length in the rendering,
not the size of a decoded value.
_Avoid_: row size, columns, bytes per row

**Stride**:
The number of document bytes the Bitmap advances from one row's Origin to the
next. Equal to Width by default; when larger, the extra trailing bytes of each
row are skipped, so one column of a wider repeating structure can be viewed in
isolation.
_Avoid_: pitch, step, row gap

**Extent**:
The run of document bytes the Bitmap currently renders — from the Origin to the
end of its last row, `[Origin, Origin + Stride·(Height−1) + Width)`. Shown in the
byte grid as passive chrome while the Origin is locked, so the reader can see
where an off-screen Bitmap is pointed. Transient view chrome that carries no
meaning of its own and disappears once the Origin follows the Cursor again — not
an Annotation.
_Avoid_: coverage, footprint, reveal, region

**Entropy map**:
A block-based Shannon-entropy heatmap over a contiguous run of the document's
bytes — the whole file or the current Selection. Each block's entropy is
painted as one strip segment on a thermal color scale; the Panel's block size
is configurable, the same role Width plays for the Bitmap. A rendering of
computed values, not the bytes themselves — distinct from the Bitmap, which
paints the bits directly.
_Avoid_: heatmap, entropy view, compression map

**Byte histogram**:
A normalized 256-value byte-frequency distribution over the same kind of range
as the Entropy map — the count of each byte value divided by the range's total
length. Has no positional axis: two ranges with the same bytes in different
order produce the same histogram. Distinct from the Entropy map, which the
same underlying scan also produces, though the two are different renderings of
different aspects of it.
_Avoid_: frequency chart, distribution, byte counts
