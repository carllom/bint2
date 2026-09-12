# Research: sequential vs. random-access read performance for derived-work scans

Issue: [#96](https://github.com/carllom/bint2/issues/96) (part of the Phase 2 wayfinder map [#95](https://github.com/carllom/bint2/issues/95); blocks [#99](https://github.com/carllom/bint2/issues/99))
Branch: `research/derived-work-scan-performance`
Harness: [`src/core/__prototype__/derived-work-scan.bench.ts`](../../src/core/__prototype__/derived-work-scan.bench.ts), run via [`vitest.bench.config.ts`](../../vitest.bench.config.ts)

## Question

Phase 2's derived work — search, an entropy-map heatmap, a byte-value
histogram — all reduce to the same shape at their core: one full sequential
pass over the document, computing something incremental as bytes go by. Is the
frozen `ByteSource.read()` / `readSync()` random-access interface (ADR-0001)
enough to drive that pass, or does a dedicated sequential-scan primitive (no
offset re-specification per call, internal read-ahead pipelining) win anything
_measurable_? The answer feeds #99, which decides the worker-crossing
interface shape for derived work.

## Method

A running byte-frequency histogram (256 counts) is the shared computational
core of both the entropy map and the byte histogram, and a fair stand-in for
search too — all three are `O(bytes)`, single sequential pass, bounded
per-byte work. The harness drives that histogram purely through
`ByteSource.read()` / `prefetch()` — the interface exactly as frozen, never
touched here — at chunk sizes 64 KiB, 256 KiB, and 1 MiB, and measures:

- **Per-chunk time** — wall-clock from issuing `read()` to the histogram being
  updated with its bytes, summarized as mean / p50 / p95 / max, plus a count of
  chunks whose own time alone exceeded the ~16 ms frame budget.
- **Total wall time** for a full scan.
- Whether **yielding** between chunks (a real macrotask break via
  `setTimeout(0)`, not just another microtask `await`) is affordable, and at
  what cadence.
- Whether a **hypothetical sequential-only primitive** — no offset
  re-specification, internal read-ahead — would win anything a userland helper
  built on today's frozen interface can't already get.

Two fixtures, both following existing repo convention rather than inventing a
new one:

- **Scenario A** — a real, unmodified `FileByteSource` over a real in-memory
  `File` (256 MiB), so `Blob.slice().arrayBuffer()` cost and real `PageCache`
  bookkeeping are both genuinely exercised, not simulated.
- **Scenarios B/D/E/F** — a `SyntheticFileByteSource` that points the real,
  unmodified `PageCache` at a fabricated `fetchRange` instead of a real
  `File.slice()`. Byte `i` holds `i & 0xff`; nothing near the whole logical
  size is ever allocated. This is the same "synthetic ByteSource that
  fabricates a huge logical size" substitution already used at
  `src/components/__tests__/HexViewer.spec.ts`'s `SyntheticByteSource` (and the
  `size = 2e9` shell tests referenced by `docs/manual-passes.md`), extended to
  run the _production_ `PageCache` rather than bypass it, so the measured
  bookkeeping cost is real. `latencyMs` on this fixture is a dial, not a claim
  about this codebase's actual medium — issue #5 already measured that number
  (local `Blob.slice().arrayBuffer()`: sub-ms, off-main-thread). It exists here
  only to find the _ceiling_ on how much a read-ahead primitive could ever win.

Six `it()` blocks, run with `npx vitest run --config vitest.bench.config.ts`
(a dedicated config, `environment: 'node'`, matched only by
`src/core/__prototype__/**/*.bench.ts` — kept out of `npm run test:unit` / CI on
purpose, same status as `docs/manual-passes.md`'s manual passes: a
multi-second full-file scan has no business running on every commit).

**Run context** — build `f4a1a6b`, Node v26.7.0, Windows 11 Pro, single
logical processor visible to the sandboxed run / ~24 GB RAM. Absolute numbers
are this-machine-and-run numbers (compare only within this document); the
_shapes_ of the findings below are the reusable part.

## Results

### A — real `FileByteSource`, real 256 MiB `File`, naive `read()` loop

