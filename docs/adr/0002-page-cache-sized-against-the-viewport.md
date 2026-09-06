# Page cache sized against the viewport, not the file

`docs/plan-phase1.md` §2/§11 specified 64 KiB pages, a 256-page / 16 MiB LRU
ceiling, adjacent-miss coalescing and "prefetch a screen of rows ahead in the
current scroll direction". Those numbers were chosen against intuition about
*file* size. Measured against the *viewport* they read very differently, and the
policy in the last of them turns out not to be implementable as written.

## The measurement that reframes everything

The renderer prototype (branch `prototype/renderer-recycled-dom-rows`,
[#7](https://github.com/carllom/bint2/issues/7)) fixes row height at **18 px**
and a recycled pool of **33–160 rows**, default 49. So:

| | bytes on screen |
|---|---|
| typical (49 rows × 16 bpr) | **784 B** |
| worst case (160 rows × 32 bpr) | **5 KiB** |

One 64 KiB page is therefore **13–83 screens** of bytes; a viewport spans at most
**2 pages**; and the 16 MiB ceiling is roughly **3,200 screens**. "A screen of
rows ahead" is under 8% of a single page — not a prefetch policy, a rounding
error.

**Decision:** keep the page size and the ceiling exactly as §2/§11 specified —
the over-provisioning is deliberate and cheap — and rewrite the prefetch,
coalescing and large-read policies around the viewport measurement above.

## What is settled

- **Page size 64 KiB; ceiling 256 pages, counted in pages, documented as
  ≤ 16 MiB.** 13× read amplification on a Goto is free when the read is sub-ms
  ([#5](https://github.com/carllom/bint2/issues/5)), and the payoff is that page
  boundaries are crossed only every 2,048–4,096 rows of scrolling. The ceiling is
  ~30× the working set; that headroom is what makes back-scroll and return from a
  Goto excursion free, and 16 MiB is noise on a desktop. A slot count is the
  invariant §9 pins.
- **Prefetch is symmetric ±1 page around the viewport; there is no scroll
  direction.** Two pages of speculation costs 128 KiB and gives 13–83 screens of
  runway in *both* directions. This deletes the direction-reversal question
  rather than answering it, and removes last-delta-sign state from a hot path.
- **`HexViewer` triggers, `PageCache` expands.** The viewer makes one
  `prefetch(offset, length)` call per scroll settle with the visible span; the
  cache is what turns a span into "covering pages, ±1 each side, clamped to
  `size`". The policy lives in one place in `src/core`, and ADR-0001's frozen
  `prefetch` is live API at M5 rather than a stub.
- **Prefetched pages enter at the MRU end.** Cold-insert is the textbook
  anti-pollution move, but there is no pollution to prevent at 30× headroom, and
  it introduces a real failure: a prefetched page evicted by the *next* prefetch
  before its read arrives, wasting the fetch and stalling the paint.
- **Pending pages occupy a slot and are pinned** until they resolve, so capacity
  bounds `resident + pending`. In-flight count is bounded by prefetch depth plus
  one read, so the pin cannot deadlock. Concurrent reads of one pending page
  **share a single in-flight promise** — never two `slice()` calls for one page.
- **Both `read` and `readSync` hits promote to MRU.** `readSync` is the per-frame
  path; a working set that never promoted would age out beneath a live scroll.
- **Coalescing joins strictly contiguous runs of missing pages, capped at 16
  pages / 1 MiB.** Bridging resident pages would re-read bytes already in memory
  to save a sub-ms call. The cap is independent and load-bearing:
  [#5](https://github.com/carllom/bint2/issues/5) identified whole-slice reads of
  hundreds of MB as the actual hazard (`RangeError` near ~2 GiB, memory
  doubling), so the coalescer needs a ceiling that is not "whatever the caller
  asked for".
- **Reads over 1 MiB are direct reads**: served by `slice()` in capped chunks,
  populating nothing, consulting resident pages only where they already exist.
  §12's ~8 MiB copy cap is otherwise a single `read` of 128 pages — half the
  cache — flushing the entire working set to serve a one-shot copy.
- **The render path reads per row**, not per visible span. A whole-span
  `readSync` across a page boundary with one page resident returns `null` under
  ADR-0001's "non-null only on a full local hit", flipping *every* row to `··`
  placeholders including rows whose bytes are in memory. Per-row reads paint the
  resident rows and placeholder only the remainder. The cost is ~160 map lookups
  and ≤32-byte copies per frame.
- **`PageCache` never sees a `File`.** It takes `{ fetchRange(start, end), size }`
  plus an options object `{ pageSize, capacityPages, prefetchPages,
  directReadThreshold }` defaulting to the numbers above. §9 wants LRU-order,
  coalescing, ceiling and prefetch tests, all of which need a fake fetch with
  controllable timing rather than a `Blob` — and the same instance is what a
  worker would own later, per ADR-0001.
- **The cache exposes `stats`**: `{ hits, misses, evictions, pagesResident,
  pendingCount, bytesFetched }`. ADR-0001 gates building the worker on the M8
  perf pass showing long tasks *attributable to paging*; without counters that
  attribution is a judgement call rather than a measurement.

## Consequences

- **Amends ADR-0001**: a coalesced `slice()` that rejects fails every pending page
  in the run with `read-failed` and *removes* the entries — no negative caching —
  which on a `source-gone` file would retry a doomed read every frame forever.
  So `source-gone` **latches** `FileByteSource` into a terminal state: subsequent
  reads reject immediately without touching the disk and `readSync` returns null.
  What the UI does when a source latches is not settled here.
- **Per-row reads constrain the phase-1.5 element view.** A `u32` at a row or page
  boundary needs bytes the row's own read does not contain, so the element view
  cannot be a pure `format.ts` change layered on the row read path. Left open
  deliberately; it is the subject of its own ticket.

## Considered options

- **Directional prefetch, as §2/§11 specified** — rejected: unimplementable as
  written (a screen is <8% of a page), and once expressed in pages the symmetric
  version is cheap enough that direction tracking buys only a reversal bug.
- **A smaller ceiling (64 pages / 4 MiB)** so eviction is exercised in real use —
  rejected: eviction is exercised by unit tests injecting a small capacity, which
  is deterministic; shrinking the production ceiling trades free memory for lost
  back-scroll.
- **Cold-insert for prefetched pages** — rejected, see above.
- **Gap-bridging coalescing** — rejected, see above.
- **Whole-span reads from the render path** — rejected: same total work, strictly
  worse degradation at page boundaries.
