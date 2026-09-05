# Phase 1 — Paged hex / char viewer

Goal: a hex/char viewer that stays responsive on files up to ~1.5 GB by never
holding more than a bounded window of bytes in memory, and by never relying on a
native scrollbar over the full document height.

## 1. Architecture overview

```
┌─────────────────────────── Vue layer (src/components, src/views) ───────────────────────────┐
│  HomeView ─ toolbar (bytesPerRow, goto), status bar                                          │
│    └─ HexViewer.vue  ── owns topByteOffset + view settings, request generation guard         │
│         ├─ VirtualScrollbar.vue   (custom thumb; row-space, not pixel-space)                 │
│         ├─ HexRow.vue × (visibleRows + overscan)   recycled pool                             │
│         └─ FileDropZone.vue                                                                  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
                    │ read(offset, length) : Promise<Uint8Array>   +   readSync() : Uint8Array | null
┌────────────────── src/core (framework-free, unit-tested) ───────────────────┐
│  ByteSource (interface)                                                     │
│   ├─ FileByteSource      File.slice(a,b).arrayBuffer()                      │
│   └─ WorkerByteSource    main-thread proxy → worker (M6)                    │
│  PageCache               fixed 64 KiB pages, LRU, read coalescing, prefetch │
│  viewport.ts             pure math: byteOffset ↔ row ↔ scrollbar fraction   │
│  format.ts               toHex / toAddress / toAsciiChar                    │
│  byte-source.worker.ts   owns File + PageCache, posts transferable buffers  │
└───────────────────────────────────────────────────────────────────────────┘
```

Design rule: everything hard (paging, cache, coordinate math) lives in `src/core`
as plain TS with no Vue import, so it is testable in isolation and the
worker/main-thread split is invisible to the UI.

## 2. Data layer

### ByteSource interface
```ts
interface ByteSource {
  readonly size: number                                   // bytes, may be > 2^32
  read(offset: number, length: number): Promise<Uint8Array>
  readSync(offset: number, length: number): Uint8Array | null  // non-null only on full cache hit
  prefetch(offset: number, length: number): void          // fire-and-forget
  close(): void
}
```
- `readSync` exists so a scroll that lands entirely in cache paints in the same
  frame with no placeholder flicker.
- Requests are clamped to `[0, size)`; a read near EOF returns a short array.

### FileByteSource
- Wraps a `File`. `read` → resolve the covering page range from `PageCache`,
  `blob.slice(pageStart, pageEnd).arrayBuffer()` for misses, assemble the
  requested slice.
- No `FileReader`, no whole-file read, ever.

### PageCache
- Page size 64 KiB. Capacity 256 pages ≈ **16 MiB hard ceiling** (configurable).
- LRU eviction. Coalesces adjacent missing pages into one `slice()` call.
- `prefetch` marks pages wanted and fetches without blocking; `HexViewer` calls
  it for a screen of rows ahead in the current scroll direction.

### Worker (M6, same interface)
- `byte-source.worker.ts` owns the `File` and the `PageCache`; main thread holds
  a `WorkerByteSource` proxy that postMessages `{reqId, offset, length}` and gets
  back a transferable `ArrayBuffer`. Slice + decode move off the main thread.
- Deferred to M6 on purpose: the promise-based interface means M1–M5 work
  unchanged when it lands.

## 3. Virtual scroll model

- `bytesPerRow` — presets 8 / 16 / 24 / 32, default 16. `rowCount = ceil(size / bytesPerRow)`.
- At 1.5 GB / 16 bpr ≈ **94 M rows** — far past the browser element-height limit
  (~33 M px), so there is **no full-height spacer and no native scrollbar**.
- Source of truth: `topByteOffset` (integer, multiple of `bytesPerRow`).
  Derived: `firstRow = topByteOffset / bytesPerRow`.
- `VirtualScrollbar` works in row space:
  - thumb height = `max(minThumbPx, track * visibleRows / rowCount)`
  - thumb pos   = `(track - thumbH) * firstRow / (rowCount - visibleRows)`
  - drag: pixel delta → row delta via the inverse ratio (coarse — one pixel ≈
    100 k+ rows at this scale; that is expected).
  - fine movement comes from wheel (row granularity), keyboard, and **Goto**.
- Changing `bytesPerRow` preserves `topByteOffset` (re-aligned down).
- `viewport.ts` holds all of this as pure functions: `rowOfOffset`,
  `offsetOfRow`, `thumbGeometry`, `offsetFromThumbPixel`, `clampTopOffset`.

## 4. Rendering — recycled DOM rows (v1)

Chosen over canvas for v1: only `visibleRows + overscan` (~60–120) rows are ever
in the DOM, native text selection/copy mostly works, styling and a11y are
simpler. Rendering sits behind a thin boundary so a `CanvasHexRenderer` can
replace it later without touching the data layer.

- Fixed pool of `HexRow` instances, repositioned with `transform: translateY`,
  content updated on scroll — no create/destroy churn.
- Row = address gutter · hex columns · ascii columns, monospace, char width
  measured once.
- Pending state: on scroll, try `readSync`; if null, render the row dim with `··`
  placeholders and repaint when `read` resolves **and** a generation counter
  still matches (stale async responses are dropped).
- Redraw triggers: scroll, resize (`ResizeObserver`), `bytesPerRow` change, data
  arrival.

## 5. Formatting (`format.ts`, pure + tested)

- `toHex(byte, width = 2)` — uppercase, left-padded.
- `toAddress(offset, width = 8)` — hex, widens to 10/12 as the file needs (keep
  room for > 4 GB even though 1.5 GB fits in 8).
