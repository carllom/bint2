# Phase 2 — Derived work: search, entropy map, byte histogram, and the worker-crossing interface

Goal: deliver **Derived work** — the concept every prior phase has consistently
reserved for "Phase 2" (`CONTEXT.md`'s definition names "searching, entropy
maps, decoding" as its examples;
[#9](https://github.com/carllom/bint2/issues/9)'s resolution named it as the
second Web-Worker evidence gate). Three pieces: a shared **worker-crossing
interface** that finally trips the real Web Worker
[ADR-0001](adr/0001-bytesource-boundary-and-deferred-worker.md) deferred
across phases 1, 1.5 and 1.75; **Search** — hex/text Find, Next/Previous/All,
wrapped, scoped to the file or the current Selection, with a capped Find All
and a persistent **Search results** panel; and the **Entropy map** and **Byte
histogram** — a block-based Shannon-entropy heatmap and a normalized
256-value byte-frequency distribution, sharing one Sidebar panel and one
compute pass.

Phase 2 stays **read-only** — no editing, no writing bytes back — and ships
to GitHub Pages at completion, the same as phases 1, 1.5 and 1.75.
`src/core` stays framework-free, mechanically enforced, including the new
worker script. Everything below is additive to the existing **Sidebar**
stack (`plan-phase1.75.md` §3): Entropy and Search results are two more
Panels appended after Inspector and Bitmap, in that fixed order — no change
to the Sidebar shell, splitter, or accordion mechanics themselves (§3.1,
[ADR-0010](adr/0010-the-inspector-lives-in-a-fixed-sidebar.md)).

> **Status.** Decision-complete. Every design choice below is settled by a
> closed wayfinder ticket on map
> [#95](https://github.com/carllom/bint2/issues/95); the tickets are
> authoritative where they carry more detail than this prose. What remains is
> milestone execution (§8), a separate effort to be broken into tracked build
> issues once this consolidation ticket closes — the same handoff
> `plan-phase1.75.md` made at its own §8.

## 1. What phase 2 adds

| Addition | One line | Tickets |
|---|---|---|
| **Worker-crossing interface** | ADR-0001's Derived-work trigger fires. A new sibling class `DerivedWorkClient` (`src/core`, + `derived-work.worker.ts`) holds its own `File` clone and does its own reads *and* compute entirely off-thread — `ByteSource` stays frozen. One long-lived worker per open document, dispatching `kind: 'search' \| 'stats'`, with a shared progress/cancellation/supersession protocol. | [#96](https://github.com/carllom/bint2/issues/96), [#99](https://github.com/carllom/bint2/issues/99) |
| **Search** | A transient modal Find box (`/` to open, `Esc` to close), hex/text input modes, Find Next/Previous/All, whole-file or Selection scoping, a capped (500) Find All, and a persistent **Search results** Sidebar panel. | [#97](https://github.com/carllom/bint2/issues/97), [#100](https://github.com/carllom/bint2/issues/100) |
| **Entropy map and byte histogram** | One Sidebar panel ("Entropy") with a Map/Histogram mode toggle over one joint compute pass; whole-file or Selection scope; configurable block size; thermal-gradient heatmap with click-to-cursor; a normalized byte-frequency bar chart. | [#98](https://github.com/carllom/bint2/issues/98) |

One research ticket fed the worker decision:
[#96](https://github.com/carllom/bint2/issues/96) (sequential vs.
random-access read performance for derived-work scans —
`docs/research/derived-work-scan-performance.md` and a runnable benchmark
harness at `src/core/__prototype__/derived-work-scan.bench.ts`, branch
`research/derived-work-scan-performance`).

### Guardrails carried from phases 1 / 1.5 / 1.75

- **`src/core` stays framework-free**, mechanically enforced. `DerivedWorkClient`
  and `derived-work.worker.ts` live here; a Worker script has no framework
  dependency to begin with, so this guardrail costs nothing new to hold.
- **`ByteSource` and `PageCache` stay frozen.** [#96](https://github.com/carllom/bint2/issues/96)
  confirmed random-access `read`/`readSync` needs no new sequential-scan
  primitive; `DerivedWorkClient` does not reuse the main-thread `PageCache` at
  all — it reads its own `File` clone inside the worker (§2.2).
- **`DomHexRenderer`, `HexRowRenderer`, `VirtualScrollbar`, and the Bitmap
  (`src/core/bitmap.ts`) stay untouched.** Nothing here touches the byte grid
  or Bitmap rendering paths.
- **No code path branches on file size.**
- **Read-only.** No editing, no writing bytes back.
- **Sidebar / Panel shell frozen** (`plan-phase1.75.md` §3, ADR-0010): Entropy
  and Search results are new Panels slotted into the existing fixed stack, not
  a new layout mechanism.

## 2. The worker-crossing interface ([#96](https://github.com/carllom/bint2/issues/96), [#99](https://github.com/carllom/bint2/issues/99), [ADR-0013](adr/0013-derived-work-gets-its-own-worker-not-bytesource.md))

### 2.1 The trigger fires

[ADR-0001](adr/0001-bytesource-boundary-and-deferred-worker.md) named two
independent Worker triggers. The first — paging long tasks at the ~700 MB
tier — never fired ([#32](https://github.com/carllom/bint2/issues/32)'s M8
manual perf pass). The second — "any feature needing sustained compute over
bytes... arrives" — **has now fired**.
[#96](https://github.com/carllom/bint2/issues/96)'s benchmark (a running
byte-frequency histogram, the shared computational core of search and
entropy/histogram, driven through the frozen `ByteSource.read()`/`prefetch()`
against a real `FileByteSource` and a fabricated ~3.7 GiB synthetic source)
found:

- **Per-chunk cost never threatens the 16 ms frame budget**, at any tested
  chunk size (64 KiB / 256 KiB / 1 MiB) — max observed 13.9 ms.
- **A full multi-GB scan is 18–24 s of continuous main-thread work**, and
  because `ByteSource.read()` resolves via microtask, `await`ing it in a loop
  never yields to rendering/input — the scan can run start-to-finish without
  a single frame painting, independent of per-chunk cost.
- **Yielding must be time-budgeted, not chunk-counted**: `setTimeout(0)`
  every chunk costs ~29× total wall time; every 16 chunks costs ~50%
  overhead.
- **The one plausible win from a dedicated sequential-scan primitive —
  read-ahead — is already available in userland**, built on the existing,
  frozen fire-and-forget `prefetch()`: 46–85% faster under injected I/O
  latency, ~6–9% faster even at this codebase's real fast profile. No
  `ByteSource` interface change is needed to get it.

Chunked main-thread async with time-budgeted yielding was considered and
rejected for phase 2 (ADR-0013): it mitigates the non-yielding-loop problem
rather than making it structurally impossible, and is easy to regress into
exactly the chunk-counted mistake #96 measured. **Decision: build the real
Worker now.**

### 2.2 Architecture — `DerivedWorkClient`

A new sibling class in `src/core`, paired with `derived-work.worker.ts`:

- Constructed the same way as `FileByteSource` — `new DerivedWorkClient(file)`
  — alongside `new FileByteSource(file)` wherever a document opens.
- Holds its **own** `File` clone (structured-cloned once into the worker) and
  does its **own** reads *and* compute entirely inside the worker's event
  loop. The whole scan — read and compute — runs off-thread.
- Does **not** reuse the main thread's `PageCache`
  ([ADR-0002](adr/0002-page-cache-sized-against-the-viewport.md)) — that's
  sized for random re-access against the Viewport, and a one-pass forward
  scan gets nothing from its LRU bookkeeping.
- Does **not** bolt onto `ByteSource`'s interface — per ADR-0001's explicit
  prohibition: a cancellable, progress-reporting, long-running request is
  "the opposite shape" from `ByteSource`'s frozen small uncancellable point
  reads.
- Uses the same read-ahead technique #96 validated: depth-*N* lookahead built
  on `prefetch()`, applied to the worker's own sequential read loop.

### 2.3 Lifecycle

One worker per open document — long-lived, created at open, terminated on
`close()`. This reuses ADR-0001's existing "terminates the worker if one
exists" language, now actually exercised.

### 2.4 Dispatch and job kinds

One shared worker instance handles every job kind, dispatched on a `kind`
field: `'search'` and `'stats'` (`stats` = entropy map + byte histogram
together, per [#98](https://github.com/carllom/bint2/issues/98)'s
one-joint-compute-pass decision — no separate kinds for two renderings of one
scan). Jobs are mutually exclusive by the supersession rule (§2.7), so
separate worker instances per job type would buy no concurrency, only
redundant `File`-clone and boot cost.

### 2.5 Protocol

- **Progress** — a generic envelope, `{reqId, kind: 'progress', percent,
  extra?}`. `percent` is offset ÷ size for any job; `extra` carries
  job-specific data (search's running match count). One progress-bar-plus-
  Cancel UI drives every job kind off `percent` alone.
- **Cancellation** — hard. The worker's chunked read loop (chunked for the
  same time-budget-yielding reason §2.1 found necessary) checks a
  cancelled-`reqId` set between chunks and actually stops, then acks
  `{reqId, kind: 'cancelled'}`, retiring the `reqId` so a result already in
  flight when cancelled can never land as if it were live.
- **Results** — typed-array payloads (match offsets, entropy `Float32Array`,
  histogram `Uint32Array(256)`) move via `postMessage`'s transfer list, not
  structured-clone.
- **Code pages** — a request carries a codepage id only; the worker statically
  imports `src/core/codepages` (already framework-free and importable in a
  worker) and builds its own reverse (glyph→byte) table for text-mode search.
- **Errors** — `DerivedWorkClient` gets its own error-code union, distinct
  from `ByteSourceErrorCode`. It includes its own `source-gone` detection,
  scoped to failing just that job (`{reqId, ok:false, code:'source-gone',
  message}`) — it does **not** drive
  [ADR-0004](adr/0004-a-dead-source-is-a-banner-not-a-blank-screen.md)'s
  app-level dead-source banner, which stays `FileByteSource`'s
  responsibility (paging is continuous and virtually always first to notice
  a dead source anyway).

### 2.6 The read/access pattern

`ByteSource.read()`/`readSync()` stay exactly as frozen by ADR-0001 — no
dedicated sequential-scan primitive is needed at that layer (§2.1). Inside
the worker, `DerivedWorkClient` reads its own `File` clone directly (not
through `ByteSource` at all — it is a wholly separate interface, per §2.2),
using the same chunked-with-read-ahead shape #96 validated.

### 2.7 Supersession, cancellation, and no-op rules (shared by every job)

Fixed on the map's Notes and confirmed by every downstream ticket — one
protocol every derived-work job (Find Next/Previous, Find All, the Entropy
Compute) obeys:

- A **new/different** job request (a changed search term, mode,
  case-sensitivity or scope; a new Find All; a new Entropy Compute) always
  **cancels/supersedes** whatever job is currently running.
- A **same-term** Find Next/Previous is a **no-op while a job is in flight**
  — it never queues, never cancels itself.
- A running job always shows a visible **Cancel/Stop** control, regardless of
  the operation's cap.

## 3. Search ([#97](https://github.com/carllom/bint2/issues/97), [#100](https://github.com/carllom/bint2/issues/100))

### 3.1 Container and trigger

A **transient modal Find box** (GotoBox-style, not a persistent Sidebar
panel) — opens on **`/`** while the grid has focus (consistent with the
`code`-bound-key convention: `b`, the Bitmap's `,`/`.`/`L`), closes on `Esc`,
which also cancels any in-flight job. Term, mode, case-sensitivity and scope
persist across close→reopen **for the session** — the same session-scoped
persistence as the Bitmap's Lock state (`plan-phase1.75.md` §3.6), not a
`localStorage`-backed preference.

Opening pre-populates the term from the current Selection's bytes when one
exists (hex mode: raw bytes; text mode: decoded via `charFor`), capped at
**16 bytes**, silently truncated; falls back to the last-used term otherwise.

### 3.2 Input modes

- Explicit **hex / text toggle** — no auto-detection — defaulting to the
  last-used mode.
- **Text mode**: case-insensitive by default, with a toggle (hidden, not
  disabled, in hex mode). Matching uses a **reverse (glyph→byte) table** built
  per Code page, restricted to real, injective entries — the shared
  placeholder glyph (`.` for unmapped/control bytes, per `charFor` in
  `src/core/codepages/index.ts`) is excluded, so a typed `.` only ever
  matches the literal period byte, never a control byte rendering the same
  way.
- **Hex mode**: invalid input (odd digit count, non-hex characters) is an
  inline validation error; Find is disabled until fixed — no best-effort
  silent parsing.

### 3.3 Matching and navigation

- `Enter` = Find Next, `Shift+Enter` = Find Previous, fired from the box's
  input. Find All is **button-only**, no keybinding (avoids `Ctrl+Enter`
  ambiguity against Enter/Shift+Enter).
- A match moves the **Cursor** to the match's first byte via the existing
  `setCursor` (which always collapses the Selection — there is no separate
  cursor field) and scrolls it into view. It does **not** set a full-range
  Selection over the match.
- Wrap at BOF/EOF is silent (no confirmation gate), communicated via a shared
  status-line message in the box ("Wrapped to start of file"); "No match
  found" uses the same region, mutually exclusive with the wrap message.
- Find Next/Previous deliberately never shows a live match count/index ("N of
  M") — that's exclusively Find All's / the Search results panel's territory.
- A same-term Find Next/Previous while a job is in flight is a no-op, made
  legible via a spinner tied to the Cancel/Stop control (§2.7).

### 3.4 Scoping

Toggle between **whole file** and the current **Selection** (reusing the
existing Selection concept, no new range picker) — disabled, not hidden, when
no non-collapsed Selection exists. Switching scope to "Selection" **captures
that byte range once, at the moment of the toggle**, and reuses the captured
range for every subsequent Next/Previous — independent of what the live
Selection becomes afterward, including the collapse each match causes.
Re-toggling scope off/on forces a fresh capture. Any change to term, mode,
case-sensitivity, or scope while a job is running cancels it (§2.7).

### 3.5 Find All and the cap ([ADR-0014](adr/0014-find-all-stops-early-with-a-labeled-partial-list.md))

**Cap: 500 results.** Hitting it **stops the scan early and shows a labeled
partial list** ("first 500 shown — narrow your search"), not a refusal — a
deliberate break from Copy's refuse/never-truncate precedent
([ADR-0005](adr/0005-the-byte-grid-is-not-a-document.md)). The two cases
differ in what the cap protects against: Copy's output leaves the app as an
opaque blob with no marker that it's incomplete, so refusing is the only
honest option; the Search results panel never leaves the app — the "first
500 shown" label is visible at the moment the results appear, in the same
surface the reader would use to narrow the search. A capped, labeled partial
list is strictly more useful than a refusal here, and no less honest.

### 3.6 The Search results panel

A new persistent Sidebar panel, populated automatically when Find All
completes (Find All is already the explicit action — no second "send to
panel" step):

- **Populates once, at job completion or cap** — not progressively, matching
  the Entropy panel's same-shape convention (§4).
- **Per-hit contents**: offset + a short preview of the matched bytes
  (current Code page in text mode, raw hex in hex mode).
- **Click** a row → `setCursor` at that hit (collapsing the Selection);
  **Shift+click** → `extendSelectionTo` the full matched range — reusing the
  Bitmap's click/Shift-click convention
  ([ADR-0008](adr/0008-bitmap-origin-follows-or-locks-to-the-cursor.md),
  [ADR-0011](adr/0011-extent-marker-is-a-passive-gutter-overlay.md)) —
  followed by `revealOffset` to scroll the hex grid to that row.
- **Persistence across a new search**: starting a new/different search term
  (which cancels the running job, per §2.7) leaves the **previous completed
  search's results visible, marked stale**, until the new job finishes —
  matching the Entropy panel's stale-marking convention, not clearing
  immediately.
- **Sidebar order**: Inspector, Bitmap, Entropy, **Search results** —
  appended at the end (already reflected in `CONTEXT.md`'s **Panel** entry).

### 3.7 Documentation

**No ADR** for the search mechanics themselves — every seam touched (the
modal-overlay pattern from GotoBox, Selection/Cursor from ADR-0003, the
focus-scoped-key convention from `b`/the Bitmap's `,`/`.`/`L`) already exists
and already anticipated this use. **No new `CONTEXT.md` term** for "Find" or
"Search" — neither is ambiguous in this domain the way Selection/Element/
Annotation were before being pinned down. **ADR-0014** covers the Find All
cap decision specifically; **Search results** is a new `CONTEXT.md` term
(already landed).

## 4. Entropy map and byte histogram ([#98](https://github.com/carllom/bint2/issues/98), [ADR-0012](adr/0012-entropy-map-and-byte-histogram-share-one-panel-because-they-share-one-scan.md))

### 4.1 One panel, not two

**One Sidebar panel, "Entropy,"** slotting into the fixed order right after
Bitmap: **Inspector, Bitmap, Entropy**. Holds a **Map/Histogram mode
toggle** — a pure view-swap over one computed result, the same shape as the
Bitmap's Follow/Lock toggle. Two independent panels was the starting answer
during grilling and was reversed once the shared scan was taken seriously:
computing them independently would mean either doubling the cost of a scan
§2.1 found runs 18–24 s continuously, or one panel's Compute silently
populating the other's state — a real cross-panel coupling the
independently-collapsible Panel model can't express cleanly. See
**ADR-0012** for the full reasoning and the rejected alternatives.

### 4.2 Shared compute pipeline

One joint scan in `src/core` takes `(range, blockSize)` and produces both the
per-block entropy array and the 256-value byte-count array from a single
pass — dispatched to the worker as the `'stats'` job kind (§2.4). **One
explicit "Compute" action** always runs the full joint scan and populates
both renderings together, regardless of which mode is showing; the mode
toggle never retriggers it. Compute is explicit, not live-recompute-on-drag,
per §2.1's finding that a full-file scan can block the tab for 18–24 s — a
visible Cancel/Stop control is always present (§2.7). The block-size control
stays visible in both modes, since it feeds the one shared scan the reader is
looking at, not just the Map half of it.

### 4.3 Scoping and staleness

Per-panel **"Whole file" / "Selection"** radio (Selection disabled, falling
back to Whole file, when none exists — reuses the Selection concept, no new
range picker). Changing scope, the Selection's range, or block size marks the
current joint result **stale** (dimmed, with a recompute affordance) rather
than clearing it or auto-recomputing.

### 4.4 Entropy map

- **Block size**: configurable, default **256 bytes**, persisted like
  `bitmapWidth` (§5) — the same role Width plays for the Bitmap.
- **Rendering**: a multi-hue **thermal gradient** (green→yellow→red),
  theme-adjusted saturation/lightness rather than hue-swapped — a deliberate
  exception to the app's otherwise monochrome/single-accent palette, because
  fast pattern recognition across entropy levels is the point.
- **Click-to-cursor**: plain click → `setCursor` at the block's first byte;
  Shift+click → `extendSelectionTo` the block's last byte (selecting the
  whole block, not a point); both followed by `revealOffset` — the same
  vocabulary as the Bitmap's click-to-cursor
  (ADR-0008/ADR-0011, [#71](https://github.com/carllom/bint2/issues/71)),
  adapted because a block spans multiple bytes where a Bitmap pixel maps to
  ~1 byte.

### 4.5 Byte histogram

- `value[byte] = count[byte] / totalBytesInRange` — normalized, no
  positional axis (two ranges with the same bytes in a different order
  produce the same histogram, per `CONTEXT.md`'s definition).
- Bar height scaled to the **range's own max frequency**, not a fixed
  0–100% axis (a fixed axis would render as near-flat slivers for most real
  files).
- **Bespoke canvas** bar chart, no charting library — consistent with the
  Bitmap's bespoke-rendering precedent and the framework-free-core
  convention.
- Clicking a bar does **nothing beyond a hover tooltip** (count/percentage)
  — no click-to-cursor, no highlight-all-occurrences. Highlighting scattered
  multi-byte-value occurrences would brush against the out-of-scope
  **Annotation** concept (§10); deliberately deferred, not decided here.

### 4.6 Documentation

New `CONTEXT.md` terms **Entropy map** and **Byte histogram** (already
landed). The joint scan itself gets no term — internal plumbing this ADR
fully explains, not reader-facing vocabulary like `ByteSource`/`Page`.
**ADR-0012** records the one-panel/one-scan decision.

## 5. Boundary matrix — what each new setting reaches

Field names below follow this codebase's established naming convention
(`bitmap*`, `inspectorOpen`/`bitmapOpen`) for consistency with §3.4 of
`plan-phase1.75.md`; exact identifiers are chosen at milestone execution
(§8), not fixed by any ticket — only the persisted/session split and the
owning component are decisions.

| Setting | Persisted? | Owned / read by |
|---|---|---|
| Entropy panel open | ✅ persisted (like `inspectorOpen`/`bitmapOpen`) | Accordion `v-model` bridge, `EntropyPanel` |
| Search results panel open | ✅ persisted (like `inspectorOpen`/`bitmapOpen`) | Accordion `v-model` bridge, `SearchResultsPanel` |
| Entropy block size | ✅ persisted (like `bitmapWidth`) | `EntropyPanel` state, the joint scan call site |
| Entropy/Histogram mode toggle (Map vs. Histogram) | ❌ session only | `EntropyPanel` — a pure view-swap, no reason to survive reload |
| Entropy scope (Whole file / Selection) | ❌ session only | `EntropyPanel` — mirrors the Bitmap Origin mode's session-only precedent (ADR-0008) |
| Search term / mode / case-sensitivity / scope | ❌ session only, survives Find box close→reopen within the session | `SearchStore` (or equivalent) — mirrors the Bitmap Lock state's session-only precedent (`plan-phase1.75.md` §3.6) |
| Search results contents | ❌ session only | `SearchResultsPanel` — cleared on document close, like the Inspector/Bitmap's document-scoped state |
| Byte order | ✅ persisted (phase 1.5) | Text-mode search does **not** read it — text matching goes through the Code page's reverse table, not numeric decode |
| Code page | ✅ persisted (phase 1.5) | Text-mode search's reverse table, and both Search results' and Find box's byte previews |

## 6. `CONTEXT.md` and ADRs

| Change | Where | Ticket |
|---|---|---|
| New **Entropy map**, **Byte histogram** terms; **ADR-0012** — *Entropy map and byte histogram share one panel because they share one scan* | `CONTEXT.md`, `docs/adr/0012-…` | [#98](https://github.com/carllom/bint2/issues/98) |
| **ADR-0013** — *Derived work gets its own Worker, not `ByteSource`'s*; ADR-0001's Trigger section amended to point forward to it | `docs/adr/0013-…`, `docs/adr/0001-…` | [#99](https://github.com/carllom/bint2/issues/99) |
| New **Search results** term; the **Panel** term corrected from "two exist" to all four (Inspector, Bitmap, Entropy, Search results); **ADR-0014** — *Find All stops early with a labeled partial list, not a refusal* | `CONTEXT.md`, `docs/adr/0014-…` | [#100](https://github.com/carllom/bint2/issues/100) |
| Research findings + benchmark harness | `docs/research/derived-work-scan-performance.md`, `src/core/__prototype__/derived-work-scan.bench.ts` (branch `research/derived-work-scan-performance`) | [#96](https://github.com/carllom/bint2/issues/96) |

**No ADR and no `CONTEXT.md` change** from
[#97](https://github.com/carllom/bint2/issues/97) (Search mechanics — every
seam touched already exists and already anticipated this use, per §3.7).

## 7. Testing

Same three-seam order as phases 1, 1.5 and 1.75 (`docs/plan-phase1.md` §11)
— prefer the highest seam that can observe the behaviour. Exact test names
and fixtures are milestone-execution detail (§8); this section fixes the
scenarios that must be covered.

**1. Application shell mounted whole** (the top seam) — extended with an
injectable `DerivedWorkClient` factory, mirroring the existing injectable
`ByteSource` factory, so tests can substitute a synchronous fake worker
client without spinning up a real `Worker`:

- **Worker lifecycle**: one `DerivedWorkClient` created per document open,
  terminated on `close()`; opening a second document does not leak a worker
  from the first.
- **Supersession (§2.7)**: a new/different job cancels an in-flight one; a
  same-term Find Next/Previous no-ops while one is in flight (spinner shown,
  no second job dispatched); Cancel/Stop is always visible and actually
  retires the `reqId` (a cancelled result that arrives late is dropped, never
  rendered as live).
- **Search**: hex/text mode toggle and validation; the Code page reverse
  table excludes the placeholder glyph; term pre-population from a Selection,
  capped and truncated at 16 bytes; Enter/Shift+Enter Next/Previous;
  Selection-scope capture-once-at-toggle survives the Cursor collapsing on
  each match; wrap messaging at BOF/EOF; `/` opens the box from a
  grid-focused state and not from other focused elements; `Esc` closes and
  cancels.
- **Find All / cap**: exactly 500 results on a file with more matches, the
  "first 500 shown" label, the scan actually stopping (not silently
  continuing past the cap); the Search results panel populating once at
  completion; click / Shift-click row behaviour; a new search leaving the
  previous results visible and marked stale until the new job finishes.
- **Entropy panel**: the Map/Histogram toggle never retriggers Compute; scope
  or block-size changes mark the result stale without clearing or
  auto-recomputing; Compute populates both renderings together from one
  dispatched `'stats'` job; click / Shift-click on a block; the histogram's
  hover tooltip and its click-does-nothing-else behaviour.
- **Panel wiring**: Entropy and Search results slot into the accordion after
  Bitmap in the fixed order; their open state persists like
  `inspectorOpen`/`bitmapOpen`; `unmount-on-hide` semantics match the
  existing Panels.

**2. Pure core, direct unit tests**:

- The joint entropy/histogram scan function (`(range, blockSize) →
  {entropy, histogram}`) against known byte patterns (all-zero block →
  entropy 0, uniformly random block → entropy near 8, a repeating pattern's
  histogram matching hand-computed frequencies).
- The Code page reverse-table builder: injective mappings only, the shared
  placeholder glyph excluded.
- `derived-work.worker.ts`'s message-handling logic, tested as a plain
  module against fake `postMessage`/`onmessage`, independent of a real
  Worker context where feasible.
- The framework-free check passes for every new `src/core` module, including
  the worker script.

**3. Playwright e2e** — deliberately thin, following the phase-1 line. Added
journeys: open a fixture file, open Search (`/`), Find Next moves the Cursor
and reveals the row; Find All on a pathological repeated-byte file shows the
capped, labeled Search results list; click a result row and see the Cursor
jump; open the Entropy panel, Compute, see both the heatmap and histogram
populate, then click a block and see the Cursor jump; start a long Compute on
a large fixture and confirm Cancel actually stops it (no stale result
appears afterward).

**Deliberately not automated**: exact heatmap colours beyond the gradient
function's pinned fixtures (visual, low-value); real-world timing of the
18–24 s multi-GB scan (covered by #96's benchmark harness, kept out of CI
like `docs/manual-passes.md`'s manual passes).

## 8. Milestones

**Left as a placeholder, deliberately.** Per "plan, don't do": this map's
tickets resolve decisions, not build steps. Every design choice above is
settled; breaking phase 2 into tracked, ordered build issues (mirroring
`plan-phase1.75.md` §8's `P1.75-M1`…`M9` table) is a **separate future
effort**, to begin once this consolidation ticket closes — the same handoff
[#75](https://github.com/carllom/bint2/issues/75) made for 1.75's own
milestone breakdown.

## 9. Not yet specified

Carried from map [#95](https://github.com/carllom/bint2/issues/95), reviewed
during this consolidation and confirmed still fog — nothing decided in
[#96](https://github.com/carllom/bint2/issues/96)–[#100](https://github.com/carllom/bint2/issues/100)
made it specifiable or moved it to Out of scope:

- **Streaming/structured decode** — the third Derived-work example named in
  `CONTEXT.md` ("searching, entropy maps, decoding"). No concrete use case
  has surfaced to make this ticketable — search and entropy/histogram were
  both specified concretely during charting, decode wasn't. Graduates into
  its own ticket (or its own future phase) once a real practical example
  shows up.

## 10. Out of scope

Carried from map [#95](https://github.com/carllom/bint2/issues/95). These do
not graduate within this effort — they return only if a later phase redraws
the destination.

- **The element grid** — rendering the document's rows *as* decoded Elements
  rather than bytes. Carried unpinned-to-any-phase since phase 1.5 §10 and
  repeated in phase 1.75's Out of scope; this map's destination is Derived
  work only.
- **Persisting the Origin mode / named saved Bitmap views** — flagged in
  ADR-0008's Consequences as "a sanctioned later extension near the
  **Annotation** concept," not Derived work.
- **Painting pixels to edit bytes / hex editing** — read-only, carried from
  phases 1, 1.5, and 1.75.
- **Highlighting every occurrence of a clicked byte histogram value** —
  considered during [#98](https://github.com/carllom/bint2/issues/98) and
  rejected: a multi-range highlight is Annotation-adjacent (`CONTEXT.md`'s
  **Annotation**, "many can exist at once") and the rendering-cost/model
  questions it raises weren't part of this destination; the histogram's
  click behaviour stays a hover tooltip only.

## 11. Decisions, ratified

Each row is a closed wayfinder ticket on map
[#95](https://github.com/carllom/bint2/issues/95); open its link for the full
reasoning.

| Decision | Ticket |
|---|---|
| Random-access `read`/`readSync` is sufficient and performant for whole-file derived-work scans — no `ByteSource` change needed; read-ahead via the existing `prefetch()` already captures the only measurable win; the real gap is a worker-crossing interface for cancellation and continuous-occupancy, not read throughput | [Research: sequential vs. random-access read performance for derived-work scans](https://github.com/carllom/bint2/issues/96) |
| Search mechanics: transient modal Find box (`/`/`Esc`), explicit hex/text toggle, per-Code-page reverse-table text matching excluding the placeholder glyph, Enter/Shift+Enter Next/Previous, Selection-scope captured once at toggle, wrap/no-match sharing one status message, Find All button-only; no ADR, no `CONTEXT.md` term | [Search mechanics: input modes, matching semantics, Selection scoping, keybinding](https://github.com/carllom/bint2/issues/97) |
| One Sidebar panel ("Entropy"), not two, with a Map/Histogram toggle over one joint compute pass, one explicit Compute action with Cancel/Stop, per-panel scope with staleness marking; configurable block size (default 256 B), thermal gradient, Bitmap-style click-to-cursor; normalized bespoke-canvas histogram, hover-tooltip-only clicks; **ADR-0012**; new **Entropy map** / **Byte histogram** terms | [Entropy map and byte histogram: panel design and shared compute pipeline](https://github.com/carllom/bint2/issues/98) |
| ADR-0001's Derived-work trigger fires — build the real Worker. New `DerivedWorkClient` (`src/core` + `derived-work.worker.ts`), own `File` clone, own off-thread reads and compute, `ByteSource`/`PageCache` untouched; one long-lived worker per document; shared `kind: 'search' \| 'stats'` dispatch; generic progress envelope, hard cancellation, transferred typed-array results, codepage-by-id, its own error-code union; **ADR-0013** | [Worker-crossing interface: build the real Worker now, or chunked main-thread async?](https://github.com/carllom/bint2/issues/99) |
| Find All cap: 500, hitting it stops the scan early with a labeled partial list, not a refusal — **ADR-0014**; Search results panel populates once at completion with offset + preview per hit, click/Shift-click reuse the Bitmap convention, stale-marked on a new search, slots in after Entropy; new **Search results** term, **Panel** entry corrected | [Find All: result-cap behavior and the Search results panel](https://github.com/carllom/bint2/issues/100) |
