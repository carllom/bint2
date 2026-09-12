# Find All stops early with a labeled partial list, not a refusal

[ADR-0005](./0005-the-byte-grid-is-not-a-document.md) set this codebase's rule
for a capped operation: Copy refuses outright past its 8 MiB cap, and never
truncates, because a silently truncated copy could be mistaken for the whole
selection once it leaves the app. Find All (map [#95](https://github.com/carllom/bint2/issues/95),
ticket [#100](https://github.com/carllom/bint2/issues/100)) is capped too — at
**500 results** — and a reader familiar with Copy's precedent would expect the
same refusal here. It doesn't get one.

**Decision:** hitting the cap **stops the scan early and shows the first 500
hits, labeled as partial** ("first 500 shown — narrow your search"), rather
than refusing to show anything.

The two cases differ in what the cap is protecting against. Copy's output
leaves the app as an opaque blob of bytes; a truncated one, read back later,
carries no marker that it's incomplete, so refusing is the only honest option.
The Search results panel never leaves the app — the reader sees the "first
500 shown" label at the moment the results appear, in the same interactive
surface they'd use to narrow the search. A capped partial list is strictly
more useful than an outright refusal here, and no less honest, since nothing
about it can be mistaken for a complete result set after the fact.

## Consequences

A future reader adding another capped operation should check which shape it
is — an artifact that leaves the app opaquely (follow ADR-0005, refuse) or a
labeled, in-app result set (follow this ADR, stop early and label it) —
rather than assuming one precedent covers both.