| chunk   | chunks |         wall |         mean |          p95 |          max | over 16 ms |
| ------- | -----: | -----------: | -----------: | -----------: | -----------: | ---------: |
| 64 KiB  |   4096 | ~1.70–1.74 s |      0.41 ms | 0.60–0.63 ms |   4.6–6.3 ms |          0 |
| 256 KiB |   1024 | ~0.88–0.92 s | 0.86–0.90 ms |   1.6–1.8 ms | 10.6–10.9 ms |          0 |
| 1 MiB   |    256 | ~0.53–0.55 s | 2.08–2.15 ms |   3.6–3.7 ms | 12.2–13.0 ms |          0 |

### B — fabricated 4,000,000,000-byte size, production `PageCache`, naive `read()` loop

| chunk   | chunks |         wall |     mean |          p95 |          max | over 16 ms |
| ------- | -----: | -----------: | -------: | -----------: | -----------: | ---------: |
| 64 KiB  | 61,036 | ~24.2–24.3 s | 0.397 ms |      0.45 ms |  6.9–13.9 ms |          0 |
| 256 KiB | 15,259 |      ~22.8 s |  1.49 ms | 1.73–1.75 ms |       6.5 ms |          0 |
| 1 MiB   |  3,815 |      ~17.8 s |  4.66 ms |       6.7 ms | 9.97–10.5 ms |          0 |

A ~3.7 GiB sequential histogram scan, driven purely by `read()` in a loop,
takes **~18–24 s of wall time** depending on chunk size — and never once
produces a single chunk whose own processing time crosses 16 ms.

### C — yielding cadence, 256 MiB @ 256 KiB chunks (1024 chunks)

| variant                         |             wall | mean (unaffected) |
| ------------------------------- | ---------------: | ----------------: |
| non-yielding                    |      ~483–493 ms |      0.45–0.48 ms |
| `setTimeout(0)` every chunk     | ~14.2–14.4 **s** |      0.98–1.03 ms |
| `setTimeout(0)` every 16 chunks |      ~729–734 ms |      0.42–0.45 ms |

Yielding every chunk costs **~29×** — `setTimeout`'s clamped minimum delay
dominates when paid once per 256 KiB. Yielding every 16 chunks (~4 MiB of
work) costs **~50%** overhead.

### D — naive vs. single-chunk-lookahead pipelining, 16 MiB @ 256 KiB (64 chunks)

| latency | variant             |          wall |         mean |          max | over 16 ms |
| ------- | ------------------- | ------------: | -----------: | -----------: | ---------: |
| 0 ms    | naive               |     ~43–45 ms |      0.70 ms |   1.6–1.8 ms |          0 |
| 0 ms    | pipelined (1-ahead) |     ~42–43 ms |      0.66 ms |       1.7 ms |          0 |
| 2 ms    | naive               |   ~920–942 ms | 14.4–14.7 ms | 18.1–18.8 ms |       9–11 |
| 2 ms    | pipelined (1-ahead) | ~1003–1007 ms |      15.7 ms | 16.6–16.8 ms |      14–16 |

Single-chunk lookahead gives **no measurable win** — at zero latency the two
are indistinguishable, and at 2 ms/chunk latency the pipelined variant is
slightly _worse_ (its extra bookkeeping costs more than the sub-millisecond
compute time it has to overlap).

### E — depth-_N_ `prefetch()` ahead, 16 MiB @ 256 KiB (64 chunks), 2 ms/chunk injected latency

| depth       |        wall |         mean | over 16 ms |
| ----------- | ----------: | -----------: | ---------: |
| 0 (= naive) | ~940–957 ms | 14.7–14.9 ms |       9–13 |
| 2           | ~501–503 ms |       7.8 ms |        0–2 |
| 4           | ~142–158 ms |   2.2–2.5 ms |          0 |

Built entirely on the _existing, frozen_ fire-and-forget `prefetch()` — zero
`ByteSource` changes — depth-4 lookahead cuts wall time by **~83–85%** and
drives `over16ms` to **0** when there's real latency to hide.

### F — depth-_N_ `prefetch()` ahead, 512 MiB @ 1 MiB (512 chunks), **no injected latency**

Three isolated reruns (`vitest run ... -t "F —"`):

| depth | wall (run 1 / 2 / 3) | mean (run 1 / 2 / 3)  |
| ----- | -------------------- | --------------------- |
| 0     | 970 / 986 / 982 ms   | 1.84 / 1.84 / 1.82 ms |
| 2     | 943 / 941 / 935 ms   | 1.29 / 1.30 / 1.30 ms |
| 4     | 912 / 898 / 883 ms   | 1.21 / 1.22 / 1.18 ms |

