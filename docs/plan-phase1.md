# Phase 1 — Paged hex / char viewer

Goal: a hex/char viewer that stays responsive on large local files by never
holding more than a bounded window of bytes in memory, and by never relying on a
native scrollbar over the full document height.

Size expectations are **bands, not a single target**
([#2](https://github.com/carllom/bint2/issues/2)): files up to ~700 MB feel
fully responsive; files from ~700 MB to ~2 GB stay usable with only the
scrollbar thumb getting coarser; a file of any openable size must not crash the
tab. **No code path branches on file size** — the bands are a README performance
expectation, not a behavioural spec
([ADR-0004](adr/0004-a-dead-source-is-a-banner-not-a-blank-screen.md)).

> **Reconciliation status.** This plan was drafted before the phase-1 map
> ([#1](https://github.com/carllom/bint2/issues/1)) closed. It was reconciled at
> M0 against the closed tickets and ADRs 0001–0006, which are authoritative where
> they differ from this prose. The reconciliation removed the Web Worker (§2, §10
> tree, M6), the `showOpenFilePicker` fallback (§6) and its risk line, directional
> prefetch (§2), the native-scrollbar fallback (§3) and the 1.5 GB / 94 M-row
> target (§3, §11), corrected M5/M7 scope without renumbering M7/M8 (§12), deleted
> the claim that a seam is owed in `viewport.ts` (§5), and folded the old §12 open
> questions into §14.

## 1. Architecture overview

```
┌─────────────────────────── Vue layer (src/components, src/views) ───────────────────────────┐
│  HomeView ─ toolbar (bytesPerRow, goto), status bar, dead-source banner                      │
│    └─ HexViewer.vue  ── owns topByteOffset + view settings, request generation guard         │
│         ├─ VirtualScrollbar.vue   (custom thumb; row-space, not pixel-space)                 │
│         ├─ HexRow.vue × (visibleRows + overscan)   recycled pool                             │
│         └─ FileDropZone.vue                                                                  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                    │ read(offset, length) : Promise<Uint8Array>   +   readSync() : Uint8Array | null
┌────────────────── src/core (framework-free, unit-tested) ───────────────────┐
│  ByteSource (interface, frozen — ADR-0001)                                  │
│   └─ FileByteSource      File.slice(a,b).arrayBuffer()                      │
│  PageCache               fixed 64 KiB pages, LRU, read coalescing, prefetch │
│  viewport.ts             pure math: byteOffset ↔ row ↔ scrollbar fraction   │
│  format.ts               toHex / toAddress / toAsciiChar                    │
└───────────────────────────────────────────────────────────────────────────┘
```

Design rule: everything hard (paging, cache, coordinate math) lives in `src/core`
as plain TS with no Vue import, so it is testable in isolation. The rule is
**enforced mechanically** — an eslint override for `src/core/**` and
`src/core/__tests__/framework-free.spec.ts` — not by convention. No Web Worker is
built in phase 1: the `ByteSource` interface is specified worker-compatible so one
*could* land later, evidence-gated, without touching call sites
([ADR-0001](adr/0001-bytesource-boundary-and-deferred-worker.md)).

## 2. Data layer

### ByteSource interface — frozen (ADR-0001)
```ts
interface ByteSource {
  readonly size: number                                        // bytes, may be > 2^32
  read(offset: number, length: number): Promise<Uint8Array>
  readSync(offset: number, length: number): Uint8Array | null  // non-null only on a full local hit
  prefetch(offset: number, length: number): void               // fire-and-forget
  close(): void
}
```
- `read` / `readSync` return **freshly-allocated, caller-owned** arrays — never a
  view into a Page.
- **EOF:** a read crossing the end returns `min(length, size - offset)` bytes;
  `offset >= size` returns an empty array. Only negative/`NaN` throws. The render
  path needs no EOF arithmetic.
- `readSync` exists so a scroll that lands entirely in cache paints in the same
  frame with no placeholder flicker.
- **No cancellation.** The component-side generation counter is what prevents the
  real bug (stale paints). A trailing optional `signal?` stays
  backward-compatible if ever needed.
- **Errors** reject with a `ByteSourceError` carrying
  `code: 'read-failed' | 'source-closed' | 'source-gone'`. `close` is idempotent
  and rejects in-flight reads with `source-closed`. **`source-gone` latches**
  `FileByteSource` terminal — subsequent reads reject without touching the disk,
  `readSync` returns null — and the latch is **source-level only**: the cache
  above keeps serving resident pages.

### FileByteSource
- Wraps a `File`. `<input type=file>` and drag `File`s slice byte-identically, so
  there is no per-source code. `read` → resolve the covering page range from
  `PageCache`, `blob.slice(pageStart, pageEnd).arrayBuffer()` for misses,
  assemble the requested slice.
- No `FileReader`, no whole-file read, ever. Holds the raw `File` and closes over
  nothing non-cloneable.

### PageCache — sized against the viewport (ADR-0002)
- **Page size 64 KiB; capacity 256 pages, counted in pages, documented as
  ≤ 16 MiB.** At an 18 px row and a 33–160 row pool a screen holds 784 B typical
  / ~5 KiB worst case, so the ceiling is ~30× the working set; the headroom is
  what makes back-scroll and return-from-Goto free.
- **LRU eviction**; both `read` and `readSync` hits promote to MRU.
- **Coalescing joins strictly contiguous runs of missing pages**, capped at
  16 pages / 1 MiB. No gap-bridging.
- **Reads over 1 MiB are direct reads:** served in capped chunks, populating
  nothing, consulting resident pages only where they already exist — so the 8 MiB
  copy cap cannot flush the working set.
- **Pending pages occupy a slot and are pinned** until they resolve, so capacity
  bounds `resident + pending`; concurrent reads of one pending page share a
  **single in-flight promise**.
- **Prefetch is symmetric ±1 Page** around the viewport. **Scroll direction is
  deleted, not tracked.** `HexViewer` makes one `prefetch` call per scroll settle
  with the visible span; `PageCache` expands that span into covering pages ±1,
  clamped to `size`. Prefetched pages enter at **MRU**.
- **A failed coalesced run rejects every page in it and removes the entries — no
  negative caching.** This is precisely why `source-gone` has to latch a layer
  below.
- **The cache never sees a `File`.** It takes `{ fetchRange, size }` plus options
  `{ pageSize, capacityPages, prefetchPages, directReadThreshold }`.
- **Exposes `stats`** (`hits`, `misses`, `evictions`, `pagesResident`,
  `pendingCount`, `bytesFetched`) — a developer/test surface, never shown in the
  UI — so ADR-0001's worker trigger is a measurement rather than a judgement.

## 3. Coordinate model and virtual scroll (ADR-0006)

- `bytesPerRow` — presets 8 / 16 / 24 / 32, default 16.
  `rowCount = ceil(size / bytesPerRow)`.
- The row counts in play (a 700 MB file at 16 bpr is ~44 M rows; 2 GB is ~128 M)
  are past every engine's element-height limit — Firefox caps layout at
  ~17.9 M px and *zeroes* the scroll range beyond it, Chrome/Safari cap at
  ~33.5 M px — so there is **no full-height spacer and no native scrollbar**. The
  custom row-space `VirtualScrollbar` is the **only** scrollbar at every file
  size: no hybrid, no fallback. (Closed by [#2](https://github.com/carllom/bint2/issues/2);
  [#8](https://github.com/carllom/bint2/issues/8) did not reopen it.)
- **Source of truth: `topByteOffset`** — an integer, always a multiple of
  `bytesPerRow`, always clamped. `firstRow = topByteOffset / bytesPerRow` is
  derived, never stored.
- `thumbGeometry` clamps thumb height to `[minThumbPx, trackPx]` (past a few
  hundred MB the exact fraction is sub-pixel) and computes `thumbY`
  divide-before-multiply so the intermediate stays under 2^53. **Thumb drag is
  gross-only** — ~75 k rows/px at 700 MB, ~215 k at 2 GB — and that is accepted.
- **Fine movement is wheel (row granularity) + keyboard + Goto.** There is **no
  two-level "zoom" scrollbar in phase 1**; it stays a possible later enhancement.
  Goto is load-bearing for this reason and is M5-critical.
- **Changing `bytesPerRow` preserves the byte offset, not the row index** —
  `clampTopOffset(topByteOffset, { ...m, bytesPerRow: next })`, which aligns
  down. Repeated changes ratchet the offset down by up to `next - 1` bytes each;
  a 16 → 24 → 16 round-trip is knowingly not lossless. An anchor-offset scheme is
  deferred.
- **`viewport.ts` is a frozen pure-function surface** over a `ViewportMetrics`
  input: `rowOfOffset`, `offsetOfRow`, `rowCount`, `visibleRows`, `maxFirstRow`,
  `clampTopOffset` (align-down + clamp — the single navigation choke point),
  `thumbGeometry`, `offsetFromThumbPixel` (its inverse under clamp). **Row height
  is an input** to `ViewportMetrics`, measured from a rendered probe glyph and
  re-measured on resize/zoom, so zoom and OS font scaling are free and the
  surface is untouched. All math is written for `size > 2^32`, with a
  `MAX_SAFE_INTEGER` overflow probe in the tests.
- **Navigation actions** (`scrollByRows`, `pageBy`, `gotoOffset`, thumb drag) are
  one-line compositions over `clampTopOffset` / `offsetFromThumbPixel` and live
  in the store / a composable, **not** in `viewport.ts`.

## 4. Rendering — recycled DOM rows (v1)

Chosen over canvas for v1 and confirmed by prototype
([#7](https://github.com/carllom/bint2/issues/7)): flat ~16 ms frames under
sustained wheel, held-arrow, fling and bytes-per-row thrash across every size
tier in Chrome and Firefox. Only `visibleRows + overscan` (~33–160) rows are ever
in the DOM; styling and a11y are simpler. Rendering sits behind a **frozen
`render(view)` / `byteAtPoint(x, y)` seam** so a `CanvasHexRenderer` can replace
it later without touching the data layer.

- Fixed pool of `HexRow` instances, repositioned with `transform: translateY`,
  content updated on scroll — no create/destroy churn.
- Row = address gutter · hex columns · ascii columns, monospace, char width
  measured once.
- **Pending state:** on scroll, try `readSync` **per row** (not per visible span
  — a whole-span read across a page boundary returns null and flips *every* row
  to `··`). If null, render the row dim with `··` placeholders and repaint when
  `read` resolves **and** a generation counter still matches. A failed read is
  **deliberately indistinguishable** from a pending row.
- Redraw triggers: scroll, resize (`ResizeObserver`), `bytesPerRow` change, data
  arrival.
- `render(view)` is knowingly **single-range** (the Selection + the Cursor) and
  is **not** widened now; its rewrite for Annotations or an element grid is
  sanctioned in advance ([ADR-0003](adr/0003-selection-is-one-range-cursor-is-its-collapsed-form.md),
  [ADR-0002](adr/0002-page-cache-sized-against-the-viewport.md) amendment). The
  renderer **iterates the bytes it is handed** and never assumes
  `bytes.length === bytesPerRow` — pinned by a test (no observable phase-1
  effect).

## 5. Formatting (`format.ts`, pure + tested)

- `toHex(value, width = 2)` — uppercase, left-padded to `width`. It does **not**
  mask to a byte, so it serves a `u32` unchanged and `format.ts` needs no
  phase-1.5 change at all. Pinned by a table row:
  `toHex(0xDEADBEEF, 8) === 'DEADBEEF'`.
- `toAddress(offset, width = 8)` — hex, widens to 10/12 as the file needs (room
  for > 4 GB).
- `toAsciiChar(byte)` — `0x20–0x7E` verbatim, else `.`.
- **Multi-byte Element view** (u16/u32/i*/f*, byte order) and **alternate char
  code pages** are **phase 1.5** — specified in
  [`plan-phase1.5.md`](plan-phase1.5.md), not here. What phase 1 owes 1.5, and
  only that:
  - The seam is **not** owed in `viewport.ts` — an element grid changes only how
    a row's bytes are painted, `bytesPerRow` stays a byte count, and the
    viewport surface is frozen regardless
    ([ADR-0002](adr/0002-page-cache-sized-against-the-viewport.md) amendment).
  - The **constraint** that elements are anchored at file offset 0 and every
    preset is a multiple of 8, plus the two test-pinned rules above (renderer
    iterates `bytes`; `toHex` does not mask).
  - No over-read now — under the constraint it is dead weight, and a wider span
    straddles a Page more often so `readSync` misses more and paints more `··`.

## 6. File open

- **One path only:** a single `File` via a hidden `<input type=file>` behind a
  real `<button>`, or window drag-drop.
- **`showOpenFilePicker` / re-openable handles are dropped from phase 1** —
  Chromium-only, re-prompt on reload, and a second code path for ~¼ of the market
  for no phase-1 benefit. `<input>` and drag `File`s slice byte-identically.
- **Reject policy:** cancel → nothing; non-file drop → ignored silently; multiple
  files → first, silently; directory → **refused inline in the drop zone**;
  zero-byte file → **opens successfully** with an empty grid.
- Opening a second document closes the first — the universal reset.

## 7. Interaction (phase 1)

- **Keyboard:** ↑↓ row, ←→ byte cursor, PageUp/Dn, Home/End (row), Ctrl+Home/End
  (file), Ctrl+G goto, Shift+arrows extend the Selection, `Tab` leaves the
  viewport.
- **Keyboard drives the Cursor, pointer drives the view.** Arrows / PageUp/Dn /
  Home/End / Ctrl+Home/End move the Cursor and the view follows minimally; wheel
  and thumb drag move the view only and may leave the Cursor off-screen
  ([ADR-0003](adr/0003-selection-is-one-range-cursor-is-its-collapsed-form.md)).
- **Goto:** accepts `0x`-hex or decimal offset; **clamps** an out-of-range value
  rather than rejecting it; sets `topByteOffset` **and** the Cursor; `Esc` closes
  it without moving; focus is trapped while open and restored to the viewport on
  both confirm and `Esc`.
- **Selection / Cursor — one concept.** `{ anchor, focus }` byte offsets,
  direction preserved so shift-click and Shift+arrows extend the correct end;
  `start = min`, `end = max + 1`. **`anchor === focus` *is* the Cursor.** Click =
  Cursor; drag / shift-click / Shift+arrows = range; linked highlight in both hex
  and ASCII panes. The viewport sets `user-select: none`. The Selection is
  **uncapped** and does not survive the document closing.
- **Status bar:** Cursor offset (hex + dec), byte value (u8 / i8 / bin);
  Selection start / end / length shown **exactly when the Selection is
  non-collapsed**; file name and total size always visible.
- **Copy:** Selection as a hex string. The cap is **8 MiB of source bytes** —
  past it, **refuse** with a message naming both the cap and the Selection's
  size; **never truncate**. Copy works as long as the bytes are resident, even if
  the source has since become a dead source. Raw-text copy is M7.

## 8. Dead-source UX (ADR-0004)

- Only **one** of the three error codes is ever visible, and no code path
  branches on file size.
- **`read-failed`** → no chrome; self-healing via no-negative-caching. Failed
  rows are deliberately indistinguishable from pending `··` rows.
- **`source-closed`** → never user-visible (it fires because the reader opened
  another document).
- **`source-gone`** → the one surface: a **persistent, non-dismissible banner
  above the viewport**, naming the file and stating that the bytes still shown
  are the last ones read. No modal, no forced re-open, no disabled controls.
  Resident rows keep painting; a wholly-resident Selection still copies. **The
  only new code is the banner** — the terminal state is otherwise emergent from
  the latch sitting below the cache.
- **Escalation:** `HexViewer` counts **consecutive** `read-failed` rejections and
  past a small threshold (a tuning constant, not a decision) shows the **same
  banner** with wording for a drive that went away rather than a file that was
  deleted. One success resets the count. The three-code taxonomy is not widened.
- **Memory pressure is not surfaced and not measured** — the 16 MiB ceiling is
  the answer, and every measurement API is Chromium-only or needs cross-origin
  isolation.

## 9. Accessibility (ADR-0005)

- **Committed:** keyboard operability, honest labelling, an announced Cursor.
  **Documented non-goal:** reading the byte grid as a document. The grid is
  `aria-hidden`; the Cursor speaks. The commitment is **point interrogation** —
  exactly the test set for the whole application.
- The viewport is one `tabindex="0"` element with **`role="application"`**
  (scoped to the viewport, never the page — without it browse mode eats the arrow
  keys and the Cursor cannot be driven), an `aria-label` naming the file, and an
  `aria-describedby` usage note. Recycled rows carry `aria-hidden`; **rows and
  bytes are never focusable**.
- **Two visually-hidden polite live regions:** a **cursor region** debounced to
  settle (~200 ms), one sentence chosen by whether the range is collapsed
  (*"offset 0x1F40, byte 4D, 'M'"* vs *"selection 0x1F40 to 0x1F4F, 16 bytes"*);
  and a transient **action region** (`role="status"`) for copy success and the
  over-cap refusal. The visual status bar is **not** itself a live region.
- **`role="grid"` + `aria-rowcount` over the recycled pool was rejected** as
  technically expressible and dishonest.
- **Never announce what is not shown:** the directory refusal is `role="alert"`
  because it is already visible; cancel / non-file drop / take-the-first stay
  silent for everyone.
- The chrome gets full unconditional treatment — labelled presets, focus-trapped
  Goto with `Esc` and focus restore, a real `<button>` beside the hidden
  `<input>`.
- **`role="application"` and the cursor region ship as a pair.**
- Zoom, OS font scaling, reduced motion and contrast are committed. **Consequence:**
  fixed presets mean high zoom scrolls the viewport horizontally and **WCAG
  1.4.10 reflow is not met** for the grid — stated in the README rather than
  implied.

## 10. Vue / project structure

```
src/
  core/                     (framework-free, mechanically enforced)
    ByteSource.ts  FileByteSource.ts  PageCache.ts
    viewport.ts    format.ts
    __tests__/
  components/
    HexViewer.vue  HexRow.vue  VirtualScrollbar.vue  FileDropZone.vue
    StatusBar.vue  HexToolbar.vue  DeadSourceBanner.vue
  composables/
    useResizeObserver.ts  useHexNavigation.ts
  stores/
    document.ts        (current source, cursor, selection, view settings)
  views/
    HomeView.vue
```
- Template cruft is stripped at M0: `HelloWorld.vue`, `TheWelcome.vue`,
  `WelcomeItem.vue`, `components/icons/*`, `AboutView.vue` + its route,
  `stores/counter.ts`, the example unit and e2e specs, the Vue logo, the
  unused icon dependency. **Pinia/router wiring is kept.**
- `stores/document.ts` is a Pinia store so goto / selection / settings are shared
  between toolbar, viewer, and status bar without prop drilling.

## 11. Testing

Three seams, in descending order of preference — prefer the highest that can
observe the behaviour. Full detail is in the map's Testing Decisions and the
ADRs.

**1. Application shell mounted whole, with an injectable ByteSource factory**
(the top seam, and the only *new* one). One injected factory turns an opened
`File` into a `ByteSource`; three substitutions cover everything:

- *default* → the real file-backed source over a real `File` built in the test
  environment — most tests, and it exercises the actual slice path;
- *synthetic* → a source reporting `size = 2e9` with generated bytes and no
  allocation — scale, coordinate math, and the proof that nothing allocates the
  whole file;
- *failing* → a source that rejects on command with a chosen code — everything in
  ADR-0004.

Covered here: rendered addresses/hex/ASCII for a given top offset; bytes-per-row
switch preserving the byte offset; last-row partial rendering at EOF; placeholder
rows and repaint on arrival; the generation guard dropping stale reads; Goto
parsing / clamping / cursor-setting; every keyboard binding; click/drag/shift-click
selection and the linked highlight; copy success and the over-cap refusal
wording; every status-bar field and when Selection fields appear; both banner
texts and the escalation counter; the whole file-open reject policy; and all
accessibility markup (`role="application"`, the `aria-hidden` grid, both live
regions, focus transitions).

**2. Pure core modules, direct unit tests** — only for what the top seam cannot
observe.

- *Formatting* — table-driven, including the pinned row proving `toHex` does not
  mask to a byte.
- *Viewport math* — round-trips, clamping, align-down on bytes-per-row change,
  thumb geometry at 2 GB scale including the min-thumb clamp,
  `offsetFromThumbPixel` as the inverse of `thumbGeometry` under clamp, and a
  `MAX_SAFE_INTEGER` overflow probe.
- *Page cache* — against a fake `fetchRange` with controllable timing (never a
  `Blob`). LRU order, promotion on both hit paths, strictly-contiguous coalescing
  and the 16-page cap, no gap-bridging, the `resident + pending` ceiling,
  pinning, one shared in-flight promise per pending Page, symmetric ±1 prefetch
  without exceeding capacity, MRU insert for prefetched pages, the direct-read
  threshold populating nothing, a failed coalesced run rejecting every page in
  the run with no negative caching, and `stats` counters.
- *File-backed source* — against a synthetic `Blob` whose byte `i == i & 0xff`:
  cross-page reads, EOF short reads, `readSync` null vs hit, caller-owned
  buffers, `close` idempotency and its rejection of in-flight reads, and the
  `source-gone` **latch** against a rejecting stub.

**3. Playwright e2e (M8)** — the real browser over the production build, a
generated ~8 MB fixture built in setup. Deliberately thin: open via drop and via
the button; scroll; `Ctrl+End` asserting the final address and a short last row;
`Ctrl+G` to a mid offset; **the keyboard-only journey** (open → `Ctrl+G` →
arrows → shift-select → copy, never touching the pointer); an **axe-core smoke
over the chrome only**, with the viewport excluded by selector and the exclusion
**documented in the test**. Playwright keeps `chromium` / `firefox` / `webkit`
projects; **webkit is allowed to fail**.

**Deliberately not automated:** anything about the dead source in e2e (it is
component-tested against a rejecting source, plus the unit-tested latch); real
large-file performance (a manual pass at ~700 MB and ~2 GB, noted in the README);
one manual NVDA pass (VoiceOver out of scope — no Apple hardware).

## 12. Milestones

M6 (the Web Worker) is **dropped**; **M7 and M8 do not renumber**. M5 grew and
M7 shrank deliberately — the test for "usable" is *can you answer "what byte is
at offset X" and get the answer out of the app?*, and Selection (under
`user-select: none`), Goto (the fine path the zoom scrollbar was killed for) and
the accessibility structure all fail that test if deferred.

| # | Deliverable | Phase‑1 done? |
|---|---|---|
| M0 | Strip template cruft; base monospace layout; `src/core` skeleton with the framework-free rule enforced; CI green. **Reconcile this plan against the map**; write the owed coordinate-model ADR ([ADR-0006](adr/0006-topbyteoffset-is-the-only-coordinate.md)) | |
| M1 | `format.ts` + `viewport.ts`, fully unit-tested | |
| M2 | `PageCache` + `FileByteSource` (main thread), unit-tested | |
| M3 | `HexViewer` over a small in-memory source: correct address/hex/ascii, bpr presets | |
| M4 | `VirtualScrollbar` + wheel/keyboard nav over a large synthetic source | |
| M5 | Real file open + reject policy; async reads with placeholders + generation guard; `readSync` fast path; **Goto**; **Cursor**; **Selection**; hex copy with the 8 MiB refusal; status bar in full incl. file name and size; **dead-source banner + escalation**; **all accessibility structure**; README accessibility paragraph | ✅ **public ship** |
| M7 | Hover highlight, raw-text copy — nothing else | hardening |
| M8 | e2e suite incl. the keyboard-only journey; chrome-only axe smoke with the viewport excluded *and documented*; one manual NVDA pass (VoiceOver out of scope — no Apple hardware); manual perf pass at ~700 MB and ~2 GB; tool README incl. the size bands | hardening |

Phase 1 is shippable at **M5**; M7–M8 harden UX and confidence.

## 13. Decisions, ratified

The defaults the earlier draft flagged "change before M0 if wrong" are settled,
each by a closed ticket or ADR:

- **Rendering:** recycled DOM rows for v1, canvas kept as a documented fallback
  behind the frozen renderer seam ([#7](https://github.com/carllom/bint2/issues/7)).
- **Worker:** dropped from phase 1 — interface *and* implementation. Evidence-gated
  on the M8 perf pass showing paging-attributable main-thread long tasks, or on
  derived work arriving (which gets its own interface)
  ([ADR-0001](adr/0001-bytesource-boundary-and-deferred-worker.md)).
- **Page size 64 KiB, ceiling 256 pages / ≤ 16 MiB; symmetric ±1 Page prefetch;
  strictly-contiguous coalescing; direct reads over 1 MiB**
  ([ADR-0002](adr/0002-page-cache-sized-against-the-viewport.md)).
- **`bytesPerRow`:** fixed presets (8/16/24/32), default 16 — not
  width-responsive; the reflow consequence is documented, not fixed
  ([ADR-0005](adr/0005-the-byte-grid-is-not-a-document.md)).
- **Coordinate model:** `topByteOffset` sole source of truth; the `viewport.ts`
  surface frozen; gross-only thumb drag; no zoom scrollbar; offset-preserving
  bytes-per-row change with the accepted downward ratchet
  ([ADR-0006](adr/0006-topbyteoffset-is-the-only-coordinate.md)).
- **State:** Pinia store (`stores/document.ts`).
- **Dead-source UX:** one visible code, a banner, an escalation counter
  ([ADR-0004](adr/0004-a-dead-source-is-a-banner-not-a-blank-screen.md)).
- **Multi-byte Element view + endianness + non-ASCII encodings:** deferred to
  phase 1.5; what phase 1 owes it is one constraint and two test-pinned rules
  ([ADR-0002](adr/0002-page-cache-sized-against-the-viewport.md) amendment).

## 14. Formerly open questions — now closed

The earlier draft's §12 risk list is resolved:

- **Coarse thumb drag at large row counts** — accepted; wheel + keyboard + Goto
  are the fine path, and the zoom scrollbar is explicitly out of phase 1
  ([ADR-0006](adr/0006-topbyteoffset-is-the-only-coordinate.md),
  [#8](https://github.com/carllom/bint2/issues/8)).
- **Min thumb size vs. exact fraction** — handled in `thumbGeometry` (clamp to
  `[minThumbPx, trackPx]`) and pinned by a test
  ([#8](https://github.com/carllom/bint2/issues/8)).
- **Copying a huge selection** — refuse past 8 MiB of source bytes with a message
  naming the cap and the size; never truncate
  ([ADR-0003](adr/0003-selection-is-one-range-cursor-is-its-collapsed-form.md)).
- **Worker transferables detaching buffers** — moot; no worker
  ([ADR-0001](adr/0001-bytesource-boundary-and-deferred-worker.md)).