- `toAsciiChar(byte)` — `0x20–0x7E` verbatim, else `.`.
- Multi-byte element view (u16/u32/i*/f*, endianness) — **out of scope for
  phase 1**, but leave the seams (`format.ts` stays byte-oriented; a later
  `elementFormat.ts` uses `DataView`).

## 6. File open

- `FileDropZone` — window drag-drop + a hidden `<input type=file>`.
- Use `showOpenFilePicker` where available (nicer, re-openable handle), fall back
  to the input. `File` only for v1.

## 7. Interaction (phase 1)

- Keyboard: ↑↓ row, ←→ byte cursor, PageUp/Dn, Home/End (row), Ctrl+Home/End
  (file), Ctrl+G goto.
- Goto: accepts `0x`-hex or decimal offset; clamps; sets `topByteOffset` and
  cursor.
- Selection: click = cursor; drag / shift-click = byte range; linked highlight in
  both hex and ascii panes; hover highlights the single byte in both panes.
- Status bar: cursor offset (hex + dec), byte value (u8 / i8 / bin), selection
  start–end + length.
- Copy: selection as hex string, or as raw text.

## 8. Vue / project structure

```
src/
  core/
    ByteSource.ts  FileByteSource.ts  PageCache.ts
    viewport.ts    format.ts          byte-source.worker.ts   (M6)
    __tests__/
  components/
    HexViewer.vue  HexRow.vue  VirtualScrollbar.vue  FileDropZone.vue
    StatusBar.vue  HexToolbar.vue
  composables/
    useResizeObserver.ts  useHexNavigation.ts
  stores/
    document.ts        (current source, cursor, selection, view settings)
  views/
    HomeView.vue
```
- Strip template cruft: `HelloWorld.vue`, `TheWelcome.vue`, `WelcomeItem.vue`,
  `components/icons/*`, `AboutView.vue` + its route, `stores/counter.ts`,
  `HelloWorld.spec.ts`. Keep the Pinia/router wiring.
- `stores/document.ts` is a Pinia store so goto / selection / settings are shared
  between toolbar, viewer, and status bar without prop drilling.

## 9. Testing

- **Vitest unit**
  - `format.ts` — table-driven.
  - `viewport.ts` — round-trips, clamping, thumb geometry at 1.5 GB scale, bpr
    changes preserving offset.
  - `PageCache` — LRU eviction order, missing-page coalescing, capacity ceiling,
    prefetch does not exceed capacity.
  - `FileByteSource` — against a synthetic `Blob` whose byte `i == i & 0xff`;
    cross-page reads, EOF short reads, `readSync` null vs hit.
- **Component (Vitest + Test Utils)** — `HexViewer` with a `FakeByteSource`
  (`size` arbitrary, `byte(i) = i & 0xff`, synchronous): assert rendered
  addresses/hex/ascii for a given `topByteOffset`, `bytesPerRow` switch, goto,
  last-row partial rendering at EOF.
- **Playwright e2e** — generate a ~8 MB fixture in setup; open via drop and via
  picker; scroll; Ctrl+End → assert final address and short last row; Ctrl+G to a
  mid offset.
- **Large-file behaviour** — a `SyntheticByteSource` reporting `size = 1.5e9`
  (generated bytes, no allocation) proves scrollbar math and that no code path
  allocates the whole file. Real 1.5 GB perf is a manual pass, noted in the tool
  README.

## 10. Milestones

| # | Deliverable | Phase‑1 done? |
|---|---|---|
| M0 | Strip template, base monospace layout, `src/core` skeleton + CI green | |
| M1 | `format.ts` + `viewport.ts`, fully unit-tested | |
| M2 | `PageCache` + `FileByteSource` (main thread), unit-tested | |
| M3 | `HexViewer` over a small in-memory source: correct address/hex/ascii, bpr presets | |
| M4 | `VirtualScrollbar` + wheel/keyboard nav over a large synthetic source | |
| M5 | Real file open (drop + picker), async read w/ placeholders + generation guard, sync cache-hit fast path | ✅ usable |
| M6 | Move `PageCache`/`FileByteSource` into a Web Worker behind the same interface; transferables; directional prefetch | hardening |
| M7 | Selection + copy, linked hover, status bar, Goto | hardening |
| M8 | e2e suite, manual 1.5 GB perf pass, tool README | hardening |

Phase 1 is shippable at **M5**; M6–M8 harden memory, UX, and confidence.

## 11. Decisions defaulted (change before M0 if wrong)

- **Rendering:** recycled DOM rows for v1, canvas kept as a documented fallback.
- **Worker:** interface is promise-based from day 1, but the worker itself lands
  at M6 — correctness first.
- **Page size 64 KiB, cache ceiling 16 MiB** (256 pages).
- **`bytesPerRow`:** fixed presets (8/16/24/32), default 16 — not width-responsive.
- **State:** Pinia store (`stores/document.ts`).
- **Multi-byte element view + endianness + non-ASCII encodings:** deferred to
  phase 1.5, seams left in `format.ts` / `viewport.ts`.

## 12. Risks / open questions

- Scrollbar drag is inherently coarse at 94 M rows (~100 k rows/pixel). Mitigated
  by wheel + keyboard + Goto; a two-level "zoom" scrollbar could come later.
- `min` thumb size vs. exact fraction — handle in `thumbGeometry` and test.
- Browsers without `showOpenFilePicker` (Firefox) fall back to `<input>`; drop
  works everywhere.
- Copying a huge selection — cap copy size (e.g. 8 MiB) with a warning.
- Worker transferables detach the buffer — cache must own its own copy or
  re-request; decide at M6.
