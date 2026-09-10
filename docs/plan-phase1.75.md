# Phase 1.75 — the UI framework, the sidebar shell, and the Bitmap

Goal: adopt a headless component-primitive library for the app shell, migrate the
Inspector out of its bottom/right dock into a resizable right-hand **Sidebar** of
collapsible **Panels**, and add the **Bitmap** — a 1-bit-per-pixel monochrome
rendering of a contiguous run of the document's bytes, anchored to the Cursor by
a follow/lock **Origin** model.

Phase 1.75 stays a **read-only** viewer — no editing, no writing bytes back, no
Web Worker (still evidence-gated, unchanged from
[ADR-0001](adr/0001-bytesource-boundary-and-deferred-worker.md)) — and ships to
GitHub Pages at completion, the same as phases 1 and 1.5. "Phase 2" stays
reserved for **Derived work** ([#9](https://github.com/carllom/bint2/issues/9)),
so this effort is **1.75**.

> **Status.** Decision-complete. Every design choice below is settled by a closed
> wayfinder ticket on map [#63](https://github.com/carllom/bint2/issues/63); the
> tickets are authoritative where they carry more detail than this prose. What
> remains is milestone execution (§8), a separate effort to be broken into
> tracked build issues.

## 1. What phase 1.75 adds

| Addition | One line | Tickets |
|---|---|---|
| **UI framework** | **Reka UI** (`reka-ui`, exact `2.10.4`), used for app-shell chrome only — a multi-open accordion and a resizable split — wrapped so 100% of the styling stays ours. | [#67](https://github.com/carllom/bint2/issues/67) |
| **Sidebar shell** | `HomeView` rebuilt as hex grid (left) ‖ a resizable **Sidebar** (right) holding a fixed vertical stack of independently collapsible **Panels** — the **Inspector**, then the **Bitmap**. The phase-1.5 `dock: 'bottom' \| 'right'` preference is removed. | [#68](https://github.com/carllom/bint2/issues/68), [#69](https://github.com/carllom/bint2/issues/69) |
| **Bitmap** | A Panel rendering `[Origin, Origin + Stride·(Height−1) + Width)` as 1-bpp pixels — each byte eight horizontal pixels, MSB-first, a set bit painting the foreground. **Origin** follows the Cursor byte-for-byte, or **locks** at a committed offset. A locked run's **Extent** is marked in the hex grid; a pixel click drives the Cursor. | [#65](https://github.com/carllom/bint2/issues/65), [#66](https://github.com/carllom/bint2/issues/66), [#70](https://github.com/carllom/bint2/issues/70), [#71](https://github.com/carllom/bint2/issues/71), [#72](https://github.com/carllom/bint2/issues/72) |
| **`preferences` store growth** | `dock` / `setDock` / `Dock` removed; `collapsed` → `sidebarCollapsed`; `sidebarWidth` / `inspectorOpen` / `bitmapOpen` added; the five `bitmap*` render params added. Same `bint2:preferences` key, same per-field validation, no version stamp. | [#65](https://github.com/carllom/bint2/issues/65), [#68](https://github.com/carllom/bint2/issues/68) |

One research ticket fed these:
[#64](https://github.com/carllom/bint2/issues/64) (headless UI primitive
libraries for the app shell — `docs/research/headless-ui-primitives.md`). One
throwaway prototype validated the Bitmap packing transform:
[#70](https://github.com/carllom/bint2/issues/70)
(`src/core/__prototype__/bitmap-packing.prototype.html`, branch
`prototype/bitmap-packing`).

### Guardrails carried from phase 1.5

- **`src/core` stays framework-free** and mechanically enforced (the eslint
  override + `framework-free.spec.ts`). The pure Bitmap packing function
  (`rowByteSpan` + `packBitmap`) lives here; Reka UI is banned here outright
  ([ADR-0009](adr/0009-the-ui-framework-is-confined-to-shell-chrome.md) §1).
- **`PageCache` and `viewport.ts` stay frozen.** The Bitmap read is a normal
  `PageCache.read(origin, span)` on the shared cache — no new option, no capacity
  bump, no separate resident area (§4.5,
  [ADR-0002](adr/0002-page-cache-sized-against-the-viewport.md)).
- **`DomHexRenderer`, `HexRowRenderer` and `VirtualScrollbar` stay bespoke and
  frozen.** The framework touches shell chrome only. The Extent marker is a
  passive sibling overlay that only *reads* `topByteOffset` and the measured row
  height — it adds no coordinate authority, so it does not count as unfreezing
  the renderer
  ([ADR-0011](adr/0011-extent-marker-is-a-passive-gutter-overlay.md)).
- **No code path branches on file size.**
- **Read-only.** Painting pixels to edit bytes is out (§9), carried from phases 1
  and 1.5.

## 2. The UI framework ([#67](https://github.com/carllom/bint2/issues/67), [ADR-0009](adr/0009-the-ui-framework-is-confined-to-shell-chrome.md))

**Reka UI (`reka-ui`), pinned to an exact `2.10.4` in `package.json`** — not just
the lockfile, because Reka ships behavioural changes in minor releases and every
bump must force a deliberate changelog read. Vue peer `>= 3.4.0`; the repo is on
`^3.5.40`.

### 2.1 Primitives

| Primitive | Job in 1.75 |
|---|---|
| `AccordionRoot type="multiple"` + `AccordionItem` / `AccordionTrigger` / `AccordionContent` | The Sidebar's independently open/close Panels (§3.1). |
| `SplitterGroup` / `SplitterPanel` / `SplitterResizeHandle` | The hex-grid ↔ Sidebar divider — an APG window-splitter with `min` / `max` and collapse (§3.2). |
| `CollapsibleRoot` | **Pre-blessed, ships nothing in 1.75.** Available without a fresh decision if a non-accordion disclosure appears later. |

### 2.2 Wrapping — the styling stays ours

- Each primitive lives behind a **thin single-file component under
  `src/components/`**. The wrapper owns 100% of the visual layer: `<style
  scoped>` on the existing `--color-*` / `--font-mono` tokens, visuals driven off
  Reka's `[data-state]` attributes, `as-child` to avoid extra elements, **zero
  library CSS**. Reka ships no stylesheet, no theme object, no class scheme.
- **The wrappers are the only seam.** An eslint `no-restricted-imports` rule bans
  `reka-ui` outside `src/components/**`, mirroring the existing
  `app/core-is-framework-free` rule. The rest of the app imports the wrappers,
  never `reka-ui`.

### 2.3 What Reka is explicitly **not** allowed to be

1. **Imported by `src/core/**`** — the framework-free rule stands.
2. **A general Panel / docking framework** — accordion, collapsible, resizable
   split, and nothing more. No arbitrary multi-panel layouts, drag-to-rearrange,
   or tear-off windows.
3. **A replacement for the bespoke rendering stack** — `PageCache`,
   `viewport.ts`, `DomHexRenderer`, `HexRowRenderer` and `VirtualScrollbar` are
   never ported to a Reka primitive.
4. **Extended silently** — no additional Reka component enters the codebase
   without a decision ticket like [#67](https://github.com/carllom/bint2/issues/67).
5. **An owner of persisted or themed state** — no library token/theme system, and
   the splitter's `auto-save-id` is **not** used. Sidebar width is persisted
   through the Pinia `preferences` store, one owner, one storage key.

### 2.4 Bundle cost

Accepted. The two active primitives tree-shake to low-single-digit KB gzip each;
Reka's heavy transitive deps (`@floating-ui/*`, `@tanstack/vue-virtual`,
`@internationalized/*`) are lazy and off the accordion / splitter code paths.
**No new CI size gate** — a Reka bump that balloons the shell chunk is the signal
to revisit.

**Runner-up:** `@ark-ui/vue` — same component coverage, rejected on per-component
weight (per-primitive `@zag-js` state machines, ~13 KB gzip for the splitter
alone), a React-first idiom, and a tiny Vue user base. Full comparison in
`docs/research/headless-ui-primitives.md` (branch
`research/headless-ui-primitives`).

## 3. The Sidebar shell ([#68](https://github.com/carllom/bint2/issues/68), [ADR-0010](adr/0010-the-inspector-lives-in-a-fixed-sidebar.md))

### 3.1 Layout

`HomeView` becomes a horizontal Reka `SplitterGroup`: **hex grid** (flex) ‖
**splitter handle** ‖ **Sidebar**. The Sidebar is one `AccordionRoot
type="multiple"` with two `unmount-on-hide` items — **Inspector** (top), then
**Bitmap** (below) — in fixed order. `v-model` on the accordion is a computed
array bridged to the persisted `inspectorOpen` / `bitmapOpen` booleans; toggling
a section calls the store setter.

- The Sidebar is **hidden entirely when no document is open**; otherwise it is
  `sidebarWidth` wide **regardless of section state** — closing both Panels does
  not shrink it, the splitter does.
- Open sections render at **natural content height**. No nested vertical splitter.
  If the stack overflows, **the whole Sidebar scrolls vertically**; sections get
  no vertical scrollbar of their own.
- The Bitmap Panel has an **inner horizontal-only scroll box** for image-width
  overflow; it is never clipped vertically — a tall image just makes the Sidebar
  scroll.

### 3.2 The splitter

A `src/components/` wrapper over `SplitterGroup` / `SplitterPanel` /
`SplitterResizeHandle`:

- `direction="horizontal"`, `size-unit="px"`. Sidebar panel: `:min-size="200"`,
  dynamic `:max-size` = container width − the grid minimum,
  `:default-size="preferences.sidebarWidth"`, `collapsible`,
  `collapsed-size="0"`.
- `@resize` / collapse handlers write the committed px to
  `preferences.setSidebarWidth` / `setSidebarCollapsed`. **No `auto-save-id`**
  ([ADR-0009](adr/0009-the-ui-framework-is-confined-to-shell-chrome.md) §5).
- **Double-click** the handle → reset to the default (`320`). Wrapper-added, not
  native.
- The APG window-splitter keyboard model is kept as-is (arrows resize, Home/End =
  min/max, Enter = toggle collapse); all of it persists through the same
  handlers.
- **The grid minimum is dynamic**, recomputed from the current `bytesPerRow`
  preference (offset column + hex + char + padding, in `ch` — the old Inspector
  `141ch` math). When the window is narrower than `gridMin + 200`, **the grid
  yields** (clips its right edge under `overflow: hidden`, as today); the Sidebar
  keeps its 200 px floor. The splitter's `max-size` only enforces "the grid never
  goes below its minimum *via the handle*."
- Visual: a 1 px divider on `--color-border`, ~8 px hit area, `col-resize`
  cursor, `:focus-visible` + `[data-state]` highlight.

### 3.3 Whole-Sidebar collapse

`sidebarCollapsed: boolean`, persisted. Collapse is via the splitter
(`collapsed-size: 0`); **the handle itself is the restore affordance** — kept at
the container edge, widened hit area, Enter / click / arrow to expand. There is
no separate rail element. Collapse does **not** overwrite `sidebarWidth`;
expanding returns to the last width. A newly-opened document **honours the
persisted `sidebarCollapsed` as-is** (no force-open).

### 3.4 `preferences` store changes

| Change | Field |
|---|---|
| **Remove** | `dock`, the `Dock` type, `isDock`, `setDock` |
| **Rename** | `collapsed` → `sidebarCollapsed` (now Sidebar-wide, not Inspector-only) |
| **Add** | `sidebarWidth: number` — px, default `320`; load validation = a finite number, else default; clamped to `[200, containerWidth − gridMin]` at use |
| **Add** | `inspectorOpen: boolean` (default `true`), `bitmapOpen: boolean` (default `false`) — both persisted |
| **Add** | the five Bitmap render params — see §4.2 |
| **Keep** | `intHex`, `byteOrder`, `codePage` |

A stored `collapsed` or `dock` key from phase 1.5 is **ignored on load and
dropped on the next write** — no version stamp, no migration; the store's
existing per-field validation already covers a key a later version removes.

### 3.5 Inspector Panel surgery

**Removed**: the collapse-to-thin-bar button + `inspector__bar`, the dock toggle
button, the `watch` that strips inline width, `resize: horizontal`, all
`--bottom` / `--right` variant CSS, the wrap-one-group-at-a-time logic.

**Kept**: the row groups (`plan-phase1.5.md` §3.2), the per-row copy `<button>`s
(§3.6), and the `hex` toggle (§3.3) — the last **moved to a small control strip
at the top of the Panel's content**, not the accordion trigger (triggers stay
pure toggles per APG). Section open/close replaces the old `collapsed`; the
content region keeps an explicit accessible name.

### 3.6 Focus and tab order

- The Bitmap Panel's **content** region carries a focusable container
  (`tabindex="0"` on the canvas wrapper, a visible focus ring). It takes focus on
  `pointerdown` and via Tab.
- The Bitmap's Width / Stride (`Comma` / `Period`, `Shift` for Stride), Lock
  (`L`) and Origin-nudge keys are bound **on that container** (not `window`),
  armed while focus is *within* the content. Focus on the accordion **trigger**
  does **not** arm them. `unmount-on-hide` means a closed section has no container
  and the keys are inert; the **session-only lock state survives close/reopen**.
- **Tab order:** toolbar → hex grid → **splitter resize handle** → Sidebar
  (accordion `trigger₁ → content₁ → trigger₂ → content₂`, DOM order = visual
  top-to-bottom) → status bar. `VirtualScrollbar` stays non-focusable.

## 4. The Bitmap

### 4.1 Nature & placement

A **Panel** in the Sidebar (§3.1), below the Inspector, rendering a contiguous
run of the document's bytes as 1-bpp pixels onto a `<canvas>`. The bytes **are**
the pixels — nothing is decoded from them. Controls live in the Panel's own
header / body, **never the toolbar**. `unmount-on-hide`: a closed Bitmap holds no
`PageCache` read.

### 4.2 Parameters & defaults

All persisted on the `preferences` store, same `bint2:preferences` key, same
per-field validation (invalid *or missing* → default).

| Field | Type | Default |
|---|---|---|
| `bitmapWidth` | int ≥ 1 | **4** (bytes → 32 px per row) |
| `bitmapStrideOffset` | int ≥ 0 | **0**. **Stride = Width + `bitmapStrideOffset`**, derived, never stored. Negatives clamp to `0`. The offset *is* the gap: `bitmapStrideOffset` trailing bytes of each row are skipped, so one column of a wider repeating structure can be viewed in isolation. |
| `bitmapHeight` | int 32–4096, or `null` | `null` → the section body's inner height in CSS px at first open; **sticky once the user edits it**. **Units: 1× pixels** — `Zoom` multiplies the rendered size, not this value. The section scrolls vertically when the image is taller than the visible area. |
| `bitmapZoom` | int 1–3 | **2**. `image-rendering: pixelated`, smoothing off. A control only — no keybinding in v1. |
| `bitmapInvert` | boolean | `false` |
| `bitmapOpen` | boolean | `false` (the accordion section's open state — §3.4) |

**Storing the offset, not an absolute Stride, is deliberate** (the
[#65](https://github.com/carllom/bint2/issues/65) amendment, confirmed by the
[#70](https://github.com/carllom/bint2/issues/70) prototype): an independent
`Stride` makes `Stride < Width` a representable-but-invalid state that every read
has to re-clamp, and raising Width then lowering it does not restore the row
layout unless a separate "linked" flag tracks it. The offset makes the invalid
state unrepresentable and makes **Stride track Width in both directions for
free**. The `Shift`+`,` / `Shift`+`.` keys step the offset (clamped at `0`) and
still read as *"Stride −/+ 1"* in the header.

**Origin mode and any locked Origin offset are not persisted** — every reload
starts in Follow. This is a starting choice, not a principle; persisting the mode
(and named, saved Bitmap views) is a sanctioned later extension near the
**Annotation** concept
([ADR-0008](adr/0008-bitmap-origin-follows-or-locks-to-the-cursor.md)
Consequences).

### 4.3 Pixel semantics

- **MSB-first**: bit 7 of each byte is its leftmost pixel.
- Bit value `1` = **foreground**; `invert` swaps foreground / background — a
  colour-only change, no geometry.
- **Colours follow the theme** — foreground = text colour, background = surface,
  consistent with [ADR-0005](adr/0005-the-byte-grid-is-not-a-document.md). No
  colour pickers.
- **LSB-first and column-major packing stay in the fog** (§9). Both were made
  concrete in the [#70](https://github.com/carllom/bint2/issues/70) prototype;
  nothing in the font / icon data on hand needs them. They graduate as a fresh
  ticket if an LSB-first or column-packed dump turns up — `packBitmap` already
  carries the stubbed `bitOrder` / `order` parameters (§4.6).

### 4.4 The follow/lock Origin model ([ADR-0008](adr/0008-bitmap-origin-follows-or-locks-to-the-cursor.md))

The **Origin** — the document byte offset the Bitmap's top-left pixel maps to —
has **no navigation of its own**. It couples to the **Cursor** in one of two
modes:

- **Follow** (default). Origin equals the Cursor's byte offset exactly, unaligned
  to Width or Stride. Byte-stepping the Cursor in the hex grid slides the Bitmap
  one byte at a time — this is how column alignment is dialled in. The Bitmap
  section's own arrow keys are inert in Follow mode.
- **Lock**. **Lock Origin** (`L`, or the header toggle) freezes the Origin at its
  current offset. The Cursor then moves independently and the render takes no
  Cursor input — it is a pure function of `[Origin, Width, Stride, Height, Zoom,
  invert]` and the bytes. **Follow Cursor** (`L` again) snaps the Origin back to
  the Cursor's current offset and resumes tracking. A locked Bitmap is fully
  Cursor-independent: moving the Cursor anywhere — off-screen, far away — changes
  nothing; the "where does it sit" cue is the Extent marker (§4.7).

- **No Cursor yet** (document open, nothing clicked): the section body shows a
  muted one-line hint, **no canvas**, and **Lock Origin is disabled**. Mirrors
  the Inspector's "No Cursor yet" (`plan-phase1.5.md` §3.4). Every fill state in
  §4.9 exists only once there is an Origin.
- The header shows the state as **read-only** text: *"Following cursor"* /
  *"Locked · 0x…"*. A typed Origin field stays in the fog (Follow + Goto + Lock
  covers targeting).

The two named actions are **Lock Origin** and **Follow Cursor**. The ADR rejects
always-follow-the-Cursor (cannot hold a framebuffer / font-table region on screen
while reading its bytes in the grid — the core workflow), a Viewport/page anchor
(the bytes worth seeing as pixels are usually *not* on screen), and a bare
numeric Origin field as the primary mechanism (typing hex offsets is far worse
than nudging and watching pixels shift into register).

### 4.5 Keys (bound by `KeyboardEvent.code`, layout-independent)

| Key | Action | When |
|---|---|---|
| `L` | toggle Lock Origin / Follow Cursor | Bitmap section focused |
| `Comma` / `Period` | Width −1 / +1 | Bitmap section focused |
| `Shift`+`Comma` / `Shift`+`Period` | Stride −1 / +1 — steps `bitmapStrideOffset`, clamped ≥ 0 (i.e. Stride ≥ Width) | Bitmap section focused |
| `←` / `→` | Origin ∓ 1 byte | Bitmap section focused **and locked** |
| `↑` / `↓` | Origin ∓ Stride (one bitmap row) | Bitmap section focused **and locked** |
| `PageUp` / `PageDown` | Origin ∓ (Stride × visible rows) | Bitmap section focused **and locked** |
| `Home` / `End` | Origin → `0` / clamp to `size` (see §4.9) | Bitmap section focused **and locked** |

Nudging a locked Origin never moves the Cursor. `Zoom` has no keybinding in v1.
The focus plumbing for "the section is focused" is §3.6's.

### 4.6 The read path vs. the frozen `PageCache` ([#66](https://github.com/carllom/bint2/issues/66))

A bitmap read is a **normal paged `PageCache.read(origin, span)`** on the
**shared** cache — the same kind of call the Inspector makes.

- `span = rowByteSpan = Stride·(Height − 1) + Width` ≈ 2–8 KB in practice
  (240×64 → ~2 KB; a tall section → ~8 KB), always far under the 1 MiB
  `directReadThreshold`, so it flows through the normal coalescing path and its
  covering pages (1–3, allowing for a 64 KiB boundary straddle) land resident at
  MRU.
- **Not a Direct read**, no `capacityPages` bump, no separate resident area, no
  new `PageCache` option. `PageCache` and `viewport.ts` are **untouched**. If a
  pathological config ever reached 1 MiB, `read()` already auto-promotes it to a
  Direct read — nothing to decide or build.
- **No thrash.** `#makeRoom` evicts only when `pages.size + need > capacityPages`
  (256). The Viewport working set is ~2 pages; the Bitmap adds 1–3. A Viewport
  page cannot be evicted by a bitmap read until ~16 MiB is simultaneously
  resident — never in practice. `stats.evictions` confirms it in the M8 perf pass
  if wanted.
- **No span clamp.** It would silently truncate the image; the 1 MiB
  auto-Direct-read is the backstop. #65's `bitmapHeight` 32–4096 ceiling is not
  reopened.
- **Follow-mode hot path**: every Cursor move re-issues the read at a new Origin.
  Consecutive spans overlap almost entirely, so they resolve as `readSync` hits
  against resident pages — a re-slice, not a re-fetch.

**Dead source, read path only** (the render is §4.9). Model the read path on
`useBytesAt`:

1. `readSync(origin, span)` fast path;
2. on miss, the guarded async `read()`;
3. a **`source-gone`** rejection raises the dead-source banner once
   (`documentStore.setSourceHealth('gone')`) — the one escalation this path makes
   on its own;
4. `read-failed` / `source-closed` → leave pending, **no** escalation here (that
   stays `HexViewer`'s row-fetch job).

**Delivery.** **Extend `useBytesAt`** to accept `length:
MaybeRefOrGetter<number>` — added to the `watch` source and to the identity-based
staleness guard (a stale read from a previous span must not clobber a newer one).
`useByteAt` keeps passing the constant `1`, behaviour identical, pinned by its
existing tests. **No `useBitmapBytes`** — one staleness guard, one ADR-0004
escalation path, in one place. The Bitmap section calls:

```ts
useBytesAt(
  computed(() => documentStore.source),
  originRef,                                   // Follow: === cursor; Lock: frozen/nudged
  computed(() => stride * (height - 1) + width),
)
```

### 4.7 The packing function ([#70](https://github.com/carllom/bint2/issues/70))

A **pure `src/core` module** — `src/core/bitmap.ts` — lifts from the validated
prototype at milestone time (not now):

```ts
rowByteSpan({ width, stride, height }): number
  // → stride * (height - 1) + width   (the #66 span)

packBitmap(bytes, { width, stride, height, invert, bitOrder, order }):
  { bits, w, h, bytesRead, bytesMissing }
  // bitOrder: 'msb' (shipped) | 'lsb' (fog stub)
  // order:    'row' (shipped) | 'col' (fog stub)
```

The prototype (branch `prototype/bitmap-packing`,
`src/core/__prototype__/bitmap-packing.prototype.html`) drove this against an 8×8
font ROM, 16×16 icons, a 16-record struct array, a 104-px framebuffer stored 16
bytes/row with 3 pad bytes, and a bit-order ramp. Confirmed by the dev:

- **MSB-first renders glyphs upright and correctly handed**; the LSB-first
  preview mirrors each glyph horizontally, no vertical flip either way.
- **`Stride > Width` skips exactly the trailing `Stride − Width` bytes** of each
  row — the padded framebuffer squares up only at Width 13 / Stride 16.
- **`invert`** swaps foreground / background bit values only — no geometry
  change.
- **`Zoom` 1–3** stays crisp with `image-rendering: pixelated` + smoothing off;
  the canvas grows by exact integer multiples.
- Reads past the buffer end are drawn as background bits and counted in
  `bytesMissing` — §4.9 renders that count properly.

**`packBitmap` stays pure** — it packs whatever `bytes` it is handed, missing ⇒
background bits, EOF- and residency-agnostic. The `null`-tracks-Width behaviour
lives one level up in the Bitmap component's Width/Stride state, and it must be
**bidirectional**: raising Width raises Stride, lowering Width lowers it again,
because Stride is stored as the offset `bitmapStrideOffset` (§4.2), not an
absolute value.

### 4.8 The Extent marker ([#71](https://github.com/carllom/bint2/issues/71), [ADR-0011](adr/0011-extent-marker-is-a-passive-gutter-overlay.md))

The **Extent** is the run of document bytes the Bitmap currently renders —
`[Origin, Origin + Stride·(Height−1) + Width)`. It is transient view chrome, not
an **Annotation**.

- **Shown only while the Origin is locked** *and* the Bitmap Panel is mounted.
  Follow mode shows nothing — the linkage there *is* the Cursor. The locked
  Origin stays in session state (§3.6) when the Panel is closed; the marker
  returns with the Panel.
- **Rendered as a passive sibling overlay** inside `.hex-viewer__row-area`
  (already `position: relative`), absolutely positioned from `topByteOffset` +
  the measured row height + `rowOfOffset` — the same viewport math `HexViewer.vue`
  already owns. `DomHexRenderer` / `HexRowRenderer` / `HexGridView` are
  **untouched**; this does **not** count as unfreezing the renderer (the freeze
  protects the coordinate / paging seam — the recycled pool, `byteAtPoint`, the
  ADR-0002 / ADR-0006 math *as authority* — and a decorative layer that only
  reads `topByteOffset` adds no authority).
- **Form**: a thin `--color-bitmap-extent` rule down the gutter / left edge,
  capped at the first and last covered row. A **contiguous hull** even when
  `Stride > Width` — the band ends at the exact last rendered byte (`+ Width`,
  not `+ Stride`); per-row gaps are not drawn.
- **Off-screen**: when the Extent is *entirely* above/below the viewport, a
  chevron at that edge. The chevron is **clickable** — scrolls the grid to the
  Extent's first row (the mirror of click-to-cursor). Partially visible → no
  chevron, the band clips at the viewport edge.
- **`pointer-events: none`** on the band — byte clicks pass straight through to
  the cells beneath. The chevron is the overlay's only hit target.
- **Decorative**: `aria-hidden`, no live region
  ([ADR-0005](adr/0005-the-byte-grid-is-not-a-document.md)). The Bitmap ↔ Cursor
  relationship is already spoken through the existing cursor live region in
  Follow mode; a locked Extent is silent chrome.

The ADR rejects an extent range on `HexGridView` painted by `DomHexRenderer` as a
row modifier (reopens the frozen seam for a decorative concern, ties the marker's
lifetime to a repaint) and a stripe in `VirtualScrollbar` (a file-scale minimap
mark is a weaker signal than alignment with the visible rows and the address
gutter — left in the fog as a possible addition, not a replacement).

### 4.9 Click-to-cursor ([#71](https://github.com/carllom/bint2/issues/71))

- A Bitmap pixel click maps to `target = Origin + row·Stride + floor(col / 8)`,
  where `row` / `col` are pixel coords ÷ Zoom.
- **Plain click** → `setCursor(target)`; **Shift+click** →
  `extendSelectionTo(target)` (mirrors the grid). Left button, no pointer
  capture. **Drag-select stays fog** (§9).
- Works in **both Follow and Lock**. In Follow the Origin then chases the Cursor
  and the Bitmap reflows (the clicked byte moves to the top-left) — accepted as
  predictable; anyone wanting a stable view locks first.
- After moving the Cursor it calls **`revealOffset(target)`** so the hex grid
  scrolls the minimum to bring that row into view — it behaves like a keyboard
  cursor move, not a mouse click, because the point of clicking a pixel is "take
  me to those bytes."
- **Clicks past EOF or on blank pixels are inert.** The exact set (§4.10): a
  pixel is click-inert iff its source byte offset is `≥ size` **or** that byte is
  not currently resident.
- The click drives the Cursor **through the store**
  ([ADR-0003](adr/0003-selection-is-one-range-cursor-is-its-collapsed-form.md)) —
  the same path a grid click takes; it is **not** part of the Extent overlay.

### 4.10 EOF / not-resident / dead-source rendering ([#72](https://github.com/carllom/bint2/issues/72))

**The canvas is always `Height` rows × `Width·8` px**, whatever fraction of the
span is available — it never shrinks to the rows that have bytes. A
shrink-to-content canvas would resize on every byte-step near EOF in Follow mode,
`Height` is already a layout commitment (§4.2), and the full frame *is* the "you
are near the end of the file" signal in pixel space. Mirrors the Inspector
keeping every row and dimming the EOF-truncated ones.

Three kinds of "no pixel here", two treatments:

| Region | When | Rendered as |
|---|---|---|
| **Past EOF** | source byte offset ≥ `size` | a distinct muted, theme-toned fill — **not** affected by `invert` (it is chrome, not data); the pixel-view analogue of the Inspector's `—`. Per-pixel: a row straddling `size` is packed data for the bytes that exist and EOF-fill for the rest. `Stride > Width` skip-gaps contain no pixels, so EOF within a gap is moot. |
| **Not-yet-resident** | valid range, pages not loaded yet | plain background — no spinner, no "loading" fill; repaints when the bytes arrive (ADR-0004 self-healing, no negative caching). |
| **Dead-source remainder** | `source-gone`, bytes that were never resident | plain background — [ADR-0004](adr/0004-a-dead-source-is-a-banner-not-a-blank-screen.md)'s non-dismissible banner is already the marker. |

- **Residency is all-or-nothing on the live path.** #4.6's single
  `PageCache.read(origin, span)` via the extended `useBytesAt` returns `null`
  until the *whole* span is resident, then a `Uint8Array` (short ⇒ EOF). So the
  pending treatment always covers the **whole canvas** — pending pixels are never
  mixed with resident pixels on screen.
- **Dead-source salvage** — when the guarded `read()` rejects `source-gone`, the
  Bitmap component does a **one-time per-row `readSync` sweep**: every row whose
  bytes are resident is packed and painted, the rest stay plain background
  **permanently**, and the banner is raised as §4.6 specifies. **Per-row painting
  happens only in this terminal case**, in both Follow and Lock.
- **Stale frames — cleared, never held.** A span change (Follow Cursor move, or
  Lock nudge) onto not-yet-resident bytes clears the canvas to the pending
  treatment for that frame rather than holding the previous frame's pixels.
  Holding would paint a region that no longer corresponds to the current Origin —
  stale shown as live, the thing ADR-0004 refuses. Brief and rare (consecutive
  reads are ~99% resident); a one-frame blank is the same honest signal the hex
  grid gives with `··`.
- **Origin at or past EOF** is allowed. In Follow the Cursor can already sit at
  `size`; in Lock, `End` clamps the Origin to **`size`** (not `size − 1`) and
  `Home` to `0`. Origin `== size` ⇒ the whole canvas is EOF-fill — a legible
  "nudged off the end" state.
- **Empty document (0 bytes)**: unchanged from §4.4 — no Cursor is ever possible,
  Lock is disabled, the section shows the muted "No Cursor yet" hint and no
  canvas, so none of these fill states exist.

**Where the knowledge lives.** `packBitmap` stays pure (§4.7). The Bitmap
**component** computes the past-EOF pixel region from `Origin / Stride / Width /
size`, tracks which rows it filled from the dead-source `readSync` sweep, and
paints the EOF-fill and blank regions as **overlay passes** on top of the packed
bits.

## 5. Boundary matrix — what each setting reaches

| Setting | Store field(s) | Persisted? | Owned / read by |
|---|---|---|---|
| Sidebar width | `sidebarWidth` | ✅ persisted | Splitter wrapper (write on `@resize`), `HomeView` (`:default-size`) |
| Sidebar collapsed | `sidebarCollapsed` | ✅ persisted | Splitter wrapper, `HomeView` |
| Inspector open | `inspectorOpen` | ✅ persisted | Accordion `v-model` bridge, `InspectorPanel` (`unmount-on-hide`) |
| Bitmap open | `bitmapOpen` | ✅ persisted | Accordion `v-model` bridge, `BitmapPanel` (`unmount-on-hide`) |
| Bitmap Width | `bitmapWidth` | ✅ persisted | `BitmapPanel` state, `rowByteSpan` / `packBitmap` call sites |
| Bitmap Stride | `bitmapStrideOffset` (Stride = Width + offset, derived) | ✅ persisted | `BitmapPanel` state, `packBitmap` call site, Extent overlay |
| Bitmap Height | `bitmapHeight` (`null` → measured once) | ✅ persisted | `BitmapPanel` canvas + read span |
| Bitmap Zoom | `bitmapZoom` | ✅ persisted | `BitmapPanel` canvas upscale (CSS `image-rendering: pixelated`) |
| Bitmap invert | `bitmapInvert` | ✅ persisted | `packBitmap` call site |
| Bitmap **Origin mode** (Follow / Lock) | — | ❌ **session only** | `BitmapPanel` state machine; every reload starts in Follow (ADR-0008) |
| Bitmap **locked Origin offset** | — | ❌ **session only** | `BitmapPanel` state machine; drives `useBytesAt` and the Extent overlay |
| Byte order | `byteOrder` | ✅ persisted (phase 1.5) | Inspector multi-byte rows — **the Bitmap does not read it** (it renders bytes, not Elements) |
| Code page | `codePage` | ✅ persisted (phase 1.5) | Char column only — **the Bitmap does not read it** |
| `intHex` | `intHex` | ✅ persisted (phase 1.5) | Inspector integer rows only |

## 6. `CONTEXT.md` and ADRs

All applied on the stacked wayfinder branches and consolidated onto
`wayfinder/71-extent-marker` for a single merge to `main`; **nothing is owed
here** beyond this file and the `plan-phase1.5.md` forward pointer.

| Change | Where | Ticket (commit) |
|---|---|---|
| New **Bitmap**, **Origin**, **Width**, **Stride** terms; **ADR-0008** — *The Bitmap's Origin follows or locks to the Cursor* | `CONTEXT.md`, `docs/adr/0008-…` | [#73](https://github.com/carllom/bint2/issues/73) — on `main` (`d38e34a`) |
| **ADR-0009** — *The UI framework is confined to shell chrome* | `docs/adr/0009-…` | [#67](https://github.com/carllom/bint2/issues/67) (`fb9bbd9`) |
| New **Sidebar** term; **Panel** term rewritten (one titled collapsible region within the Sidebar; no docking, no bottom placement, no drag-to-rearrange, no tear-off); **ADR-0010** — *The Inspector lives in a fixed sidebar, not a dockable panel* | `CONTEXT.md`, `docs/adr/0010-…` | [#68](https://github.com/carllom/bint2/issues/68) (`791dc17`) |
| `docs/plan-phase1.5.md` §2 / §3.1 "Superseded (phase 1.75)" notes; #54 supersession comment; map #51 fog entry repointed to #63 | `docs/plan-phase1.5.md` | [#69](https://github.com/carllom/bint2/issues/69) (`86faa3f`) |
| New **Extent** term; **ADR-0011** — *The extent marker is a passive gutter overlay, outside the hex renderer* | `CONTEXT.md`, `docs/adr/0011-…` | [#71](https://github.com/carllom/bint2/issues/71) (`72ba06f`) |

**No ADR and no `CONTEXT.md` change** from
[#66](https://github.com/carllom/bint2/issues/66) (a read-path decision that
spends ADR-0002's deliberate headroom as designed),
[#70](https://github.com/carllom/bint2/issues/70) (a prototype that validated the
packing transform), or [#72](https://github.com/carllom/bint2/issues/72) (every
call downstream of ADR-0004 / ADR-0002; "EOF-fill" and "pending" are rendering
states, not domain nouns).

## 7. Testing

Same three-seam order as phases 1 and 1.5 (`docs/plan-phase1.md` §11) — prefer
the highest seam that can observe the behaviour.

**1. Application shell mounted whole** (the top seam, existing injectable
`ByteSource` factory — *default* / *synthetic* `size = 2e9` / *failing*):

- **Shell**: the splitter resizing and persisting `sidebarWidth`; double-click
  reset to 320; whole-Sidebar collapse via the handle and restore to last width;
  `sidebarCollapsed` honoured on document open; the Sidebar hidden with no
  document; the dynamic grid minimum from `bytesPerRow` and the grid yielding
  when the window is too narrow; both accordion sections opening independently and
  persisting `inspectorOpen` / `bitmapOpen`; `unmount-on-hide` (a closed Bitmap
  issues no `PageCache.read`); tab order toolbar → grid → handle → accordion →
  status bar.
- **Inspector surgery**: the thin-bar / dock-toggle / `resize` chrome is gone;
  the row groups, copy buttons and the `hex` toggle (now in the content strip)
  still work; a stored phase-1.5 `dock` / `collapsed` key is ignored on load and
  dropped on the next write.
- **Bitmap — Follow**: a known byte window at a given Cursor packs to the
  expected pixels for `Width` / `Stride` / `invert` / `Zoom`; byte-stepping the
  Cursor slides the image one byte; `Comma` / `Period` change Width and re-pack;
  `Shift`+`Comma` / `Shift`+`Period` step `bitmapStrideOffset` clamped at 0;
  raising then lowering Width restores the row layout (bidirectional
  Stride-tracks-Width).
- **Bitmap — Lock**: `L` freezes the Origin; the Cursor moves with no render
  change; `←→` / `↑↓` / `PageUp`·`Down` / `Home`·`End` nudge the Origin (±1,
  ±Stride, ±page, 0 / `size`) without moving the Cursor; the keys arm on
  `:focus-within` the content container and **not** on trigger focus; the lock
  survives section close/reopen.
- **Bitmap — read path**: the read is a `PageCache.read(origin, span)` with
  `span = stride·(height−1)+width`, never a Direct read, never triggers prefetch;
  a locked Origin far from the Viewport does not evict Viewport pages
  (`stats.evictions` unchanged); `readSync` fast path on overlapping Follow spans;
  the extended `useBytesAt` staleness guard drops a stale span's late arrival.
- **Bitmap — states**: the canvas holds `Height × Width·8` px regardless of
  availability; past-EOF pixels are the muted fill, per-pixel across a straddling
  row, unaffected by `invert`; not-yet-resident → whole-canvas plain background,
  repaint on arrival; a span change onto non-resident bytes clears rather than
  holds the last frame; `source-gone` → the one-time per-row `readSync` sweep
  paints resident rows and leaves the rest permanently blank, banner raised once;
  Origin `== size` → whole-canvas EOF fill; empty document → the "No Cursor yet"
  hint, no canvas.
- **Extent marker**: shown only while locked *and* the Panel is mounted; a
  contiguous hull `[Origin, Origin + Stride·(Height−1) + Width)` even when
  `Stride > Width`; positioned from `topByteOffset` + row height; an edge chevron
  when entirely off-screen, clicking it scrolls to the Extent's first row; the
  band is `pointer-events: none` (a byte click underneath still selects);
  `aria-hidden`, no live region; gone in Follow mode.
- **Click-to-cursor**: a pixel click → `setCursor(Origin + row·Stride +
  floor(col/8))` then `revealOffset`; Shift+click → `extendSelectionTo`; works in
  both Follow (Origin then chases, Bitmap reflows) and Lock; clicks past EOF or on
  non-resident pixels are inert.
- **`preferences` store**: per-field validation (missing / wrong type /
  out-of-set → default) for the new fields; `bitmapStrideOffset` negatives clamp
  to 0; `bitmapHeight` `null` → measured once then sticky; `sidebarWidth`
  non-finite → 320.

**2. Pure core, direct unit tests** — `src/core/bitmap.ts`:
`rowByteSpan({width, stride, height})`; `packBitmap` against the prototype's
fixtures (8×8 font ROM upright MSB-first, the LSB-first mirror, `Stride > Width`
skipping exactly `Stride − Width` trailing bytes, `invert` as fg/bg-only,
`bytesRead` / `bytesMissing` counts at and past EOF); the framework-free check
still passes for the new module.

**3. Playwright e2e** — deliberately thin, following the phase-1 line. One added
journey: open the ~8 MB fixture, open the Bitmap Panel, move the Cursor and see
the pixels track; press `L`, move the Cursor, see the image hold and the Extent
marker appear in the grid; click a pixel and see the Cursor jump and the grid
reveal that row; drag the splitter and reload to confirm `sidebarWidth`
persisted. No new large-file or dead-source e2e (component-tested against the
failing source, plus the unit-tested latch).

**Deliberately not automated**: the exact pixel shapes beyond the pinned
`packBitmap` fixtures (visual, low-value); the retro glyph tables (unchanged from
phase 1.5); screen-reader output (the Extent marker is `aria-hidden` by design;
the cursor live region is unchanged in substance).

## 8. Milestones

Execution only — every design choice above is settled. To be broken out into
tracked build issues (the map's remaining *milestone / execution breakdown* fog
graduates here).

| # | Deliverable |
|---|---|
| **P1.75-M1** | `reka-ui` at exact `2.10.4`; the `src/components/` wrapper layer (accordion wrapper, splitter wrapper — 100% our styling, `[data-state]` hooks, zero library CSS); the eslint `no-restricted-imports` fence for `reka-ui` outside `src/components/**`. Wrapper unit tests. No shell change yet. ([ADR-0009](adr/0009-the-ui-framework-is-confined-to-shell-chrome.md)) |
| **P1.75-M2** | `preferences` store migration: drop `dock` / `Dock` / `isDock` / `setDock`, rename `collapsed` → `sidebarCollapsed`, add `sidebarWidth` / `inspectorOpen` / `bitmapOpen` and the five `bitmap*` params, all with per-field validation and the phase-1.5 failure modes. Unit-tested. No UI. |
| **P1.75-M3** | Shell migration: `HomeView` → `SplitterGroup` (grid ‖ handle ‖ Sidebar), one `AccordionRoot type="multiple"` with Inspector then Bitmap (`unmount-on-hide`), whole-Sidebar collapse, dynamic grid minimum, double-click reset, width + collapse persisted. Inspector Panel surgery (§3.5). Focus container + tab order (§3.6). ([ADR-0010](adr/0010-the-inspector-lives-in-a-fixed-sidebar.md)) |
| **P1.75-M4** | `src/core/bitmap.ts`: lift `rowByteSpan` + `packBitmap` (`'msb'` / `'row'` paths, `bitOrder` / `order` stubbed) from the prototype as-is; unit tests against the prototype fixtures; framework-free check green. |
| **P1.75-M5** | The **Bitmap Panel**: the canvas (`putImageData` + integer `Zoom` upscale), the follow/lock Origin state machine and keys (ADR-0008), `useBytesAt` extended to a reactive `length` (§4.6), the section controls (Width / Stride / Height / Zoom / invert), and the §4.10 EOF-fill / pending / dead-source-salvage overlay passes. |
| **P1.75-M6** | Bitmap ↔ hex linkage: the Extent overlay in `.hex-viewer__row-area` (§4.8, ADR-0011), the off-screen edge chevron, and click-to-cursor — plain / Shift+click / `revealOffset`, inert past EOF or on non-resident pixels (§4.9). |
| **P1.75-M7** | e2e journey addition (§7); README pass (the Bitmap section, the `L` / `,` / `.` hotkeys, "what it does not do"); deploy to GitHub Pages. |

M1 and M2 are independent. M3 needs M1 + M2. M4 needs nothing (pure). M5 needs
M2 + M4, and M3 for the focus container. M6 needs M5. M7 is last.

## 9. Out of scope

Carried from map [#63](https://github.com/carllom/bint2/issues/63). These do not
graduate within this effort — they return only if a later phase redraws the
destination.

- **LSB-first bit order and column-major packing** — the first cut is MSB-first,
  row-major only. Both were made concrete and checked in the
  [#70](https://github.com/carllom/bint2/issues/70) prototype; nothing in hand
  needs them. Graduates as its own ticket if an LSB-first or column-packed dump
  turns up — `packBitmap` already carries the stubbed `bitOrder` / `order`
  params. **Still fog.**
- **Hover-echo of a pixel's byte offset in the status bar** — a nice-to-have, not
  load-bearing; the Extent marker + click-to-cursor carry v1.
  [#71](https://github.com/carllom/bint2/issues/71) explicitly kept it in the
  fog. **Still fog.**
- **Drag-select / range selection in the Bitmap** — click and Shift+click only
  (§4.9). Fog.
- **A typed / numeric Origin field** — Follow + Goto + Lock covers targeting; kept
  in the fog as a possible later convenience
  ([ADR-0008](adr/0008-bitmap-origin-follows-or-locks-to-the-cursor.md)).
- **Persisting the Origin mode / locked offset**, and named saved Bitmap views —
  a sanctioned later extension near the **Annotation** concept, not this effort
  (ADR-0008 Consequences).
- **Greyscale / colour / multi-bit bitmaps** — 1-bpp monochrome only; each byte
  is 8 pixels.
- **Exporting or saving the rendered image** — a viewer, not a converter.
- **A general Panel / docking framework** — the library is confined to shell
  chrome (accordion + resizable split + collapsible). Multiple arbitrary panels,
  drag-to-rearrange, tear-off — not this effort. Supersedes phase 1.5's "Panel
  family + component library" fog entry on
  [#51](https://github.com/carllom/bint2/issues/51)
  ([ADR-0009](adr/0009-the-ui-framework-is-confined-to-shell-chrome.md),
  [ADR-0010](adr/0010-the-inspector-lives-in-a-fixed-sidebar.md)).
- **The element grid** — rendering the document's rows *as* Elements rather than
  bytes. Carried from phase 1.5 §10; the Bitmap leaves the document's rendering
  byte-oriented.
- **Painting pixels to edit bytes / hex editing** — read-only, carried from
  phases 1 and 1.5.
- **Web Worker** — evidence-gated, unchanged; not reopened here.
- **Derived work** — search, entropy maps, streaming decode. Phase 2, with its
  own worker-crossing interface
  ([#9](https://github.com/carllom/bint2/issues/9)).

## 10. Decisions, ratified

Each row is a closed wayfinder ticket on map
[#63](https://github.com/carllom/bint2/issues/63); open its link for the full
reasoning.

| Decision | Ticket |
|---|---|
| Headless Vue 3 primitive survey — **Reka UI** recommended (accordion + collapsible + APG window-splitter from one zero-CSS dep), runner-up Ark UI | [Research: headless UI primitive libraries for the app shell](https://github.com/carllom/bint2/issues/64) |
| The **Bitmap** parameters (`bitmapWidth` 4, `bitmapStrideOffset` 0, `bitmapHeight` `null`→measured, `bitmapZoom` 2, `bitmapInvert` off, `bitmapOpen` off), MSB-first / 1 = fg / theme colours, and the follow/lock **Origin** model with `code`-bound keys; terms + **ADR-0008** | [The Bitmap: parameters and the follow/lock origin model](https://github.com/carllom/bint2/issues/65) |
| The bitmap read is a normal `PageCache.read(origin, span)` on the shared cache, `span = Stride·(Height−1)+Width` ≈ 2–8 KB, never a Direct read, never prefetch; `PageCache` / `viewport.ts` untouched; delivered by extending `useBytesAt` to a reactive `length`; `source-gone` raises the banner once | [The Bitmap's read path vs. the frozen PageCache](https://github.com/carllom/bint2/issues/66) |
| Adopt **Reka UI** (`reka-ui`, exact `2.10.4`) for shell chrome only — `AccordionRoot type="multiple"` + `SplitterGroup` now, `CollapsibleRoot` pre-blessed; thin `src/components/` wrappers own 100% of styling; eslint `no-restricted-imports` fence; five prohibitions; **ADR-0009** | [Decide the UI framework](https://github.com/carllom/bint2/issues/67) |
| `HomeView` → `SplitterGroup` (grid ‖ **Sidebar**); one `AccordionRoot type="multiple"`, Inspector then Bitmap, `unmount-on-hide`, open state persisted; splitter `size-unit="px"`, min 200 / dynamic max, `collapsible` to 0, double-click resets to 320; `preferences` drops `dock`, renames `collapsed`→`sidebarCollapsed`, adds `sidebarWidth` / `inspectorOpen` / `bitmapOpen`; Inspector surgery; **ADR-0010** + **Sidebar** term / **Panel** rewrite | [Shell migration: sidebar, accordion, resizable split, dock removal](https://github.com/carllom/bint2/issues/68) |
| Bookkeeping: `docs/plan-phase1.5.md` §2 / §3.1 "Superseded (phase 1.75)" notes; #54 supersession comment; map #51's fog entry repointed to #63; the `CONTEXT.md` Panel rewrite + Sidebar term verified and committed with ADR-0010 | [Amend the phase-1.5 spec and #54 for the dock removal](https://github.com/carllom/bint2/issues/69) |
| The packing transform is **validated** against real font/icon/framebuffer data — MSB-first upright, `Stride > Width` skips the trailing gap, `invert` fg/bg-only, `Zoom` 1–3 crisp; `rowByteSpan` + `packBitmap` lift into `src/core/bitmap.ts` as-is; storing `bitmapStrideOffset` makes Stride track Width bidirectionally; LSB-first / column-major stay fog | [Bitmap rendering: prove the packing function against real font/icon data](https://github.com/carllom/bint2/issues/70) |
| A locked Bitmap's byte run is the **Extent**, marked by a passive sibling overlay in `.hex-viewer__row-area` off `topByteOffset` + row height (renderers stay frozen); contiguous hull, off-screen edge chevron, `pointer-events: none`, `aria-hidden`; **click-to-cursor** `setCursor(Origin + row·Stride + floor(col/8))` + `revealOffset`, Shift+click extends, in both modes; **Extent** term + **ADR-0011** | [Bitmap and hex linkage: extent marker and click-to-cursor](https://github.com/carllom/bint2/issues/71) |
| The canvas is **fixed** at `Height × Width·8` px; past-EOF → a muted theme fill (per-pixel, `invert`-independent), not-yet-resident + dead-source remainder → plain background; live read stays all-or-nothing; dead-source → one-time per-row `readSync` salvage sweep; stale frames cleared not held; `packBitmap` stays pure; no ADR, no term | [Bitmap EOF and dead-source rendering](https://github.com/carllom/bint2/issues/72) |
