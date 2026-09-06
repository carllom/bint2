# ByteSource boundary: frozen contract, evidence-gated worker

`docs/plan-phase1.md` §2/§11 planned a Web Worker at M6 that would own the `File`
and the page cache, with a promise-based `ByteSource` interface from day 1 so
M1–M5 wouldn't churn when it landed. Two research findings undercut the premise:
`blob.slice().arrayBuffer()` already performs its I/O off the main thread on every
target engine ([#5](https://github.com/carllom/bint2/issues/5)), and a 64 KiB
structured clone is sub-millisecond and dominated by fixed `postMessage` dispatch
cost that transfer does not remove
([#6](https://github.com/carllom/bint2/issues/6)). The worker would therefore move
only LRU bookkeeping and the formatting of ~120 visible rows off the main thread —
not a frame budget.

**Decision:** we freeze the `ByteSource` interface now and do **not** build the
worker in Phase 1. The interface is specified to be worker-compatible, so the
worker can land later without touching call sites, but it is built only against
evidence (see *Trigger* below).

## The frozen contract

```ts
interface ByteSource {
  readonly size: number
  read(offset: number, length: number): Promise<Uint8Array>
  readSync(offset: number, length: number): Uint8Array | null
  prefetch(offset: number, length: number): void
  close(): void
}
```

- **Ownership** — `read` and `readSync` return a freshly-allocated, caller-owned
  `Uint8Array`. They never hand back a view into a cache page. A borrowed view is
  unsafe in both directions (the cache may evict and refill the page under a
  retained view; a caller that mutates corrupts the cache), and a copy is exactly
  what a worker returns for free via structured clone — so main-thread and worker
  implementations share one ownership contract and M6 cannot silently change
  behaviour.
- **EOF** — a read crossing the end returns `min(length, size - offset)` bytes;
  `offset >= size` returns an empty array. Only negative/`NaN` arguments throw, as
  programmer error. The last row is legitimately partial and the render path must
  not need EOF arithmetic.
- **`readSync`** — returns non-null only on a full local cache hit. This contract
  is worker-agnostic: with no worker it reads the real cache directly; if a worker
  ever lands it reads a main-thread mirror LRU. `readSync` cannot cross
  `postMessage` without `SharedArrayBuffer` + `Atomics`, and `Atomics.wait` is
  illegal on the main thread ([#6](https://github.com/carllom/bint2/issues/6)).
- **No cancellation** — `read` takes no `AbortSignal`. Reads are 64 KiB and
  sub-millisecond, and the component-side generation counter (plan §4) already
  prevents the actual bug, stale paints. Adding an optional trailing `signal?`
  later is backward-compatible.
- **`prefetch`** — fire-and-forget, returns `void`, never throws; failures surface
  on the corresponding `read`. `void` avoids unhandled-rejection hazards from
  speculative reads. Prefetch *policy* (depth, direction-reversal) is settled
  separately in [#10](https://github.com/carllom/bint2/issues/10).
- **`close`** — idempotent. Rejects in-flight reads with `source-closed`;
  subsequent `read` rejects immediately and `readSync` returns null; terminates the
  worker if one exists. Opening a second file is the common case and must not leak
  a worker or deliver stale bytes into the new document.
- **Errors** — failures reject with a `ByteSourceError` carrying a `code` of
  `'read-failed' | 'source-closed' | 'source-gone'`. `source-gone` is the stale
  `File` case: a file moved or truncated mid-session makes `.arrayBuffer()` reject
  with a `NotFoundError` `DOMException`. Across a worker boundary the failure is
  posted as `{ reqId, ok: false, code, message }` and reconstructed on the main
  thread, because structured clone preserves an `Error`'s name/message/stack but
  **not** subclass identity — a `ByteSourceError` posted from a worker would arrive
  as a plain `Error` and `instanceof` would break.

## Scope of the freeze

Only the `ByteSource` interface is frozen. The worker **wire protocol** is
sketched above but deliberately left non-binding: it is internal to a component
that does not exist, and an unexercised protocol frozen now would be wrong in
precisely the details that matter.

`FileByteSource` must hold the raw `File` and close over nothing
non-cloneable, so the `File` can be posted to a worker later.

No stub `byte-source.worker.ts` or `WorkerByteSource` is created — dead code rots
and carries lint/coverage weight for no benefit. Plan §2 and the §8 file tree drop
both; M0 reconciles the text.

## Trigger

The worker gets built when either condition holds, independently:

1. **Paging** — the M8 manual perf pass shows main-thread long tasks attributable
   to paging at the ~700 MB tier.
2. **Derived work** — any feature needing sustained compute over bytes (search,
   entropy map, decoding) arrives. Such work gets its **own** worker-crossing
   interface, not `ByteSource`: a search is one long-running request needing
   progress and cancellation, which is the opposite shape from the small,
   uncancellable point reads frozen above. Bolting it onto `ByteSource` would break
   this contract immediately.

Neither is expected during Phase 1.

## Considered options

- **Worker at M6, as planned** — rejected: builds a component that the research
  says moves nothing measurable off the main thread.
- **Pull the worker earlier (~M2)** — rejected for the same reason, and it adds
  worker bundling and test-harness friction during the milestones where
  correctness is the hard part.
- **Drop the worker and the async interface** — never seriously on the table;
  `blob.arrayBuffer()` is async regardless, and the promise interface is what keeps
  the option open at zero cost.
