# Phase 1.5 — the Inspector, byte order, and non-ASCII text

Goal: three reader-facing additions to the shipped phase-1 viewer, and the one
storage seam they share. Phase 1.5 stays a **read-only** viewer — no editing, no
writing bytes back, no Web Worker (still evidence-gated, unchanged from
[ADR-0001](adr/0001-bytesource-boundary-and-deferred-worker.md)), no derived work
— and ships to GitHub Pages at completion, the same as phase 1.

> **Status.** Decision-complete. Every design choice below is settled by a closed
> wayfinder ticket on map [#51](https://github.com/carllom/bint2/issues/51); the
> tickets are authoritative where they carry more detail than this prose. What
> remains is milestone execution (§9).

## 1. What phase 1.5 adds

| Addition | One line | Ticket |
|---|---|---|
| **Inspector** | A docked **Panel** decoding the bytes at the Cursor into every primitive numeric type at once — `u8 i8 bin` / `u16 i16` / `u32 i32` / `u64 i64` / `f32 f64` — read on demand, never spoken. | [#54](https://github.com/carllom/bint2/issues/54) |
| **Byte order** | One persisted, hotkeyed, **view-wide** little-endian/big-endian setting that governs every multi-byte numeric decode of the document. | [#55](https://github.com/carllom/bint2/issues/55) |
| **Non-ASCII text** | A persisted, **view-wide** *code page* for the char column — a swappable 256-entry glyph table, strictly one glyph per byte. Six ship. | [#56](https://github.com/carllom/bint2/issues/56) |
| **`preferences` store** | The `localStorage`-backed Pinia store all three settings persist through. Introduced by the Inspector, extended by the other two. | [#54](https://github.com/carllom/bint2/issues/54) |

Two research tickets fed these: [#52](https://github.com/carllom/bint2/issues/52)
(data-inspector designs in comparable hex tools — `docs/research/data-inspector-designs.md`)
and [#53](https://github.com/carllom/bint2/issues/53) (`TextDecoder` support and a
minimal encoding set — `docs/research/text-encodings.md`).

### Guardrails carried from phase 1

- **`src/core` stays framework-free** and mechanically enforced (the eslint
  override + `framework-free.spec.ts`). The code-page tables and their pure
  lookup live here; Pinia stores and Vue components do not.
- **`viewport.ts` and `PageCache` stay frozen.** Nothing in 1.5 touches
  coordinate math or paging: the Inspector is a point read of ≤ 8 bytes that the
  frozen `ByteSource` already serves ([#13](https://github.com/carllom/bint2/issues/13)),
  and a code page changes only which glyph a resident byte paints as.
- **`render(view)` is not widened.** The element *grid* — rendering the
  document's rows as elements rather than bytes — is **not** in 1.5 (§10). The
  Inspector leaves the document's rendering byte-oriented.
- **No code path branches on file size.**

## 2. The `preferences` store — `src/stores/preferences.ts`

The shared seam. A Pinia store persisting a single JSON object to **one
`localStorage` key, `bint2:preferences`** — namespaced because GitHub Pages
serves every project from the shared `carllom.github.io` origin.

| Field | Type | Default | Setter | Ticket |
|---|---|---|---|---|
| `collapsed` | `boolean` | `false` | `setCollapsed` | #54 |
| `dock` | `'bottom' \| 'right'` | `'bottom'` | `setDock` | #54 |
| `intHex` | `boolean` | `false` | `setIntHex` | #54 |
| `byteOrder` | `'le' \| 'be'` | `'le'` | `setByteOrder` | #55 |
| `codePage` | `'ascii' \| 'cp437' \| 'windows-1252' \| 'petscii' \| 'petscii-lower' \| 'akai'` | `'ascii'` | `setCodePage` | #56 |

- Explicit named setters, each calling a private `persist()` that rewrites the
  whole object as JSON on every change.
- **Loaded once on init with per-field validation**: each field is checked
  against its type / allowed set, and anything invalid *or missing* falls back to
  its default. **No version stamp, no migration machinery** — per-field
  validation covers both a key a future version adds and a value it changes.
  Versioning is added later only for a real migration.
- Malformed JSON → all defaults, the next `persist()` overwrites. `localStorage`
  throwing → session-only preferences with one `console.warn`, nothing
  user-facing. Unknown keys ignored on load, dropped on next write.
- **No injected storage seam** — tests use the real happy-dom `localStorage`,
  cleared between cases.
- String literals (`'le'`/`'be'`, the `codePage` union) over booleans/enums so
  the stored JSON and bug reports read plainly.

## 3. The Inspector ([#54](https://github.com/carllom/bint2/issues/54))

### 3.1 Nature & placement

- A distinct **Panel** — a named app-shell region docked to a Viewport edge,
  holding one tool. Built as a **one-off in a named `HomeView` layout slot**, not
  a panel framework (the framework is fog — §10).
- **Two dock slots, one at a time:** a **bottom strip** (full width, above the
  status bar) or a **right-side column**. `dock` preference, default `bottom`.
  The empty slot renders nothing.
- Bottom strip lays its rows out **horizontally and wraps to multiple rows** on a
  narrow screen (flex/grid); the right column **stacks rows vertically**.
- **Visible whenever a document is open; hidden entirely when none is.**
- **Collapsible** to a thin bar (label `inspector` + expand chevron, click
  anywhere on the bar to expand); `collapsed` persisted.
- **Read-on-demand, never a live region.** Values update silently as the Cursor
  moves — the Viewport's cursor live region (ADR-0005) already speaks position
  and byte.

### 3.2 Rows — fixed list, all visible in v1

Top to bottom, a hairline between groups:

| Group | Rows |
|---|---|
| 1 | `u8`  `i8`  `bin` — unsigned, signed two's-complement, 8 binary digits |
| 2 | `u16` `i16` |
| 3 | `u32` `i32` |
| 4 | `u64` `i64` — via `BigInt` |
| 5 | `f32` `f64` |

- Terse lowercase labels; each row carries a full `aria-label` / `title`
  ("unsigned 16-bit integer").
- **No `f16`.** **No text line** — the char column owns glyph rendering (§5),
  which is why [#56](https://github.com/carllom/bint2/issues/56)'s "does the
  Inspector gain an 'as <code page>' line?" is answered *no*.
- **Per-row hide is deferred** to a future preferences page (§10).

### 3.3 Formatting

- Integers **decimal by default**; one panel-wide **`hex` toggle** (persisted,
  `intHex`) affecting only the eight integer rows. No octal.
- In hex mode, signed rows show the **raw N-byte pattern, unsigned**, zero-padded
  to type width (`u16`/`i16` → 4, `u32`/`i32` → 8, `u64`/`i64` → 16 hex digits).
  `toHex` already does this — minimum width, no mask
  ([#13](https://github.com/carllom/bint2/issues/13) pinned it).
- Floats via JS `String(value)` — shortest round-trip, auto-exponential at
  extremes. `NaN` / `Infinity` / `-Infinity` shown literally.
- The `bin` row is always 8 binary digits; unaffected by the `hex` toggle **and**
  by byte order.

### 3.4 States

| State | Value column | Mechanism |
|---|---|---|
| **Not enough bytes** (near EOF) | dim `—`, row stays in place, never throws | short read at EOF ([#13](https://github.com/carllom/bint2/issues/13)) |
| **Bytes not yet resident** (e.g. just after a Goto) | `··` (the grid's pending glyph), repaints on arrival | **`useBytesAt(source, offset, length)`** — a generalisation of `useByteAt`: `readSync` when the whole run is resident, guarded async `read` fallback with the same identity-based staleness guard |
| **No Cursor yet** (document open, no click) | every value column `—` | — |

### 3.5 Panel header controls

A small segment (left of the fields in the bottom strip; above the stack in the
right column):

- **Collapse toggle** — chevron button, `aria-expanded`.
- **Dock toggle** — one icon-button flipping bottom ↔ right; persisted.
- **`hex` toggle** — labelled; persisted.
- **No** cursor-offset readout (the status bar's `cur` owns it). **No**
  Inspector-specific hotkeys in v1. The byte-order control and hotkey are
  [#55](https://github.com/carllom/bint2/issues/55)'s, on the main toolbar — not
  this panel's header.

### 3.6 Copy a decoded value

- Each row's **value is a `<button>`**; click or Enter/Space copies its
  currently-displayed text (respecting `hex` and byte order) via
  `navigator.clipboard.writeText`. Rows showing `—` / `··` are `disabled`.
- Confirmation ("Copied `u32` value") routes through the **existing** action live
  region + status slot in `StatusBar` ([#28](https://github.com/carllom/bint2/issues/28),
  ADR-0005) — no new surface. See §4.4 on the `actionStatus` rename.

### 3.7 Accessibility

- `<section role="region" aria-label="Cursor inspector">`. Nothing `aria-live`.
- Tab order: **viewport → inspector → status bar**, in DOM order regardless of
  the visual dock side.
- Collapsing keeps focus on the toggle (which becomes the expand control).

### 3.8 Status bar change

The status bar **loses its `u8 / i8 / bin` group** — absorbed into the Inspector.
It keeps `cur`, `sel`, the action/copy status, and the document identity. Nothing
is shown in both places.

## 4. Byte order ([#55](https://github.com/carllom/bint2/issues/55), [ADR-0007](adr/0007-byte-order-is-one-view-wide-setting.md))

**Byte order is one view-wide setting**, default **little-endian**. Not per-row,
not panel-local, not auto-detected from the file — the alternatives and their
rejections are in ADR-0007.

### 4.1 Control & placement

- A `<fieldset>` **radio segment** mirroring `BytesPerRowControl` —
  `Byte order: (·) LE  (·) BE` — in the main toolbar, immediately after the
  bytes-per-row control.
- Options labelled `LE` / `BE`, each with a full `aria-label`
  (`little-endian` / `big-endian`).
- Likely becomes a button group once a component library lands (already in the
  map's "Panel family + component library" fog — §10); the radio segment is the
  one-off until then.

### 4.2 Hotkey

- **Plain `b`** (mnemonic: *byte order*), no modifier — flips LE ↔ BE.
- Handled in **`HexViewer`'s existing viewport keydown handler**, alongside the
  cursor keys — active only while the byte grid has focus, so it never fires
  while typing in the Goto box. No conflict with the taken chords (arrows /
  PageUp·Down / Home·End / `Ctrl+G` / `Ctrl+C` / `Ctrl+Alt+C`, `Ctrl+Shift+*`).
- Documented in the viewport's `#hex-viewer-usage` note ("Press B to switch byte
  order.") and the README hotkey list.

### 4.3 Announcement

- Through the **existing action live region** (ADR-0005) — no new element.
- Wording: `Byte order: little-endian` / `Byte order: big-endian`.

### 4.4 `actionStatus` rename

Two features now feed the action-status slot (Inspector row-value copy per §3.6,
and this), so the store's `copyStatus` holder is renamed to the neutral
**`actionStatus`**. The copy path keeps its "cleared when the Selection moves"
watch; the byte-order message is a plain transient set with no such watch.

### 4.5 What it governs

- **Phase 1.5 (now):** the Inspector's multi-byte numeric rows —
  `u16 i16 u32 i32 u64 i64 f32 f64` — via the single value column (§3.2).
  Toggling re-decodes every multi-byte row. The width-1 rows (`u8 i8 bin`) are
  order-independent and unaffected.
- **Principle for later:** the setting governs *every multi-byte numeric decode
  of the document's bytes* — the future element grid, future decode features —
  i.e. anything that reads an **Element** (which by `CONTEXT.md` needs a width
  *and* a byte order).

### 4.6 What it never touches

The char column, raw-text copy ([#30](https://github.com/carllom/bint2/issues/30),
UTF-8), hex copy ([#25](https://github.com/carllom/bint2/issues/25)), the offset
column, the `bin` row, and `u8` / `i8` — all byte- or text-oriented, with no
order to choose.

## 5. Non-ASCII text — code pages ([#56](https://github.com/carllom/bint2/issues/56))

The char column gains a **code page**: a view-wide, persisted 256-entry
`byte → glyph` table. Strictly **one glyph per byte** — no multi-byte decoding
(§10, Out of scope). This is the mirror image of byte order: it governs *only*
the char column's glyphs and touches no numeric decode, where byte order governs
every numeric decode and never the char column ([ADR-0007](adr/0007-byte-order-is-one-view-wide-setting.md)).

### 5.1 The six code pages that ship

| Stored value | `<select>` label | Source of truth |
|---|---|---|
| `ascii` *(default)* | ASCII | `0x20`–`0x7E` verbatim, everything else the placeholder — today's `toAsciiChar` behaviour, now one entry in the list |
| `cp437` | CP437 (DOS) | The **full hardware glyph set** — all 256 values have a glyph: `0x00`–`0x1F` are `☺☻♥♦♪…`, `0x7F` is `⌂`, no placeholder ever. Hand-adjusted from the Unicode `CP437.TXT` (whose `0x00`–`0x1F` are C0 controls) |
| `windows-1252` | Windows-1252 | WHATWG/Unicode index; its 5 unassigned slots (`0x81 0x8D 0x8F 0x90 0x9D`) render the placeholder |
| `petscii` | PETSCII (graphics) | C64 **unshifted** (uppercase/graphics) set, screen-code glyphs; control ranges `0x00`–`0x1F` / `0x80`–`0x9F` render the placeholder. Reconstructed from Commodore ROM glyphs |
| `petscii-lower` | PETSCII (lowercase) | C64 **shifted** (lowercase/uppercase) set; same control-range treatment |
| `akai` | AKAI | AKAI-sampler ASCII variant; ported from the requester's existing C# implementation, cited in the module header |

Options render in the order above; ASCII first as the default and the familiar
one, the two PETSCII rows adjacent.

**Deferred, add on request** (each is one more table): `iso-8859-15`, DEC Special
Graphics, other machines'/modes' PETSCII, and the legacy multi-byte CJK decoders.

### 5.2 Non-renderable bytes

- **Each table is a full 256-entry map and decides its own bytes** — including
  whether `0x00`–`0x1F` are control-pictures (CP437) or not (ASCII, PETSCII).
- A **single shared placeholder glyph — `.`, unchanged from today** — covers only
  the genuine holes a table leaves unmapped (windows-1252's 5 slots). ASCII's
  `.` for the control / high-bit range is ASCII's *own* table entry, not a
  separate fallback mechanism.
- **No** hexyl-style per-category marks (control vs unassigned vs non-ASCII) in
  1.5.

### 5.3 Selector, persistence, scope

- A **toolbar `<select>`** in `HomeView` (`data-region="toolbar"`), beside
  `BytesPerRowControl` and the byte-order segment.
- Persisted as `codePage` on the `preferences` store (§2) — same
  `bint2:preferences` key, per-field validation mapping anything unrecognised →
  `'ascii'`.
- **No hotkey** in 1.5 (a six-way list doesn't cycle cleanly on one key; revisit
  if a command palette lands).
- **One view-wide setting** — not per-Selection, per-Annotation, or per-file.
  Identical treatment to byte order.

### 5.4 What it never touches

- **The Inspector** — no text line ([#54](https://github.com/carllom/bint2/issues/54)); nothing there consumes a code page.
- **Raw-text copy** ([#30](https://github.com/carllom/bint2/issues/30)) — stays
  **UTF-8**. It targets embedded strings; a code page is a display lens, not a
  re-encoding.
- **Hex copy** ([#25](https://github.com/carllom/bint2/issues/25)) and the
  **offset column** — byte-oriented, no glyph involved.
- **The spoken cursor announcement** (`describeSelection`,
  [#27](https://github.com/carllom/bint2/issues/27) / ADR-0005) — stays ASCII via
  the existing `toAsciiChar`, independent of the code page. Box-drawing / PETSCII
  glyphs read aloud are noise, and ADR-0005 keeps the grid a non-document: the
  announcement is a byte-identity aid, not a text rendering.

So the code page changes **only the visible char column's glyphs**.

### 5.5 Implementation shape

- Tables + a pure `charFor(byte, codePage)` lookup in **`src/core`**, one
  hand-authored module per table under **`src/core/codepages/`**, each exporting a
  frozen 256-entry `readonly string[]` (or a packed 256-char string literal) with
  a source-of-truth citation in its header comment. **No** build-time codegen,
  **no** data files in the repo.
- **Review story = the `format.spec.ts` precedent**: each table gets a spec with
  `it.each` rows pinning the load-bearing and boundary entries (`0x00 0x1F 0x20
  0x7F 0x80 0xA0 0xFF` plus the table's signature glyphs — `0xC9 → ╔` for CP437,
  the PETSCII graphics block, AKAI's deviations from ASCII), not all 256.
- `codePage` *selection state* lives in the `preferences` store;
  `DomHexRenderer.render` reads it off the `view` object it is already handed
  (the same route `byteOrder` takes to the renderer later) and calls `charFor` in
  place of `toAsciiChar`. `toAsciiChar` stays as-is — it *is* the ASCII table's
  implementation and the live region's.

## 6. Boundary matrix — what each setting reaches

| Surface | Byte order | Code page |
|---|---|---|
| Inspector `u16`–`f64` value column | **governs** | — |
| Inspector `u8` / `i8` / `bin` | no (width-1) | — |
| Char column glyphs | never | **governs** |
| Offset column | never | never |
| Hex copy ([#25](https://github.com/carllom/bint2/issues/25)) | never | never |
| Raw-text copy ([#30](https://github.com/carllom/bint2/issues/30)) | never (stays UTF-8) | never (stays UTF-8) |
| Spoken cursor announcement | never | never (stays ASCII) |
| Future element grid / semantic decodes | governs (anything reading an **Element**) | never |

## 7. `CONTEXT.md` and ADRs

All applied on the stacked wayfinder branches; **nothing is owed here**.

| Change | Where | Branch (commit) |
|---|---|---|
| **Inspector** term rewritten (in scope; primitive numeric rows; on demand, not spoken; glyphs left to the char column); new **Panel** term | `CONTEXT.md` | `wayfinder/54-inspector-context` (`110793c`) |
| New **Byte order** term (`_Avoid_`: *endianness* as the name, *LE/BE* in prose) | `CONTEXT.md` | `wayfinder/55-byte-order` (`c376425`) |
| **ADR-0007 — "Byte order is one view-wide setting"** | `docs/adr/0007-…` | `wayfinder/55-byte-order` (`c376425`) |
| New **Code page** + **Char column** terms; a paragraph in ADR-0007 noting the code page mirrors byte order's shape | `CONTEXT.md`, `docs/adr/0007-…` | `wayfinder/56-code-page` (`8c2fc4d`) |

**No ADR for the Inspector Panel** (reversible, unsurprising) and **no separate
ADR for the code page** (the one-view-wide-setting trade-off is ADR-0007's, and
the code page follows it).

## 8. Testing

Same three-seam order as phase 1 (`docs/plan-phase1.md` §11) — prefer the highest
seam that can observe the behaviour.

**1. Application shell mounted whole** (the top seam, existing injectable
`ByteSource` factory):

- Inspector: every row's decoded value for a known byte window at a given Cursor;
  the `hex` toggle across the eight integer rows; the byte-order toggle
  re-decoding the multi-byte rows and leaving `u8 i8 bin` fixed; the three states
  (`—` near EOF via the *synthetic* source at `size = 2e9`, `··` pending then
  repaint on arrival via the *default* source with controlled timing, `—`
  no-Cursor); row-value copy success wording through `actionStatus`; disabled
  copy buttons on `—` / `··`; dock flip and collapse/expand with focus retention;
  tab order viewport → inspector → status bar.
- Byte order: the toolbar segment and the `b` hotkey both flipping the setting
  and only firing with the grid focused (not in the Goto box); the announcement
  wording; persistence across a remount.
- Code page: the `<select>` changing the char column's glyphs for a known byte
  window under each of the six pages; the shared `.` for windows-1252's holes;
  CP437 showing `☺`/`╔` where ASCII shows `.`; the spoken announcement staying
  ASCII while the visible column changes; raw-text copy staying UTF-8; persistence
  across a remount.
- `preferences` store: per-field validation (missing key, wrong type,
  out-of-set value → default) for all five fields; malformed JSON → all defaults;
  `localStorage` throwing → session-only + one warn; unknown keys dropped on
  write.
- Status bar: the `u8 / i8 / bin` group is gone; `cur` / `sel` / document
  identity remain.

**2. Pure core, direct unit tests** — the six code-page tables
(`src/core/codepages/*.spec.ts`, `it.each` boundary + signature rows) and
`charFor`; any new pure numeric-decode helper the Inspector needs beyond
`format.ts`.

**3. Playwright e2e** — deliberately thin, following phase 1's line. One added
journey: open the ~8 MB fixture, move the Cursor, read an Inspector row, press
`b`, see the value change; switch the code page and see the char column change.
No new large-file or dead-source e2e.

**Deliberately not automated:** the exact glyph shapes of the retro tables beyond
the pinned signature entries (visual, low-value); screen-reader output (the
manual NVDA pass already covers the announcement, which is unchanged in
substance).

## 9. Milestones

Execution only — every design choice above is already settled. To be broken out
into tracked build issues.

| # | Deliverable |
|---|---|
| **P1.5-M1** | `preferences` store (`src/stores/preferences.ts`) with all five fields, per-field validation, the failure modes, unit-tested. No UI yet. |
| **P1.5-M2** | The **Inspector** Panel: `HomeView` layout slot, both docks, collapse, the fixed rows, `useBytesAt`, decimal/`hex` formatting, the three states, row-value copy through `actionStatus` (rename `copyStatus` here). Status bar loses `u8/i8/bin`. Reads byte order from the store but the control comes in M3. |
| **P1.5-M3** | **Byte order**: the toolbar radio segment, the `b` hotkey in `HexViewer`, the announcement, `#hex-viewer-usage` + README updates. Inspector multi-byte rows now re-decode on toggle. |
| **P1.5-M4** | **Code pages**: `src/core/codepages/` (six tables + `charFor`), table specs, the toolbar `<select>`, `DomHexRenderer` reading `codePage` off `view`. README "Using it" + "What it does not do" updates. |
| **P1.5-M5** | e2e journey addition; final README pass; deploy to GitHub Pages. |

M2–M4 are independent once M1 lands and may be built in any order; M3 and M4 each
depend only on the store.

## 10. Out of scope

Carried from map [#51](https://github.com/carllom/bint2/issues/51). These do not
graduate within this effort — they return only if a later phase redraws the
destination.

- **The element grid** — rendering the document's rows *as* elements rather than
  bytes. The `render(view)` rewrite is sanctioned in advance
  ([#13](https://github.com/carllom/bint2/issues/13),
  [#11](https://github.com/carllom/bint2/issues/11)) but not done here; it
  graduates when the Inspector has shipped and there is demand.
- **Anchor offset** — elements anchored somewhere other than file offset 0 (e.g.
  after a header). The over-read retrofit is already local to `HexViewer`'s
  `read(docRow)` closure.
- **Semantic decodes** — Unix / FILETIME / DOS timestamps, GUID, LEB128 /
  varint, RGBA — beyond the primitive numerics the Inspector starts with.
- **Panel family + component library** — search-results, decoding, and
  marked-selection panels; a later migration to a docking / component library.
  The Inspector is a one-off in a named layout slot against this.
- **Preferences page** — graduates when there is a screenful of settings to host;
  the `preferences` store is the seam that keeps it cheap. Per-row Inspector hide
  waits for it.
- **Multi-byte / variable-width text encodings** — UTF-8 multi-byte sequences
  rendered in the grid, UTF-16, legacy CJK (`shift_jis`, `gbk`, `big5`, …). The
  char-column work is **single-byte code-page tables only**, one glyph per byte.
  Raw-text copy stays UTF-8. The variable-width survey in
  [#53](https://github.com/carllom/bint2/issues/53) is context, not scope.
- **Persist the last-opened file across reload** — needs a re-openable handle
  (Chromium-only) or an IndexedDB handle store; unrelated to decoding. Its own
  future effort.
- **Hex editing / writing bytes back** — carried out from phase 1.
- **Web Worker** — still evidence-gated (the M8 perf pass came back clean); phase
  1.5 does not reopen it.
- **Derived work** — search, entropy maps, streaming decode. Phase 2, with its
  own worker-crossing interface ([#9](https://github.com/carllom/bint2/issues/9)).

## 11. Decisions, ratified

Each row is a closed wayfinder ticket; open its link for the full reasoning.

| Decision | Ticket |
|---|---|
| `TextDecoder` ships ~40 decoders free and identically across Chrome/Edge/Firefox; single-byte glyph tables fit the existing one-glyph-per-byte path unchanged; CP437 / PETSCII / DEC each need a hand-rolled ~256-entry table | [Research: TextDecoder encoding support and a minimal encoding set](https://github.com/carllom/bint2/issues/53) |
| Data-inspector baseline: sign pairs int8..64 + f32/f64, one panel-wide LE/BE toggle (LE default), decimal default + hex toggle, 64-bit via `BigInt`, near-EOF muted placeholder that keeps the row, docked collapsible panel; timestamps / GUID / disassembly / scripting out | [Research: data-inspector designs in comparable hex tools](https://github.com/carllom/bint2/issues/52) |
| The Inspector is a docked **Panel** (bottom/right dock, collapsible, read-on-demand), fixed numeric rows `u8 i8 bin` … `f32 f64`, **no text line**, decimal + panel-wide `hex`, one value column driven by the view-wide byte order, three empty states, row-value copy through the existing action region, new `preferences` store | [The Inspector: panel, decodes, and states](https://github.com/carllom/bint2/issues/54) |
| Byte order is **one view-wide setting**, default little-endian; toolbar radio segment + plain `b` hotkey; announced through the existing action region; `byteOrder` on the `preferences` store; governs every multi-byte numeric decode and never the char column / copies / offsets; **ADR-0007** | [Byte order: a persisted, hotkeyed, view-wide setting](https://github.com/carllom/bint2/issues/55) |
| The char column gains a view-wide, persisted **code page** — one glyph per byte; **six ship** (`ascii` default, `cp437`, `windows-1252`, `petscii`, `petscii-lower`, `akai`); full 256-entry tables + one shared `.` for holes; changes only the visible char column; toolbar `<select>`, `codePage` on the `preferences` store, no hotkey; hand-authored `src/core/codepages/` modules, `it.each` specs; new **Code page** + **Char column** terms, no new ADR | [Non-ASCII text: the char column, raw-text copy, and the Inspector text line](https://github.com/carllom/bint2/issues/56) |
