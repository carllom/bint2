# The byte grid is not a document

Phase 1 renders up to ~94 M rows through a recycled pool of 33–160 DOM rows
([ADR-0002](./0002-page-cache-sized-against-the-viewport.md)'s sizing,
[#7](https://github.com/carllom/bint2/issues/7)'s renderer), whose content is
rewritten as the reader scrolls, and it paints selection itself under
`user-select: none`
([ADR-0003](./0003-selection-is-one-range-cursor-is-its-collapsed-form.md)).
Whatever those rows present to the accessibility tree, it is not the document —
and a hex dump of arbitrary binary has no honest spoken form in any case.

**Decision:** phase 1 commits to **keyboard operability, honest labelling, and an
announced cursor**. Reading the byte grid as a document is an **explicit,
documented non-goal**. The grid is `aria-hidden`; the cursor speaks.

## What that buys, and why it is not a dodge

The commitment is not silence. Combined with the announced cursor below, a
screen-reader user can walk to any offset and hear the byte there — which is
exactly the test [#11](https://github.com/carllom/bint2/issues/11) set for the
whole application (*can you answer "what byte is at offset X" and get the answer
out of the app?*). The grid is mute; **point interrogation works**. Copy carries
the rest: a selection copied as hex (M5, capped at 8 MiB of source bytes) can be
read in a tool that renders it meaningfully, and the README says so next to the
non-goal, because a gap is easier to accept when the thing that covers it is
named.

The rejected alternative was `role="grid"` with `aria-rowcount` / `aria-rowindex`
— technically expressible over recycled rows, and dishonest: it claims a
capability that does not survive contact with a real screen reader, which is
worse than claiming nothing. The other rejected alternative was declaring
accessibility a non-goal outright, which would discard keyboard operability the
cursor model already paid for.

## Markup

- Rows carry **`aria-hidden="true"`**. Shipping the recycled pool into the
  accessibility tree would emit ~160 rows of unreadable garbage that changes
  under the reader mid-scroll.
- The viewport is a single **`tabindex="0"`** element with
  **`role="application"`**, an `aria-label` naming the open file, and an
  `aria-describedby` usage note (arrows move the byte cursor, `Ctrl+G` jumps to
  an offset, `Tab` leaves the view).
- **Rows and bytes are never focusable.** Focus on a recycled node is focus on a
  node that will be reassigned to a different row mid-scroll; no ARIA repairs
  that. The roving cursor is the only cursor.
- **`role="application"` is deliberate and scoped to the viewport, never the
  page.** It is the attribute a future reader will try to delete. Without it a
  screen reader in browse mode intercepts the arrow keys and the cursor cannot be
  driven at all, which silently downgrades "keyboard-operable" to
  "keyboard-operable with the screen reader switched off."

## Two live regions, with disjoint jobs

Both are visually hidden and `polite`.

- **Cursor region.** Announces the selection, debounced to settle (~200 ms) so
  held-arrow key repeat speaks the destination rather than the journey. One
  sentence, chosen by whether the range is collapsed — ADR-0003 decided there is
  one concept here, so the announcement does not invent two: collapsed →
  *"offset 0x1F40, byte 4D, 'M'"*; extended → *"selection 0x1F40 to 0x1F4F, 16
  bytes"*. Keying it off the **cursor** rather than the view means wheel and
  scrollbar drags announce nothing, for free — [#11](https://github.com/carllom/bint2/issues/11)
  already made those view-only. `Ctrl+G` announces its destination through this
  region because Goto sets the cursor.
- **Action region.** Transient, `role="status"`, in the status-bar area: copy
  succeeded, or [#11](https://github.com/carllom/bint2/issues/11)'s refusal past
  the 8 MiB cap. Separate from the cursor region because sharing one would let
  the next cursor move stomp a refusal, and the debounce that makes cursor
  announcements bearable would delay it.

The **visual status bar is not itself a live region.**
[#11](https://github.com/carllom/bint2/issues/11) packed it with offset (hex and
dec), byte value (u8/i8/bin), selection start–end and length, file name and total
size; speaking all of that per cursor move is unusable. The spoken form is a
different, shorter sentence, which is why it gets its own element.

**Never announce what is not shown.** The rejects settled in
[ADR-0004](./0004-a-dead-source-is-a-banner-not-a-blank-screen.md) and
[#12](https://github.com/carllom/bint2/issues/12) keep their visible behaviour
exactly: the directory refusal is `role="alert"` because it is already visible
and must be noticed; cancel, non-file drop, and multiple-files-take-the-first
stay silent for everyone. An announcement for a deliberately silent case would
make the app *more* informative with a screen reader than without — a sign the
visual design is wrong, not that the accessibility layer is good.

## Focus, chrome, and the non-screen-reader axes

- **Transitions:** the drop zone's button holds focus on load; a successful open
  moves focus to the viewport and announces file name and size; Goto restores
  focus to the viewport on both confirm and `Esc`; ADR-0004's banner never steals
  focus — `role="alert"` announces it in place, and it is non-dismissible, so
  there is nothing to focus.
- **The chrome is ordinary UI and gets ordinary treatment, unconditionally** —
  labelled toolbar presets, a focus-trapped Goto with `Esc` and focus restore, a
  real `<button>` beside the hidden `<input type=file>`. This is where the
  realistic accessibility budget goes, and it is the half that actually works.
  Splitting the commitment this way is what makes the grid non-goal honest rather
  than a blanket excuse.
- **Browser zoom, OS font scaling, `prefers-reduced-motion`, and contrast are all
  committed.** Row height is measured from a rendered probe glyph and
  re-measured on resize or zoom, feeding
  [#8](https://github.com/carllom/bint2/issues/8)'s `ViewportMetrics` — which
  already takes row height as an **input**, so the frozen `viewport.ts` surface
  is untouched. No in-app font-size control; browser zoom covers it.

**Consequence — reflow is not met, and that is consistent.** `bytesPerRow` stays
fixed presets (§11), so at high zoom the row outgrows the viewport and the
viewport **scrolls horizontally**; the presets are the reader's lever (drop to 8).
WCAG 1.4.10 reflow at 400% is therefore not met for the grid, which is the same
non-goal stated in different words, and the README says so rather than
implying otherwise.

## Milestones and verification

Accessibility comes **out of M7 entirely** — reversing
[#11](https://github.com/carllom/bint2/issues/11)'s "M7 = accessibility" — and
M7 keeps only hover highlight and raw-text copy. Everything above is structural:
attributes on components being written anyway, a focus model, and a live region
are all cheaper built once than retrofitted, so they land at **M5** with the
public ship. In particular **`role="application"` and the cursor region are a
pair and ship in the same milestone** — the role without the announcement takes
browse mode away and gives nothing back, which is strictly worse than shipping
neither.

**M8** adds the tests and the detail: a keyboard-only e2e journey (open →
`Ctrl+G` → arrows → shift-select → copy, never touching the pointer), which is
the test that actually protects the commitment since axe cannot see whether
arrows move the cursor; plus an axe-core smoke pass over the **chrome only**,
with the viewport excluded by selector and the exclusion documented — otherwise
it flags `role="application"` and the `aria-hidden` grid forever and gets muted
wholesale, which is how these suites die. M8 also carries one **manual pass**
against NVDA (Windows) and VoiceOver (macOS), scoped to two journeys: open a file
and hear its name and size, and walk the cursor and hear offset and byte.

The commitment paragraph itself lands in the README at **M5**, not M8 with the
rest of it: M5 is a public ship, and an undocumented non-goal is
indistinguishable from an oversight. The README states **what was verified and
with what** — "verified with NVDA and VoiceOver" is a fact; "accessible" is a
marketing claim.

## Amendment — VoiceOver out of scope (2026-09-08)

The M8 manual pass shipped as **NVDA (Windows) only**. No Apple hardware is
available to the project, so the VoiceOver leg was not run, and Safari / WebKit
is best-effort and untested for the same reason (README "Browser support"). The
"verified with what" principle above is unchanged — the README claims NVDA and
nothing more. If an Apple device becomes available, the VoiceOver leg is
restored from git history (`docs/manual-passes.md` Pass 2).
