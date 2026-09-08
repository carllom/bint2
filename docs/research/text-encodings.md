# Research: `TextDecoder` encoding support and a minimal encoding set

Issue: [#53](https://github.com/carllom/bint2/issues/53) · feeds the non-ASCII text grilling ticket (#51).
Status: research only — no code change proposed here beyond the recommendation at the end.

## TL;DR

- The browser gives us **~40 decoders for free** via `TextDecoder`: UTF-8, UTF-16LE/BE,
  29 single-byte legacy codepages, and 7 legacy multi-byte CJK (`shift_jis`, `gbk`,
  `gb18030`, `big5`, `euc-jp`, `euc-kr`, `iso-2022-jp`). Same set in current Chrome, Edge
  and Firefox — the list is the WHATWG Encoding Standard and all three engines implement it
  in full.
- **`iso-8859-1` is not a distinct decoder** — the Encoding Standard maps it (and `latin1`,
  `ascii`, `us-ascii`) to `windows-1252`. `iso-8859-15` *is* distinct.
- **CP437 (DOS/OEM-US) is not in the standard** and never will be. Supporting it is a
  static 256-entry lookup table (~1 KB) plus a three-line decode function. Trivial, and the
  same shape covers any other retro codepage later.
- **Variable-width text in a one-cell-per-byte grid** has no clean answer. Real tools split:
  lightweight viewers (hexyl, GHex, VS Code hex editor, HxD) keep the char column
  single-byte and show decoded multi-byte text elsewhere (an inspector) or not at all;
  heavier GUIs (IDA, 010 Editor, ImHex) let you pick an encoding and paint decoded glyphs
  over their byte span, blanking the continuation cells. Nobody ships per-byte continuation
  markers as the primary UI.
- **Recommended phase-1.5 set:** `utf-8` (default), `windows-1252`, `iso-8859-15`,
  `utf-16le`, `utf-16be`, plus a hand-rolled `cp437`. Defer the CJK multi-byte decoders
  until someone asks.

---

## 1. What `TextDecoder` supports

The label list is normative in the WHATWG **Encoding Standard**, [§5 "Indexes" / the encodings
table](https://encoding.spec.whatwg.org/#names-and-labels). MDN reproduces it at
[Encoding API / Encodings](https://developer.mozilla.org/en-US/docs/Web/API/Encoding_API/Encodings).
`new TextDecoder(label)` accepts any label (case-insensitive, whitespace-trimmed) that
resolves to one of these encodings.

| Family | Encodings (canonical names) |
| --- | --- |
| Unicode | `UTF-8`, `UTF-16LE`, `UTF-16BE` |
| Single-byte (29) | `IBM866`; `ISO-8859-2/3/4/5/6/7/8/8-I/10/13/14/15/16`; `KOI8-R`, `KOI8-U`; `macintosh`; `windows-874`; `windows-1250`–`1258`; `x-mac-cyrillic` |
| Legacy CJK multi-byte (7) | `GBK`, `gb18030`, `Big5`, `EUC-JP`, `ISO-2022-JP`, `Shift_JIS`, `EUC-KR` |
| Misc | `replacement`, `x-user-defined` |

Total: **41 encodings**, of which **40 are constructable** — see the `replacement` note below.

### Notable label mappings (Encoding Standard §4.2, "Concept encoding")

- `iso-8859-1`, `latin1`, `l1`, `cp819`, `ibm819`, `csisolatin1`, **`ascii`**, **`us-ascii`**,
  `ansi_x3.4-1968` → **`windows-1252`**. The spec is explicit:
  > "'latin1' and 'ascii' are just labels for windows-1252."
  Rationale: ISO/IEC 8859-1 left 0x80–0x9F undefined; the web filled that range with the
  Windows-1252 repertoire (e.g. 0x80 → U+20AC €), so browsers only ever had one decoder.
  ([spec §4.2 note](https://encoding.spec.whatwg.org/#names-and-labels))
- `iso-8859-9` / `latin5` → `windows-1254`; `iso-8859-11` / `tis-620` → `windows-874`;
  `x-mac-roman` → `macintosh`.
- `iso-8859-15` / `l9` / `csisolatin9` → **`ISO-8859-15`** (its own decoder — the Latin-1
  variant with €, Š, ž, Œ, etc.).
- `gb2312`, `gbk`, `chinese`, `x-gbk` → **`GBK`** (a superset decoder; the distinct
  `gb18030` label decodes 4-byte sequences too).
- `unicode`, `utf-16`, `ucs-2`, `iso-10646-ucs-2` → **`UTF-16LE`** (the bare `utf-16`
  label is little-endian).
- `iso-2022-kr`, `iso-2022-cn`, `iso-2022-cn-ext`, `hz-gb-2312`, `csiso2022kr` →
  **`replacement`** (see §2).

### Engine differences (Chrome / Edge / Firefox)

None that matter. `TextEncoder`/`TextDecoder` have been fully available since Chrome 38,
Edge 79, Firefox 20 ([caniuse: textencoder](https://caniuse.com/textencoder); MDN marks the
API "Baseline: widely available"). Chrome and Edge share Blink; Firefox's Gecko implements
the same Encoding Standard. All three ship the complete decoder set above, including every
legacy CJK decoder — those are mandatory parts of the standard, not optional extras. Safari
(WebKit, out of scope for bint2) also implements the full set.

If we ever want to be defensive, per-label feature detection is a one-liner:

```ts
function decoderSupported(label: string): boolean {
  try { new TextDecoder(label); return true } catch { return false }
}
```

This returns `false` for a bogus label and for the `replacement` labels; everything in the
table above returns `true` in all three target browsers.

---

## 2. Error handling, BOM, single- vs multi-byte

Source: Encoding Standard [§4.1 "Error mode"](https://encoding.spec.whatwg.org/#error-mode),
[§10.1.1 the `TextDecoder` constructor](https://encoding.spec.whatwg.org/#dom-textdecoder),
and MDN
[`TextDecoder()`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder).

### `fatal` (default `false`)

- **`false` — replacement mode.** An invalid/incomplete byte sequence is replaced with
  **U+FFFD � REPLACEMENT CHARACTER** and decoding continues. This is what bint2's raw-text
  copy (`toRawText`, `src/core/format.ts`) relies on today: "an undecodable byte becomes
  U+FFFD rather than vanishing."
  - Note: one bad multi-byte lead can consume/emit **one** U+FFFD covering several bytes,
    so the decoded string's length is not a reliable function of byte count in replacement
    mode. Fine for a copy; relevant if we ever align glyphs to cells (§6).
- **`true` — fatal mode.** `decode()` throws a **`TypeError`** on the first malformed
  sequence. Useful as an *encoding sniff*: try `fatal: true`, and a clean decode is decent
  evidence the bytes really are that encoding (strong for UTF-8, weaker for single-byte
  codepages that accept almost any byte).

### `ignoreBOM` (default `false`) — badly named

It does **not** control whether a BOM is detected/sniffed. It controls whether a leading
**U+FEFF** is *stripped from the output* for the `UTF-8`, `UTF-16LE` and `UTF-16BE`
decoders:

- `ignoreBOM: false` (default) → a leading U+FEFF is removed from the decoded string (once).
- `ignoreBOM: true` → the U+FEFF is **kept** in the output.

bint2 passes `ignoreBOM: true` in `toRawText` deliberately, so a copied selection that
begins with BOM bytes copies as-is rather than one code point short.

Separately, `TextDecoder` **never auto-detects** an encoding from a BOM. The label you pass
wins. (Byte-order-mark *sniffing* — 0xEF BB BF → UTF-8, 0xFE FF → UTF-16BE, 0xFF FE →
UTF-16LE — is defined in [§6.1 "BOM sniff"](https://encoding.spec.whatwg.org/#bom-sniff) for
consumers like HTML's "decode", but it is our job to run it if we want it, not
`TextDecoder`'s.)

### Single-byte decoders (Encoding Standard [§9.1](https://encoding.spec.whatwg.org/#single-byte-decoder))

- Bytes **0x00–0x7F** pass straight through as U+0000–U+007F.
- Bytes **0x80–0xFF** index a **128-entry table** (`index single-byte`). An unassigned slot
  (e.g. `windows-1252` 0x81) → error → U+FFFD (or `TypeError` if `fatal`). `windows-1252`
  has 5 such holes (0x81, 0x8D, 0x8F, 0x90, 0x9D); `iso-8859-15` has none.
- Stateless: decoding is per-byte, order-independent, no cross-cell context. This makes
  single-byte codepages the easy case for a per-byte char column — every cell is
  independent, exactly like today's `toAsciiChar`.

### Multi-byte decoders

- **Stateful.** Shift_JIS / GBK / Big5 / EUC-* carry a lead-byte state between bytes;
  ISO-2022-JP is a full escape-sequence state machine. You cannot decode a cell in
  isolation — you need to know where the run starts.
- **UTF-8** is self-synchronising (continuation bytes are 10xxxxxx), so you *can* resync
  from an arbitrary offset with bounded error. **Shift_JIS / GBK / Big5 are not** — the
  same bytes decode differently depending on where you start. This is the core problem in
  §6.
- Streaming: `decode(chunk, { stream: true })` holds a partial trailing sequence for the
  next call; the final `decode()` (or one without `stream`) flushes, emitting U+FFFD for
  any dangling bytes. Relevant if we ever decode viewport-sized windows incrementally.

### `x-user-defined`

A pseudo-encoding: 0x00–0x7F → ASCII, 0x80–0xFF → **U+F780–U+F7FF** (Private Use Area, a
flat `byte + 0xF700`). Lossless and perfectly reversible, but renders as PUA
boxes/tofu. Handy as an internal "show me every byte, reversibly" mode; not something to
put in a user-facing encoding menu.

---

## 3. UTF-16LE / UTF-16BE

- Both are real, separate decoders. `TextDecoder('utf-16le')` and `TextDecoder('utf-16be')`
  work in all three target browsers. The bare label **`utf-16` means little-endian**
  (Encoding Standard [§4.2](https://encoding.spec.whatwg.org/#names-and-labels);
  `utf-16` and `unicode` both map to `UTF-16LE`).
- Endianness is **fixed by the label**, not sniffed. `UTF-16LE` reads `[lo, hi]`, `UTF-16BE`
  reads `[hi, lo]`. A leading BOM (0xFF 0xFE / 0xFE 0xFF) is *not* used to pick endianness
  by `TextDecoder`; it is only stripped from output per `ignoreBOM` (§2). If we want
  "UTF-16, auto endianness" we sniff the first two bytes ourselves and choose the label.
- An odd trailing byte → U+FFFD (or throw if `fatal`). Lone surrogates → U+FFFD.
- For a hex grid this is the *nice* variable-width case: every code unit is exactly 2 bytes,
  so alignment is regular (2 cells per glyph, 4 for a surrogate pair / astral char). No
  resync ambiguity beyond "which byte is the pair boundary".

---

## 4. Single-byte families worth offering

| Encoding | Via `TextDecoder`? | Why offer it |
| --- | --- | --- |
| `windows-1252` | Yes (also the target of `latin1`/`iso-8859-1`/`ascii`) | The single most common "it's basically ASCII plus some accented bytes" Western codepage. Default fallback for legacy Windows/Web text. |
| `iso-8859-1` | **Not distinct** — alias of `windows-1252` | Nothing to do; picking "Latin-1" just selects `windows-1252`. Worth a menu note so nobody expects the 0x80–0x9F control interpretation. |
| `iso-8859-15` | Yes (distinct decoder) | Latin-1 + € and a few French/Finnish letters. Cheap to include since it's free. |
| **CP437 / OEM-US / IBM437** | **No — not in the Encoding Standard** | The classic DOS / BBS / retro case: box-drawing (░▒▓█ ─│┼), `☺☻♥♦`, `Ç ü é å`, etc. Files from that era are unreadable in every spec encoding. |

### What CP437 support takes

The Encoding Standard deliberately excludes OEM/PC codepages other than `IBM866`
([§4 scope](https://encoding.spec.whatwg.org/#encodings) — the list is "legacy encodings
… needed to be Web-compatible", and CP437 never appeared as a charset label on the Web).
So it's a hand-roll:

1. A **static 256-entry table** `byte → code point`. All 256 positions have a Unicode
   mapping; the canonical source is the Unicode Consortium's
   [`CP437.TXT`](https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT).
   - That file maps 0x00–0x1F to the C0 **control** characters (0x01 → U+0001). For a hex
     viewer the fun/retro choice is the **graphical** interpretation instead — 0x01 → U+263A
     ☺, 0x03 → U+2665 ♥, 0x0D → U+266A ♪, etc. — which is a well-known alternate table
     (the "full" CP437 glyph set). Pick one; probably graphical for the char column,
     since bint2 already renders controls as `.` and the whole point of a CP437 mode is to
     *see* those bytes.
2. A trivial decoder: `s += String.fromCodePoint(table[byte])` per byte. Stateless,
   order-independent — same properties as the spec single-byte decoders, so it drops into
   the same per-cell code path as `toAsciiChar`.
3. ~1 KB of data (256 × `Uint16Array`, or a packed string literal). No streaming concerns.

The same shape (256-entry table + 3-line decoder) covers any future retro codepage
(PETSCII, ATASCII, Amiga, Mac OS Roman quirks) if anyone ever asks. It's the cheapest
possible extension point.

---

## 5. Legacy multi-byte CJK (`shift_jis`, `gbk`, `euc-kr`, `big5`)

- **All supported by `TextDecoder`**, in all three target browsers, decode-only. Labels:
  `shift_jis` (aka `sjis`, `windows-31j`, `ms932`), `gbk` (aka `gb2312`, `chinese`),
  `gb18030`, `big5`, `euc-kr` (aka `korean`, `windows-949`), `euc-jp`, `iso-2022-jp`.
- **`iso-2022-kr` / `iso-2022-cn` are NOT** — they resolve to the `replacement` encoding,
  and `new TextDecoder('iso-2022-kr')` **throws `RangeError`**. (Encoding Standard
  [§10.1.1](https://encoding.spec.whatwg.org/#dom-textdecoder): "If encoding is failure or
  replacement, then throw a RangeError." The `replacement` decoder exists only so that a
  whole `replacement`-labelled resource decodes to a single U+FFFD — a security measure
  against ISO-2022 attacks.)

**Recommendation: defer.** Reasons:

- They are **stateful and (Shift_JIS/GBK/Big5) not self-synchronising** — the hardest case
  for §6, and useless in a per-byte column without run boundaries.
- Value in a *general-purpose* hex viewer is low; the audience that needs them knows to
  reach for a specialised tool.
- They cost nothing to add later — `TextDecoder` already has them; it's purely a menu
  entry + whatever §6 layout we land on. No reason to carry the UX burden in phase 1.5.

Keep them on the "phase 2, if asked" list, not phase 1.5.

---

## 6. Framed, not answered: variable-width text in a one-cell-per-byte grid

bint2's char column is **one glyph per byte** (`toAsciiChar`). UTF-8 is 1–4 bytes/char,
UTF-16 is 2 or 4, legacy CJK is 1–2 (or escape-delimited). The grilling ticket has to pick
how — or whether — decoded multi-byte text appears in that grid. The options:

### (a) Decode and align glyphs over their byte span

Paint the glyph in the cell of its **lead byte**; leave continuation cells blank (or a
faint tint / ditto mark). Grid geometry is unchanged.

- **Pros:** text stays spatially correlated with its bytes; works for UTF-8 and UTF-16.
- **Cons:** need run boundaries. For UTF-8 you can resync within the visible window
  (scan back ≤3 bytes to a lead byte) with bounded error at the top edge. For
  **Shift_JIS/GBK/Big5 you cannot** — decoding depends on where the run started, which may
  be off-screen, so the same row can render differently after scrolling. A glyph whose
  bytes straddle a row boundary either overhangs into the next row or is clipped.
- **Who does this:** **IDA** hex view ("Text ▸ Add encoding…", default UTF-8, offers
  ASCII/UTF-8/UTF-16/Shift-JIS/cp932/EUC-JP; decoded glyphs sit in the text column over
  their bytes —
  [Hex-Rays tip #109](https://hex-rays.com/blog/igors-tip-of-the-week-109-hex-view-text-encoding));
  **010 Editor** (selectable "simple" single-byte + "complex" double-byte + UTF-8/16 —
  [manual](https://www.sweetscape.com/010editor/manual/)).

### (b) Per-byte continuation markers

Every cell shows something: lead byte → glyph, continuation bytes → a marker (`·`, `→`, a
box segment). Grid stays literally one-cell-per-byte.

- **Pros:** honest about bytes; no overhang; no ambiguity about cell count.
- **Cons:** noisy; the actual text is hard to *read* as text. Still needs run boundaries to
  know which bytes are continuations.
- **Who does this:** essentially nobody as a primary UI. It shows up only as a debugging
  toggle.

### (c) Leave the column single-byte; decode elsewhere (Inspector / status line)

Char column stays exactly as today (ASCII-ish, one byte one glyph). A separate
**Inspector "text line"** decodes the selection (or the run around the cursor) in the
chosen encoding and shows it as ordinary text.

- **Pros:** zero grid disruption; the decode is unambiguous because the *selection* defines
  where the run starts; trivial to implement (it's `toRawText` with a configurable label);
  no resync problem; handles every encoding including stateful CJK.
- **Cons:** you don't *see* non-ASCII text in place; you have to select to read it.
- **Who does this:** **hexyl** (char panel is ASCII-only, categorised: printable shown,
  other ASCII `•`, non-ASCII `×`, NUL `⋄` — [README](https://github.com/sharkdp/hexyl));
  **GHex** (ASCII column + a small cursor "conversion" box: bin/oct/dec/ASCII of the byte);
  **VS Code hex editor** (ASCII column + Data Inspector panel decoding UTF-8/UTF-16 of the
  hovered bytes — [vscode-hexeditor](https://github.com/microsoft/vscode-hexeditor)).

### (d) A separate, synchronized text pane

A dedicated decoded-text view alongside the hex grid, scroll-locked to it, with its own
selectable encoding. Not cell-aligned — it flows as text.

- **Pros:** real readable text in any encoding; hex grid stays pure; selection can bridge
  the two.
- **Cons:** most build effort; two representations of "where am I" to keep in sync; still
  needs a run origin for non-self-syncing encodings (usually "top of viewport, best
  effort").
- **Who does this:** **Hex Fiend** — stacked "representers" (hex / text / data inspector);
  the text representer has a selectable **string encoding**, including custom encodings
  ([HexFiend#95](https://github.com/HexFiend/HexFiend/issues/95)), rendered as its own
  column rather than locked 1:1 to hex cells. **ImHex** — loads custom **Thingy `.tbl`**
  encoding tables and draws the decoded string in a dedicated pane to the right of the
  ASCII pane, glyphs spanning their bytes
  ([ImHex#26](https://github.com/WerWolv/ImHex/issues/26),
  [docs](https://docs.werwolv.net/imhex/views/hex-editor)).

### What the survey says

- **HxD's author** worked through exactly this and shipped **single-byte only** for the
  text column, explicitly refusing MBCS (Shift_JIS et al.) because "without structural
  definition a hex editor cannot know where strings start" — searches and rendering become
  position-dependent. He considered UTF-8/UTF-16 overhang rendering ("UTF-16 BMP-only" for
  predictable width) but did not ship it.
  ([mh-nexus forum](https://forum.mh-nexus.de/viewtopic.php?t=1004))
- **Split by tool weight:** terminal / lightweight editors (hexyl, GHex, VS Code, HxD)
  → **(c)**: keep the column single-byte, decode multi-byte text in an inspector or not at
  all. Heavyweight reverse-engineering GUIs (IDA, 010 Editor) → **(a)**: selectable
  encoding, glyphs painted over their span. ImHex / Hex Fiend → **(d)**: a distinct
  encoding-aware text region.
- **Nobody** ships **(b)** continuation markers as the main view.
- The recurring theme: **the selection (or an explicit structure) is what makes a decode
  unambiguous.** Free-floating "decode the grid" is only safe for self-synchronising
  encodings (UTF-8, UTF-16), and even then it wobbles at the viewport's top edge.

---

## 7. Recommendation — minimal phase-1.5 encoding set

**Offer six encodings. Default UTF-8.**

| Label (menu) | `TextDecoder` label | Notes |
| --- | --- | --- |
| UTF-8 *(default)* | `utf-8` | Matches today's `toRawText`; the overwhelmingly common case for embedded strings. |
| Windows-1252 / Latin-1 | `windows-1252` | Covers `iso-8859-1` / `ascii` too (they're the same decoder). The "legacy Western byte soup" fallback. |
| ISO-8859-15 | `iso-8859-15` | Free; Latin-1 + €. Include or drop with no cost — lean toward include. |
| UTF-16 LE | `utf-16le` | Bare `utf-16` is LE anyway. |
| UTF-16 BE | `utf-16be` | Endianness is label-picked; offer both explicitly. |
| CP437 (DOS) | *(hand-rolled 256-entry table)* | The one non-`TextDecoder` entry. ~1 KB table + 3-line stateless decoder, graphical interpretation of 0x00–0x1F. Delivers the retro/BBS/DOS case nothing else can. |

**Deliberately deferred:** `shift_jis`, `gbk`, `gb18030`, `big5`, `euc-jp`, `euc-kr`,
`iso-2022-jp` (stateful, mostly non-self-synchronising, niche — `TextDecoder` already has
them, so adding one later is a menu row plus the §6 layout, nothing more);
`x-user-defined` (internal-only if ever); the rest of the single-byte codepages (add
on request — each is one `TextDecoder` label).

**Char-column layout (for the grilling ticket, not decided here):** the low-risk path is
**(c)** — keep the per-byte char column as-is (extended to run each byte through the chosen
*single-byte* table: `windows-1252` / `iso-8859-15` / `cp437` all fit the existing
one-glyph-per-byte model unchanged), and put **UTF-8 / UTF-16 decoding in the Inspector
"text line"**, where the selection defines the run origin and there is no resync problem.
Painting decoded UTF-8/UTF-16 glyphs into the grid itself (**a**/**d**) is a bigger,
separate piece of work and can follow.

**Behavioural defaults to carry over:** replacement mode (not `fatal`) for display and
copy, so nothing vanishes; `ignoreBOM: true` for the raw-text copy so a selection copies
byte-for-byte; a `fatal: true` trial decode is available as a cheap "is it really UTF-8?"
check if we want an auto-suggest.

---

## Sources

- WHATWG Encoding Standard — <https://encoding.spec.whatwg.org/>
  (§4 encodings & labels, §4.1 error mode, §6.1 BOM sniff, §9.1 single-byte decoder,
  §10.1.1 `TextDecoder` constructor)
- MDN — `TextDecoder()` <https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder>
- MDN — Encoding API / Encodings (label table)
  <https://developer.mozilla.org/en-US/docs/Web/API/Encoding_API/Encodings>
- caniuse — TextEncoder/TextDecoder <https://caniuse.com/textencoder>
- Unicode Consortium — CP437 → Unicode mapping
  <https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/PC/CP437.TXT>
- HxD author on MBCS/UTF-8 in the text column
  <https://forum.mh-nexus.de/viewtopic.php?t=1004>
- Hex-Rays / IDA — hex view text encoding
  <https://hex-rays.com/blog/igors-tip-of-the-week-109-hex-view-text-encoding>
- hexyl README <https://github.com/sharkdp/hexyl>
- ImHex — custom encodings <https://github.com/WerWolv/ImHex/issues/26>,
  <https://docs.werwolv.net/imhex/views/hex-editor>
- Hex Fiend — string encoding / custom encodings
  <https://github.com/HexFiend/HexFiend/issues/95>
- VS Code hex editor / Data Inspector
  <https://github.com/microsoft/vscode-hexeditor>
