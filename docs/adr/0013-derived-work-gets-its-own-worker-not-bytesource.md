# Derived work gets its own Worker, not ByteSource's

[ADR-0001](./0001-bytesource-boundary-and-deferred-worker.md) froze the
`ByteSource` interface and declined to build a Web Worker in phase 1,
evidence-gated on two independent triggers. The first — paging long tasks at
the ~700 MB tier — never fired ([#32](https://github.com/carllom/bint2/issues/32)'s
manual perf pass, `docs/manual-passes.md`).
The second has now fired: [#96](https://github.com/carllom/bint2/issues/96)'s
benchmark, run for map [#95](https://github.com/carllom/bint2/issues/95)'s
"Derived work" ticket ([#99](https://github.com/carllom/bint2/issues/99)),
found that a full multi-GB scan (search, or the entropy/histogram pass from
[#98](https://github.com/carllom/bint2/issues/98)) is 18–24s of continuous
main-thread work. `ByteSource.read()` resolves via microtask, so `await`ing
it in a loop never yields to rendering or input — the tab can run the entire
scan without painting a frame, independent of how cheap any one chunk is
(max 13.9ms, well under budget). This is exactly the shape ADR-0001's
Derived-work trigger anticipated: "a search is one long-running request
needing progress and cancellation, the opposite shape from the small,
uncancellable point reads frozen [for `ByteSource`]."

**Decision:** build the Worker now, as a wholly separate interface —
`DerivedWorkClient` (`src/core`, paired with `derived-work.worker.ts`) —
never bolted onto `ByteSource`. `ByteSource` itself stays frozen exactly as
ADR-0001 specified; #96 already confirmed random-access `read()`/`readSync()`
needs no new sequential-scan primitive.

`DerivedWorkClient` is constructed the same way as `FileByteSource` —
`new DerivedWorkClient(file)`, called alongside `new FileByteSource(file)`
wherever the document opens — but it holds its **own** `File` clone
(structured-cloned once into the worker) and does its **own** reads entirely
inside the worker's event loop: the whole scan, read and compute, runs
off-thread. It does not reuse the main thread's `PageCache`
([ADR-0002](./0002-page-cache-sized-against-the-viewport.md)) — that's sized
for random re-access against the viewport, and a one-pass forward scan gets
nothing from its LRU bookkeeping. Lifecycle mirrors `FileByteSource`: one
worker per open document, created at open, terminated on `close()` — the
same "terminates the worker if one exists" language ADR-0001 wrote for the
paging trigger, now actually exercised by this one instead.

One worker instance handles every job kind, dispatched on a `kind` field:
`'search'` and `'stats'` (entropy map + byte histogram together, per #98's
one-joint-compute-pass decision — no separate kinds for two renderings of one
scan). Jobs are mutually exclusive by the map's own supersession rule (a
new/different request always supersedes; a same-term Find Next/Previous
no-ops in flight, never queues), so separate worker instances per job type
would buy no concurrency, only redundant `File`-clone and boot cost.

Progress is a generic envelope, `{reqId, kind: 'progress', percent, extra?}`
— `percent` is offset÷size for any job, `extra` carries job-specific data
(search's running match count) — so one progress-bar-plus-Cancel UI drives
every job kind off `percent` alone. Cancellation is hard: the worker's
already-chunked read loop (chunked for the same time-budget reason #96 found
main-thread yielding needs) checks a cancelled-`reqId` set between chunks and
actually stops, then acks `{reqId, kind: 'cancelled'}` — retiring the
`reqId` so a result already in flight when cancelled can never land as if it
were live. A superseded multi-second scan actually stops instead of grinding
to completion for a result that's thrown away. Typed-array results (match
offsets, per-block entropy `Float32Array`, histogram `Uint32Array(256)`)
move via `postMessage`'s transfer list, not structured-clone. Text-mode
search sends only a codepage id; the worker statically imports
`src/core/codepages` directly and builds its own reverse table, since that
module is already framework-free and importable in a worker.

`DerivedWorkClient` gets its own error-code union, distinct from
`ByteSourceErrorCode` — reusing that type would imply the two are one frozen
contract, when the point of this ADR is that they're not. It includes its
own `source-gone` detection: its `File` clone can go stale independently of
`FileByteSource`'s, since they're separate handles on what happens to be the
same file. A `source-gone` failure fails only that job
(`{reqId, ok:false, code:'source-gone', message}`) — it does not drive
[ADR-0004](./0004-a-dead-source-is-a-banner-not-a-blank-screen.md)'s
app-level dead-source banner, which stays `FileByteSource`'s job; paging is
continuous and is virtually always first to notice a dead source anyway.

## Considered options

- **Chunked main-thread async, yielding on a time budget instead of a chunk
  count.** #96 confirmed this is *possible* — per-chunk cost is fine, and
  time-budgeted yielding avoids the 29x/50% overhead chunk-counted yielding
  costs. Rejected anyway: it only mitigates the non-yielding-loop problem and
  is easy to regress (the exact chunk-counted mistake #96 measured), where a
  Worker makes "no frame paints for 24s" structurally impossible rather than
  policy-dependent. This is also the trigger ADR-0001 named explicitly, not a
  workaround for it.
- **Worker does compute only; main thread's warm `PageCache` still does the
  reads and streams chunks over.** Rejected: the main thread would still run
  a tight `await`-in-a-loop reading bytes with no yield point between
  iterations — the same non-yielding-loop problem, just with the CPU work
  moved elsewhere. Moving only compute off-thread does not fix the actual
  failure mode #96 found.
- **Reuse `ByteSource`'s interface for derived-work requests, with an added
  `signal`/progress shape.** Rejected per ADR-0001's own text: a cancellable,
  progress-reporting, long-running request is "the opposite shape" from
  `ByteSource`'s frozen small uncancellable point reads, and bolting one onto
  the other breaks the existing contract immediately.

## Consequences

- A future reader should not add a `search`/`entropy` method to `ByteSource`
  or `FileByteSource` — that was considered and rejected here specifically
  because it collapses two deliberately different contracts back together.
- `DerivedWorkClient` duplicates a `File` handle and re-reads bytes
  `FileByteSource`'s `PageCache` may already hold resident. This is accepted:
  #96 found read cost isn't the bottleneck, and the alternative (crossing
  back to the main thread's cache mid-scan) would reintroduce the
  non-yielding-loop problem this ADR exists to avoid.
- No `CONTEXT.md` term: `DerivedWorkClient` and the worker protocol are
  implementation plumbing this ADR fully explains, not reader-facing
  vocabulary — same reasoning ADR-0012 used for the joint scan itself.
