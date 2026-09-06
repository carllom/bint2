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