A small but consistent, reproducible **~6–9%** wall-time reduction, with a
visibly tighter tail (max shrinks from ~5–7 ms at depth 0 to ~3.7–4.2 ms at
depth 4) — smaller than Scenario E's dramatic win because there's much less
real latency here to hide, but not zero.

**Methodology caveat:** one _full-suite_ run (all six `it()` blocks back to
back in one process) showed Scenario F's wall time _increasing_ with depth
(986 → 2299 → 3258 ms) instead of decreasing — almost certainly GC/heap
pressure carried over from Scenario B's ~4 GB of transient allocation
immediately before it in the same process, not a real effect of prefetch
depth. Three independent isolated reruns were consistent with each other (see
table above); the full-suite row is recorded here as a threat to validity, not
a finding, and is a reason to read isolated benchmark runs over batched ones
generally.

## Analysis

**The naive `read(offset, length)` loop's cost profile** is a fixed per-call
overhead (~0.3–0.4 ms — `Promise` machinery, `PageCache` bookkeeping,
`Uint8Array` allocation) plus a cost that grows with chunk size (copying more
bytes, plus, for real `File`s, more `Blob` slicing). That is why _total_ wall
time drops as chunk size grows even though _per-chunk_ time grows: fewer calls
wins over the fixed overhead faster than more bytes-per-call costs. Nothing
about "having to specify `offset` again" shows up anywhere in this cost — it
is one integer addition per iteration.

**No scenario, at any chunk size, without injected latency, ever produced a
single chunk over 16 ms** — not even 1 MiB chunks over a fabricated multi-GB
file (Scenario B: max 10.5 ms). Per-chunk cost is not the frame-budget risk.

**Aggregate wall time is.** A full multi-GB scan is 18–24 seconds of
continuous work (Scenario B). Because each `read()` in that loop resolves
through a microtask (nothing here waits on real, slow I/O), `await`ing it
never yields to the browser's macrotask queue — the queue that rendering and
input actually run on. A loop of fast, `await`ed, microtask-resolving promises
can run for the _entire_ 18–24 seconds without a single frame painting, even
though no individual step is slow. This is the real threat the ticket asked
about, and it is not solved by chunk-size tuning — it needs an explicit,
periodic **macrotask** yield (Scenario C), or moving the work off the main
thread entirely.

**Yielding has to be time-budgeted, not chunk-counted.** Every-chunk yielding
is catastrophic (~29×) because `setTimeout`'s minimum-delay clamp is paid once
per 256 KiB regardless of how little work that chunk did. Every-16-chunks
yielding is cheap (~50% overhead) at this chunk size, but "16" is a magic
number tied to this chunk size and this machine's speed — a real
implementation should yield once a _time_ budget (e.g. 8 ms of scanning) has
elapsed, not after a fixed chunk count, so the cadence self-adjusts to chunk
size and hardware.

**A dedicated sequential-scan primitive's one plausible advantage — read-ahead
— is already available today, in userland, on the frozen interface.**
Single-chunk lookahead (Scenario D) doesn't help, because it only overlaps
sub-millisecond compute against fetch latency: there's nothing to hide when
compute is the fast side. Depth-_N_ lookahead via the existing fire-and-forget
`prefetch()` (Scenarios E/F) is the real technique — it overlaps _multiple_
outstanding fetches with each other, not with compute — and it works: a
dramatic 46–85% win when there's real latency to hide (Scenario E), and a
smaller-but-real, reproducible 6–9% win even at this codebase's actual,
already-fast profile (Scenario F). Both scenarios use zero `ByteSource`
changes — `scanPrefetchAhead()` in the harness is a ~20-line userland helper.

## Recommendation

**1. Keep `ByteSource.read()` / `readSync()` exactly as frozen (ADR-0001). No
dedicated sequential-scan primitive is needed at the `ByteSource` interface
level.** The overhead a bespoke primitive could remove — offset bookkeeping —
is unmeasurable next to costs that exist regardless of who tracks the offset
(allocation/copy mandated by the frozen ownership contract, `Blob` slicing,
`PageCache` bookkeeping). The one technique that _does_ move the needle —
depth-_N_ prefetch pipelining — is fully achievable in userland on top of
`read()` + the already-frozen `prefetch()`, with no interface change at all.

