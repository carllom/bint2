# bint2

A browser hex/char viewer for very large local files. It answers one question —
**what byte is at offset X?** — for files far too large to hold in a tab, and
lets you get the answer back out.

Open a file from your machine and it renders as an address / hex / char grid. The
file is never read into memory in full: the viewer serves a bounded window of
bytes on demand and holds only a small cache of fixed-size pages behind it, so a
2 GB file opens as fast as a 2 KB one. Nothing is uploaded — the file stays on
your machine and is read through the browser's local File API.

## Using it

- **Open** — drop a file on the window, or use the file button in the toolbar.
  Opening another file replaces the current one.
- **Move** — wheel or the custom scrollbar scroll the whole document;
  `↑` `↓` `←` `→` move the byte cursor, `PageUp` / `PageDown` jump a viewport,
  `Home` / `End` and `Ctrl+Home` / `Ctrl+End` go to row and document edges.
- **Goto** — `Ctrl+G` opens an offset box; type a decimal or `0x` hex offset to
  jump the cursor there.
- **Select** — click a byte to set the cursor; shift-click or shift-arrow to
  extend a range. There is one selection at a time and it does not survive
  closing the file.
- **Copy** — `Ctrl+C` copies the selected range as space-separated hex. Copying
  is **refused past 8 MiB** of selected bytes rather than truncated — a silently
  short result is the exact bug this tool exists to catch. The selection itself
  is uncapped.
- **Reshape** — the grid is a fixed 8, 16, 24, or 32 bytes per row (default 16).
  Changing the preset preserves the byte offset, not the row.

The status bar reads out where the cursor is and the byte under it — offset in
hex and decimal, the byte as u8/i8/binary, and the selection's start, end, and
length — plus the file name and total size. If the file moves or is truncated
out from under the open document, a banner says so; bytes already resident stay
readable, nothing else will be fetched.

## What it does not do

**Reading the byte grid as a document is an explicit non-goal.** A hex dump of
arbitrary binary has no honest spoken or linear-reading form, and the grid is
built from a recycled pool of DOM rows whose contents are rewritten as you
scroll. The grid is therefore hidden from assistive technology on purpose.

**Copy is the supported way to read a range.** Select the bytes and copy them as
hex into a tool that can render them meaningfully. Point interrogation — walk to
an offset, read the byte there — works with the keyboard and is announced; bulk
reading goes through copy.

## Accessibility

What is committed and in place, and how it was checked:

- **Keyboard operability** — every action (open, navigate, Goto, select, copy,
  reshape) is reachable and driveable from the keyboard with no pointer. The
  keydown handling for each is covered by the unit suite, and a keyboard-only
  end-to-end journey (open → Goto → arrows → shift-select → copy, never touching
  the pointer) runs in the Playwright suite.
- **Honest labelling** — the file button, the bytes-per-row presets, and the
  Goto box are ordinary labelled controls; the directory-refusal message is an
  alert; the dead-source banner announces in place without stealing focus. No
  ARIA claims a capability the grid does not actually have.
- **An announced cursor** — the viewport is a single focusable
  `role="application"` region labelled with the open file's name, and a polite
  live region speaks the cursor as one sentence when it settles
  (*"offset 0x1F40, byte 4D, 'M'"* collapsed; *"selection 0x1F40 to 0x1F4F,
  16 bytes"* extended). `Ctrl+G` announces its destination the same way. Wheel
  and scrollbar scrolling stay silent.
- **Zoom, OS font scaling, reduced motion, and contrast** are supported — row
  height is measured from a rendered glyph and re-measured on zoom.

A manual NVDA (Windows) and VoiceOver (macOS) pass is the remaining hardening
step and has not been run yet — its two journeys (open a file and hear its name
and size; walk the Cursor and hear the offset and byte) and a results template
are in [`docs/manual-passes.md`](./docs/manual-passes.md). This section states
what is verified today, not a finished audit.

**WCAG 1.4.10 (reflow) at 400% is not met for the grid.** Bytes per row is a
fixed set of presets, not a width-responsive layout, so at high browser zoom a
row outgrows the viewport and the viewport scrolls horizontally. Dropping to the
8-byte preset is the lever for reading the grid at high zoom. The chrome around
the grid reflows normally.

## Browser support

- **First-class** — current desktop Chrome, Edge, and Firefox.
- **Best-effort** — desktop Safari. It should work; the Playwright config
  carries a WebKit project, but CI runs Chromium only and a WebKit-only failure
  is not release-blocking.
- **Unsupported** — mobile browsers and touch input. The interaction model is
  keyboard, wheel, and a fine-grained scrollbar.
- There is no explicit minimum browser version; the floor is whatever the build
  target emits, and that assumes an evergreen browser.

## Performance

File-size bands are a **performance expectation, not a behavioural spec**.
Nothing branches on file size — there is **no degraded mode, no warning
threshold, and no refusal ceiling**. Every file opens the same way through the
same code; the page cache holds ≤ 16 MiB behind the viewport whatever the
document size, so a 2 GB file opens as fast as a 2 KB one.

- **≤ ~700 MB — fully responsive.** Scroll, keyboard navigation, Goto, selection
  and copy all keep up.
- **~700 MB to ~2 GB — usable, with scrollbar-thumb granularity the thing that
  degrades.** A thumb drag moves roughly 75,000 rows per pixel at 700 MB and
  215,000 at 2 GB, so the thumb becomes a coarse gross-position control. **Goto
  (`Ctrl+G`) is the exact path** and is unaffected by file size.
- **Any openable size — must not crash the tab.** The only ceiling is what the
  browser's File API will open.

The bands are checked by a manual pass on real large files, not by the automated
suite: the synthetic `size = 2e9` tests prove the coordinate math and that
nothing allocates the whole document, but they cannot measure frame times. See
[`docs/manual-passes.md`](./docs/manual-passes.md), which also records whether
that pass found main-thread work attributable to paging — the evidence that
would trigger building the deferred worker
([ADR-0001](./docs/adr/0001-bytesource-boundary-and-deferred-worker.md)).

## Development

```sh
npm install
npm run dev          # dev server

npm run build        # type-check + production build
npm run preview      # preview the production build

npm run test:unit    # Vitest
npm run test:e2e     # Playwright (run: npx playwright install first)

npm run lint         # ESLint (--fix)
npm run format       # Prettier
npm run type-check   # vue-tsc --build
```

**Stack** — Vite, Vue 3 + TypeScript, Pinia, Vue Router. Domain language lives in
[`CONTEXT.md`](./CONTEXT.md); design decisions are in [`docs/adr/`](./docs/adr/).

**CI/CD** — `ci.yml` gates every pull request on lint, type-check, unit, and
end-to-end (Chromium). `deploy.yml` builds and deploys to GitHub Pages on every
push to `main`, passing the repo name as Vite's `--base` so the site resolves at
`https://<owner>.github.io/<repo>/`.
