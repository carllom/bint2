# Data inspector designs in comparable hex tools

Research for issue #52. Survey of how established hex tools present a **data inspector** — a
panel that decodes the bytes at the cursor into typed values — to feed a downstream ticket
that designs bint2's own Inspector.

Sources are primary throughout: official manuals and first-party source code. URLs are cited
inline. Read date: 2026-09-08.

## Scope

Covered: 010 Editor, HxD, ImHex, Hex Fiend, GHex, hexyl. Also included where relevant:
VS Code Hex Editor, Okteta, wxHexEditor.

---

## 010 Editor

Primary sources:
[Using the Inspector](https://www.sweetscape.com/010editor/manual/Inspector.htm),
[Inspector/Tables Options](https://www.sweetscape.com/010editor/manual/OptionsInspector.htm),
[Introduction to Byte Ordering](https://www.sweetscape.com/010editor/manual/ByteOrdering.htm).

- **Types / order.** A single table, top to bottom: Binary (8-bit), Signed Byte,
  Unsigned Byte, Signed Short, Unsigned Short, Signed Int, Unsigned Int, Signed Int64,
  Unsigned Int64, Float (32), Double (64), Half Float (16), String (null-terminated ASCII,
  max 256 chars), DOSDATE, DOSTIME, FILETIME, OLETIME, time\_t, time64\_t, GUID, and Opcode
  (x86-32/64 and ARM-32/64 disassembly). Grouping: binary, then signed/unsigned integer
  pairs by ascending width, then floats, then string, then date/time, then GUID, then
  disassembly.
- **Endianness.** One "Value" column. It follows the file's global endian setting
  (`View > Endian`, or the `LIT`/`BIG` toggle in the status bar) — "Most tools and the
  Inspector use this endian setting." No per-row control and no dual LE/BE columns.
- **Number formatting.** A *Column Display Format* menu switches the Value column between
  Hex, Decimal, Octal, Binary — panel-wide, not per row. Hex decoration is configurable
  (`FFh` / `0xFF` / `FF`). Date and time formats are configurable format strings.
- **Configurable type set.** Yes, and the most powerful of any tool here. "The different
  data types in Inspector may be reordered or deleted or your own custom data formats may
  be added" via right-click *Customize…* or the options dialog. It is backed by an editable
  `Inspector.bt` template: each row is a template-variable declaration preceded by
  `FSeek(pos)`, so structs, unions, enums and custom read functions can all be added.
- **Placement.** A dockable window; tabs move as a group by dragging the dock header, and
  individual tabs can be torn off into a floating window.
- **Near EOF.** Not documented; the template read simply fails and the row is left blank.
- **Text decode.** The built-in "String" row is ASCII only. Other encodings only via custom
  template additions.

---

## HxD

Primary sources: [HxD product page](https://mh-nexus.de/en/hxd/),
[hxd-plugin-framework implementation guidelines](https://github.com/maelh/hxd-plugin-framework/blob/master/Implementation%20guidelines.md),
mh-nexus forum threads
[t=89](https://forum.mh-nexus.de/viewtopic.php?t=89),
[t=916](https://forum.mh-nexus.de/viewtopic.php?t=916),
[t=966](https://forum.mh-nexus.de/viewtopic.php?t=966).

- **Types.** Binary (bit sequence), integer 8/16/32/64-bit signed and unsigned, float 32
  and 64, several date/time formats, character (ANSI/ASCII plus WideChar = UCS-2, with
  UTF-16 added later), GUID, and disassembly (x86-32 and AMD64). Varint decoding was added
  for Git use.
- **Endianness.** Byte-order **radio buttons** in the panel (little / big endian).
  Discussion and later behaviour allow showing a chosen order; the internal
  `ChangeByteOrder()` converts from the machine default (little, on x86).
- **Number formatting.** A "show integers in hexadecimal base" option toggles hex display
  for integer rows; when on, a hex converter also accepts hex input. Otherwise decimal.
- **Configurable type set.** The built-in list is fixed. It is extended through a documented
  **C plugin/DLL framework** (`maelh/hxd-plugin-framework`): a plugin supplies
  `BytesToStr()` / `StrToBytes()` converters for a custom datatype. Guidance there: bytes
  are passed in the architecture's preferred order (little on x86); "hexadecimal numbers
  should always be treated as unsigned, even for a signed integer type"; formatting is
  locale-aware.
- **Placement.** A dockable data-inspector panel (a side panel by default). Early design
  discussion weighed a floating/dockable window vs. a status-bar readout.
- **Near EOF.** Not clearly documented.
- **Text decode.** Character rows: ANSI/ASCII and wide char (UCS-2 / UTF-16).

---

## ImHex

Primary source:
[Data Inspector documentation](https://docs.werwolv.net/imhex/views/data-inspector)
([raw](https://raw.githubusercontent.com/WerWolv/Documentation/master/imhex/views/data-inspector.md)).

- **Types.** Unsigned and signed integers at **8, 16, 24, 32, 48, 64 bit**; float16 / 32 /
  64; LEB128; GUID; timestamps; string and various character encodings; more via scripts.
- **Endianness.** An **Endian** toggle (Little / Big) that "inverts the order of bytes
  before trying to decode it" — panel-wide.
- **Number base.** A **Format** control: Decimal / Hexadecimal / Octal, applied to numeric
  rows only.
- **Extra transform.** An **Invert** toggle bitwise-inverts every byte before decoding
  (`0xFA` → `0x05`).
- **Configurable type set.** Yes. Rows are hidden/shown individually via an **Edit** button
  with per-row **eye icons**. New rows are added in the **Pattern Language**: drop a
  `.hexpat` file in `%IMHEX_PATH%/scripts/inspectors` defining a `struct`, a formatter with
  the `format_read()` attribute, and a placement at the cursor (`$`) with an optional
  `[[name()]]`. Plugins can also add types.
- **Placement.** A dockable panel (ImGui docking — movable anywhere in the layout).
- **Near EOF / invalid.** "Not all decodings produce meaningful values, and invalid
  interpretations may be flagged."
- **Navigation.** Select a row, then Previous / Next steps through consecutive instances of
  that type in the file. Values are editable (double-click / context menu); context menu
  also offers copy and jump-to-address.
- **Text decode.** A String row plus multiple character encodings.

---

## Hex Fiend

Primary source: `app/sources/DataInspector.m` and
`app/sources/DataInspectorRepresenter.m` in
[HexFiend/HexFiend](https://github.com/HexFiend/HexFiend/blob/master/app/sources/DataInspector.m).

- **Types** (`enum InspectorType_t`): Unsigned Integer, Signed Integer, Floating Point,
  UTF-8 Text, Binary, SLEB128, ULEB128. Integer widths 1 / 2 / 4 / 8 bytes, plus a
  128-bit path. Float covers 2 (half), 4, 8, 10 (x87 80-bit) and 16 (IEEE-128) byte widths.
- **Row model.** Not a fixed exhaustive grid. The panel holds *N* rows you build; the
  **width is taken from the current selection length** (select 4 bytes → the integer row
  decodes 32-bit).
- **Endianness.** **Per-row.** `enum Endianness_t` (`eEndianBig`, `eNativeEndianness`, …);
  each row has a popup showing **le / be**, enabled for integer and floating-point rows.
- **Number base.** **Per-row.** `enum NumberBase_t` (`eNumberBaseDecimal`,
  `eNumberBaseHexadecimal`); popup **dec / hex**, enabled for integer rows only.
- **Formatting** (format strings from source): signed `"%" PRIdN`, unsigned `"%" PRIuN`,
  hex `"0x%" PRIXN` for N = 8/16/32/64; 128-bit rendered digit-by-digit with sign. Floats:
  half `"%.15g"`; float32 `"%.*g"` at `FLT_DECIMAL_DIG`; float64 `"%.*g"` at
  `DBL_DECIMAL_DIG`; 80- and 128-bit `"%.15Lg"` (shortest round-trip). Binary: 8 chars per
  byte. UTF-8: native string init.
- **Configurable type set.** Yes. Per-row **`+` / `-`** buttons (`addRow:` /
  `removeRow:`); each row independently sets type, endianness and base. Layout persists to
  `NSUserDefaults`; default is a single row. Panel height grows and shrinks with the row
  count.
- **Placement.** A bottom representer pane, part of the window layout (toggled from the
  View menu).
- **Near EOF / bad input.** Explicit messages: `(select some data)`,
  `(select more data)` [too few bytes for the type], `(select less data)` [over the
  editable max], `(select a power of 2 bytes)`, `(bytes are not valid UTF-8)`,
  `(select a contiguous range)`, `(internal error)`. An edit attempt on an error state
  beeps.
- **Text decode.** One UTF-8 row (other encodings live in separate text-column
  representers, not the inspector).

---

## GHex

Primary sources (gitlab.gnome.org/GNOME/ghex):
[`src/hex-dialog.c`](https://gitlab.gnome.org/GNOME/ghex/-/raw/master/src/hex-dialog.c),
[`src/converter.c`](https://gitlab.gnome.org/GNOME/ghex/-/raw/master/src/converter.c),
[`src/chartable.c`](https://gitlab.gnome.org/GNOME/ghex/-/raw/master/src/chartable.c),
[Launchpad bug 1851033](https://bugs.launchpad.net/bugs/1851033).

- **Types / order** (the "Conversions" panel, `HexDialog`): Signed 8 bit, Unsigned 8 bit,
  Signed 16 bit, Unsigned 16 bit, Signed 32 bit, Unsigned 32 bit, Signed 64 bit,
  Unsigned 64 bit, Float 32 bit, Float 64 bit, Hexadecimal, Octal, Binary. Plus a
  **Stream Length** spinner.
- **Endianness.** One checkbox, **"Show little endian decoding"**, default on; unchecked →
  big endian. Panel-wide.
- **Number formatting.** Checkbox **"Show unsigned and float as hexadecimal"** → unsigned
  ints in `0x%0NX` and floats via `%A`; otherwise decimal. Signed ints always decimal
  (two's complement). 64-bit via `%lld` / `%llu`. Float default `%e` (scientific).
- **Configurable type set.** No — fixed row list. Two *separate* dialogs exist: a **Base
  Converter** (`converter.c`) for free-form Binary / Octal / Decimal / Hex / ASCII
  conversion, toggled by the `ghex.converter` action as a floating dialog; and a
  **Character Table** (`chartable.c`) listing 0–255 as ASCII / hex (`%02X`) / decimal
  (`%03d`) / octal (`%03o`) / binary.
- **Placement.** A side panel that slides in (`conversions_revealer` / sidebar). The Base
  Converter is a separate floating dialog.
- **Near EOF.** Governed by Stream Length; with fewer bytes available the output is
  proportionally truncated (it decodes whatever bytes exist).
- **History.** The 64-bit rows showed only the low 32 bits until GHex 3.41.1 — a
  cautionary tale about 64-bit handling in a language without native wide ints.
- **Text decode.** None in the conversions panel; only the byte's ASCII in the Character
  Table.

---

## hexyl

Primary sources (sharkdp/hexyl):
[README](https://github.com/sharkdp/hexyl/blob/master/README.md),
[man page](https://raw.githubusercontent.com/sharkdp/hexyl/master/doc/hexyl.1.md),
[CHANGELOG](https://raw.githubusercontent.com/sharkdp/hexyl/master/CHANGELOG.md).

- **No data inspector.** hexyl is a one-shot CLI dump with no cursor and no typed decode.
- Byte **colour categories** only: NULL, ASCII printable, ASCII whitespace, other ASCII,
  non-ASCII (each an env-var-tunable colour).
- Related whole-dump options: `--group-size` (xxd-style grouping),
  `--endianness={little,big}` (byte order *within* a group in the hex panel),
  `--base={binary,octal,decimal,hexadecimal}` (base of the hex panel), `--block-size`.
  None decode a typed value at a position.
- **Relevance to #52:** the "ship without an inspector" baseline — a read-only viewer can
  legitimately omit the feature.

---

## VS Code Hex Editor (also relevant)

Primary sources (microsoft/vscode-hexeditor):
[`media/editor/dataInspectorProperties.tsx`](https://github.com/microsoft/vscode-hexeditor/blob/main/media/editor/dataInspectorProperties.tsx),
`media/editor/dataInspector.tsx`, README.

- **Types / order** (from `inspectTypesBuilder`): binary (of the byte, 8 digits), octal
  (of the byte, 3 digits), uint8, int8, uint16, int16, **uint24, int24**, uint32, int32,
  uint64, int64, **ULEB128, SLEB128**, **float16, bfloat16**, float32, float64, **GUID**,
  then text decoders: ASCII, UTF-8, UTF-16 (with a `utf-16be` alt for big endian),
  GB18030, Big5, ISO-2022-KR, Shift-JIS. Each text row shows the first decoded character.
- **Endianness.** One **"Little Endian" checkbox** at the foot of the panel, applied to all
  rows. Default set by `hexeditor.dataInspector.defaultEndianness`; the choice is
  persisted.
- **Number formatting.** No base toggle beyond the fixed binary/octal rows. Integers
  decimal; uint64 / int64 via `BigInt` (no precision loss); floats via JS `toString()`
  (shortest round-trip).
- **Configurable type set.** No — the list is fixed and not user-reorderable or hideable.
- **Placement.** `hexeditor.inspectorType` = `aside` (default, right of the grid) |
  `hover` (tooltip on cell hover) | `sidebar` (Activity Bar view). The view can be dragged
  by its hex icon to other panels. `hexeditor.dataInspector.autoReveal` gates the sidebar
  auto-show.
- **Near EOF.** Every type carries a `minBytes`; when `target.length < minBytes` the value
  cell renders the text **"End of File"** at reduced opacity — row stays visible, no error.
- **Text decode.** ASCII, UTF-8, UTF-16, GB18030, Big5, ISO-2022-KR, Shift-JIS (whatever
  the platform `TextDecoder` supports).

---

## Okteta (also relevant)

Primary sources:
[`doc/index.docbook`](https://raw.githubusercontent.com/KDE/okteta/master/doc/index.docbook),
[KDE UserBase: writing structure definitions](https://userbase.kde.org/Okteta/Writing_structure_definitions).

- **"Decoding Table" tool.** Decodes the byte(s) at the cursor into "common simple data
  types like Integer or Float, but also UTF-8": signed/unsigned 8/16/32/64-bit integers,
  float, double, char, plus base views of the byte. Double-click a row to edit the value.
- **Endianness.** Okteta has a document-wide **Byte order** setting (Little / Big) that the
  decoding table follows.
- **Configurable.** Rows can be shown/hidden. A separate **Structures** tool does full
  templated parsing (`int8()`…`uint64()`, `float()`, `double()`, and `-be` / `-le`
  primitive suffixes).
- **Placement.** A dockable tool view: docks in a sidebar or floats as a window.
- **Near EOF.** Not documented.
- **Text decode.** A Char row with a selectable charset (ASCII, various 8-bit, EBCDIC) plus
  a UTF-8 row.

---

## wxHexEditor (brief)

Secondary description only (project docs are thin): a left-hand **data interpreter** panel
converting the selection to 8/16/32/64-bit signed and unsigned integers, float32, float64
and binary, with a **little / big endian toggle** beside it. Fixed type set.

---

## Comparison

| Tool | Row model | Endianness control | Number base | Type set editable | Panel | Near-EOF | Text row |
|---|---|---|---|---|---|---|---|
| 010 Editor | fixed grid (all widths) | global file endian, 1 Value column | panel-wide Hex/Dec/Oct/Bin | yes — editable `Inspector.bt` template | dockable, tear-off | undefined / blank | ASCII string |
| HxD | fixed grid | radio buttons LE/BE | hex toggle for ints | via C plugin DLL | dockable side panel | undefined | ANSI + wide (UCS-2/UTF-16) |
| ImHex | fixed grid (8/16/24/32/48/64) | panel toggle LE/BE (+ Invert) | panel Dec/Hex/Oct | yes — per-row hide + pattern-language scripts | dockable (movable) | invalid flagged | string + many encodings |
| Hex Fiend | N user rows; width from selection | **per-row** le/be | **per-row** dec/hex | yes — `+`/`-` rows | bottom pane, auto-height | explicit `(select more data)` etc. | UTF-8 |
| GHex | fixed grid | 1 checkbox "little endian decoding" | 1 checkbox "unsigned/float as hex" | no | slide-in side panel | proportional truncation | none (ASCII in Char Table) |
| hexyl | — none — | (dump-wide only) | (dump-wide only) | — | — | — | — |
| VS Code | fixed grid (+24-bit, LEB128, f16) | 1 "Little Endian" checkbox | none (fixed bin/oct rows) | no | aside / hover / sidebar, draggable | greyed "End of File" | ASCII, UTF-8/16, CJK codepages |
| Okteta | fixed grid | document Byte order setting | base views of byte | rows hideable | dockable / floating | undefined | Char (charset) + UTF-8 |

### Common baseline (present in essentially every inspector)

- **Signed and unsigned integers at 8 / 16 / 32 / 64 bit**, shown as signed/unsigned pairs
  in ascending width order.
- **float32 and float64.**
- **A little/big-endian control**, little-endian default.
- **Decimal display by default**, with hex available for integers in most tools.
- **Cursor-driven**, updating as the caret moves; sits in a **docked panel** (bottom or
  side).
- 64-bit values shown in full (learn from GHex's truncation bug — use a wide/bignum path).
- Float shown at shortest round-trip precision (`%.*g` with `*_DECIMAL_DIG`, or the
  language's default `toString`).

### Where tools diverge

- **Row model.** Fixed exhaustive grid (010, HxD, ImHex, GHex, VS Code, Okteta, wxHexEditor)
  vs. a few user-built rows whose width comes from the *selection length* (Hex Fiend).
- **Endianness scope.** Per-row (Hex Fiend) — panel-wide toggle (ImHex, GHex, VS Code, HxD)
  — bound to the global file/document endianness (010, Okteta).
- **Number base scope.** Per-row (Hex Fiend) — panel-wide (010, ImHex, HxD/GHex hex
  checkbox) — fixed, no toggle (VS Code).
- **Extensibility.** Scripting/templates (010 `Inspector.bt`, ImHex pattern language),
  binary plugins (HxD DLLs), row hide/show only (ImHex, Okteta), or nothing (GHex,
  VS Code, Hex Fiend beyond built-ins).
- **Extended types.** half/bfloat16 (ImHex, VS Code, Hex Fiend); 24/48-bit (ImHex,
  VS Code); LEB128 (ImHex, VS Code, Hex Fiend); GUID (010, HxD, ImHex, VS Code);
  timestamps (010, HxD, ImHex); disassembly (010, HxD, ImHex).
- **Near-EOF behaviour.** Muted placeholder, row kept (VS Code "End of File") — explicit
  message (Hex Fiend) — invalid flag (ImHex) — undefined/blank (010, HxD, Okteta) —
  partial decode (GHex). No tool errors hard or hides the row.
- **Text decode.** ASCII everywhere it exists; UTF-8 (Hex Fiend, ImHex, VS Code, Okteta);
  UTF-16 (HxD, ImHex, VS Code); CJK codepages (VS Code); 010's string row is ASCII only.

## Recommendation for bint2 (read-only browser hex viewer)

A minimal-but-complete inspector for a read-only viewer:

1. **Rows (fixed list, no editing in v1):** int8/16/32/64 signed and unsigned, then
   float32, float64. Optionally float16. This is the irreducible core every tool shares.
   A `binary` row for the single byte at the cursor is a cheap, common extra.
2. **One panel-wide endianness toggle** (LE default, remembered across sessions). Per-row
   endianness (Hex Fiend) is overkill for a browser viewer; binding to a global "file
   endianness" (010) only makes sense if bint2 grows one.
3. **Decimal by default, one panel-wide "hex" toggle** for the integer rows. Skip octal.
4. **64-bit via BigInt** so values never truncate (GHex shipped that bug for years).
   **Floats** at shortest round-trip precision, exponential for very large/small magnitudes.
5. **One text row: UTF-8** (first char or a short run). ASCII is a reasonable second. Skip
   codepages and UTF-16 unless a concrete need appears.
6. **Near-EOF:** when fewer bytes remain than the type needs, show a muted placeholder
   (`--` or "end of file"), keep the row visible, never throw. This is the VS Code model
   and it is the gentlest.
7. **Placement:** a docked, collapsible side or bottom panel, cursor-driven. Making it
   movable is a nice-to-have, not essential for v1.
8. **Configurability:** a static list is fine to start. If any is added, copy ImHex's
   per-row eye-icon hide/show. Scripting and plugins are out of scope for a browser viewer.
9. **Nice-to-haves:** click-to-copy a decoded value; show the cursor's byte offset and how
   many bytes each row consumed.
10. **Explicitly out of scope for v1:** timestamps, GUID, disassembly, LEB128, 24/48-bit
    widths, .NET decimal. Add later only on concrete demand.