**2. What #99 actually has to solve is not raw byte-access throughput — this
evidence says that's already fine — it's continuous main-thread occupancy plus
cancellation:**

- A full-file derived-work scan is tens of seconds of unyielding,
  microtask-chained work. Whatever drives it must either insert real,
  time-budgeted macrotask yields, or run inside a Worker — which removes the
  problem rather than trading it off (a worker's own blocking never touches
  the main thread's frame budget).
- ADR-0001 already named the shape mismatch: derived work is "one
  long-running request needing progress and cancellation, the opposite shape
  from the small, uncancellable point reads frozen" on `ByteSource`. This
  research doesn't change that conclusion; the measured 18–24 s multi-GB wall
  times make cancellation feel more necessary, not less.
- Taken together, a **Worker is the cleaner answer for derived work**
  specifically — not because `read()` throughput demands it, but because it
  sidesteps the yield-cost tradeoff entirely and gives cancellation/progress a
  natural home (`postMessage` termination, periodic progress messages)
  instead of hand-rolled time-budget checks sprinkled through a main-thread
  loop. This is exactly ADR-0001's second, independent worker trigger
  ("**Derived work** — any feature needing sustained compute over bytes...
  arrives") — #96's own evidence is arguably that trigger firing.
- Whatever #99 lands on — worker-hosted scan or a carefully time-yielded
  main-thread one — the byte-access pattern _inside_ it should still be
  exactly what this harness validates: sequential `read()` calls plus a
  depth-_N_ `prefetch()` pipeline ahead of the cursor. That pattern needs no
  new interface; it needs a home with room for cancellation and yielding,
  which `ByteSource` was deliberately never given.

## Caveats / threats to validity

- **Node, not a browser.** This harness runs in Node (native `File`/`Blob`)
  through a dedicated `environment: 'node'` vitest config, not a real browser
  — deliberately: issue #5 already characterized the browser-specific
  `Blob.slice().arrayBuffer()` cost (sub-ms, off-main-thread) and issue #6 the
  `postMessage`/structured-clone cost. This harness measures what's specific
  to _this_ question instead — the JS-side loop, `PageCache` bookkeeping, and
  histogram cost around calling `read()` repeatedly — which is
  architecture-identical in Node and a browser (same `PageCache`, same
  `FileByteSource`, same V8). Absolute numbers will differ somewhat against a
  real disk-backed file in a browser; the _shapes_ here (per-chunk cost
  profile, yield-cost asymmetry, prefetch-depth payoff curve) should not.
- **In-memory `File`, not a real multi-GB file on disk** — deliberate, per the
  ticket ("You do not need real multi-GB files") and the existing `size = 2e9`
  synthetic convention. Scenario B additionally proves the fabricated-size
  trick scales to genuine multi-GB logical sizes without allocating anywhere
  near that much memory, by pointing production `PageCache` at a
  formula-based `fetchRange`.
- **Scenario F is GC/ordering-sensitive** when run immediately after other
  large-allocation scenarios in the same process — see the caveat under its
  results table. Isolated reruns were the trustworthy, reproducible numbers.
- **`setTimeout(0)`'s exact cost is a Node number here**, not a browser one
  (browsers commonly clamp nested timers to ~4 ms; Node's timer resolution is
  its own thing). The _direction_ of the yielding finding — per-chunk yielding
  is drastically more expensive than batched, time-budgeted yielding — is
  architectural, not Node-specific, but the exact multiplier is worth
  re-checking with a DevTools Performance recording once a real scan exists,
  the same posture `docs/manual-passes.md` already takes toward paging.

## Links

- Harness: [`src/core/__prototype__/derived-work-scan.bench.ts`](../../src/core/__prototype__/derived-work-scan.bench.ts)
- Runner config: [`vitest.bench.config.ts`](../../vitest.bench.config.ts)
- Issue: [#96](https://github.com/carllom/bint2/issues/96) (parent [#95](https://github.com/carllom/bint2/issues/95), blocks [#99](https://github.com/carllom/bint2/issues/99))
- [ADR-0001 — ByteSource boundary: frozen contract, evidence-gated worker](../adr/0001-bytesource-boundary-and-deferred-worker.md)
- Related: [#5](https://github.com/carllom/bint2/issues/5) (`Blob.slice().arrayBuffer()` cost), [#6](https://github.com/carllom/bint2/issues/6) (worker transferables)
