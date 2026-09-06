# A dead source is a banner, not a blank screen

[ADR-0001](./0001-bytesource-boundary-and-deferred-worker.md) froze the error
vocabulary — `ByteSourceError` with a `code` of
`'read-failed' | 'source-closed' | 'source-gone'` — and made `source-gone` latch
`FileByteSource` into a terminal state.
[ADR-0002](./0002-page-cache-sized-against-the-viewport.md) added the latch's
motivation (no negative caching would otherwise retry a doomed `slice()` every
frame) and closed with the gap this ADR fills: *"What the UI does when a source
latches is not settled here."*

**Decision:** only **one** of the three codes is ever visible to the reader, and
its surface is a banner over a view that keeps whatever bytes it already had.

## One code is visible; two are silent

- **`read-failed`** — no chrome. ADR-0002's no-negative-caching rule already
  makes it self-healing: the entry is removed, so the next paint retries. Rows
  stay `··` and are deliberately **indistinguishable from pending** rows, because
  for one frame they are the same thing.
- **`source-closed`** — never user-visible. It happens because the reader opened
  a second file, and by the time it is delivered the new document has already
  replaced the view. Reporting it would be reporting the reader's own action back
  to them as a failure.
- **`source-gone`** — the terminal case, and the only one that gets a surface: a
  **persistent, non-dismissible banner above the viewport**, naming the file,
  stating that it is no longer readable and that the bytes still shown are the
  last ones read. No modal, no forced re-open, no disabled controls — opening a
  file is already the universal reset.

## Resident bytes survive the source

The latch is on `FileByteSource`. `PageCache` sits above it holding resident
pages and, per ADR-0002, never sees a `File` — so **a latched source does not
empty the cache**. Rows already resident keep painting, a selection wholly inside
resident pages still copies, and rows the reader scrolls to are `··` forever.
The terminal state is therefore almost entirely **emergent**: the only new code
is the banner.

Poisoning the cache on latch — dropping every resident page so the view goes
uniformly blank — was **rejected**. The honesty argument cuts both ways: this
tool exists to catch data that looks right and is silently wrong
([ADR-0003](./0003-selection-is-one-range-cursor-is-its-collapsed-form.md)'s
copy-cap reasoning), and stale bytes shown as live are exactly that sin. But the
non-dismissible banner *is* the marker that makes them not-stale-looking, and
blanking destroys the bytes the reader was mid-investigation on — the payload of
their work — to protect them from a misreading the banner has already prevented.

## Escalation closes the silent-hang hole

Not every failure that is not `NotFoundError` is transient. A disconnected
network drive or a permissions change rejects with `NotReadableError`, which is
`read-failed` and never latches — so under the rule above it would retry
silently forever, showing `··` rows and no explanation, which reads as a hang.

`HexViewer` therefore counts **consecutive** `read-failed` rejections and past a
small threshold shows the **same banner** with different text ("could not be
read" rather than "no longer available"). One success resets the count. The
threshold is a tuning constant, not a decision.

The error taxonomy is **not** widened to catch more `DOMException` names. The
three codes stay exactly as ADR-0001 froze them: the data layer reports what
happened, and the judgement about when repetition becomes a failure worth
showing belongs to the UI.

## Nothing branches on file size

[#2](https://github.com/carllom/bint2/issues/2)'s bands — ≤ 700 MB fully
responsive, 700 MB–2 GB degrades, > 2 GB must not crash — are a **performance
expectation for the README, not a behavioural spec**. There is no degraded mode,
no warning threshold, no refusal ceiling, and **no code path anywhere branches on
file size**: `blob.slice()` is O(1), pages are 64 KiB regardless, direct reads are
chunk-capped by ADR-0002, and
[#5](https://github.com/carllom/bint2/issues/5) put the `RangeError` risk only on
whole-slice reads this design never performs.

"Degrades" is corrected to name the thing that actually degrades: **thumb
granularity**, ~75 k rows/px at 700 MB and ~215 k at 2 GB
([#8](https://github.com/carllom/bint2/issues/8)), already mitigated by Goto.
"Must not crash" is a property proven by the `size = 2e9` synthetic test, not a
feature that gets built.

Memory pressure is likewise **not surfaced and not measured** in the UI. The
16 MiB ceiling is the answer; `performance.memory` is non-standard Chromium-only
and `measureUserAgentSpecificMemory()` needs the cross-origin isolation
ADR-0001's research already deferred, so any reading would be an honest-looking
number that means nothing on Firefox. ADR-0002's `stats` counters stay a
developer and test surface.

## Consequences

Both banner texts, the escalation counter, and the file-open policies are
**component-tested against a source that rejects on command**; the latch is
unit-tested against a rejecting `Blob` stub. There is deliberately **no e2e** for
any of it — moving a fixture out from under a live browser session tests
Playwright's plumbing more than it tests the app.

The banner and the drop zone's refusal message are **not unified**. They never
coexist — the drop zone is the no-document state, the banner is the
document-is-dead state — and a shared notification abstraction over two strings
in mutually exclusive states would be a generalisation against nothing.
