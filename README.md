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
- **Byte order** — a toolbar `LE` / `BE` segment, or press `b` with the grid
  focused, sets one view-wide little- or big-endian order (default little).
  Every multi-byte number the Inspector decodes obeys it; the char column, the
  offset column, and the raw-byte copies never do.
- **Sidebar** — a resizable panel down the right edge, shown once a file is
  open. Drag the splitter handle to resize it (persisted), or double-click the
  handle to reset it to the default width; drag it all the way shut to collapse
  the Sidebar to nothing, and back out (or `Enter` on the handle) to restore it.
  It holds two independently collapsible sections — the **Inspector**, then the
  **Bitmap** — each opened or closed from its own header, also persisted.
- **Inspect** — the Sidebar's Inspector section decodes the bytes at the cursor
  into every primitive numeric type at once — `u8 i8 bin` / `u16 i16` /
  `u32 i32` / `u64 i64` / `f32 f64`. Integers are decimal with a section-wide
  `hex` toggle. Click a value to copy it. It is read on demand, never spoken.
- **Bitmap** — the Sidebar's other section renders a run of the document's
  bytes as a 1-bit-per-pixel image: each byte is eight horizontal pixels,
  most-significant bit leftmost, a set bit painting the foreground in the
  current theme's colours. Its **Origin** — the byte the top-left pixel maps
  to — **follows** the Cursor byte-for-byte by default, sliding the image as
  the Cursor moves. Press `L` (or the section's toggle button) to **lock** it
  at the current offset: the Cursor then moves independently while the image
  holds still, and a marker appears in the hex grid's left gutter showing where
  the locked run sits — a chevron at the edge if it has scrolled out of view;
  click the chevron to jump the grid there. `L` again resumes following. With
  the section focused, `,` / `.` change how many bytes wide each row is, and
  `Shift+,` / `Shift+.` change the gap added between rows (for viewing one
  column of a wider repeating structure in isolation); while locked, the arrow
  keys, `PageUp` / `PageDown`, and `Home` / `End` nudge the locked Origin
  instead of the Cursor. Clicking a pixel moves the Cursor there (Shift-click
  extends the Selection), in either mode.
- **Code page** — a toolbar selector swaps the char column's glyph table:
  `ASCII` (default), `CP437`, `Windows-1252`, two `PETSCII` sets, and `AKAI`.
  One glyph per byte, view-wide; it changes only the visible char column and
  decodes nothing.

The status bar reads out where the cursor is — offset in hex and decimal, and
the selection's start, end, and length — plus the file name and total size. If
the file moves or is truncated out from under the open document, a banner says
so; bytes already resident stay readable, nothing else will be fetched.

## What it does not do

**Reading the byte grid as a document is an explicit non-goal.** A hex dump of
arbitrary binary has no honest spoken or linear-reading form, and the grid is
built from a recycled pool of DOM rows whose contents are rewritten as you
scroll. The grid is therefore hidden from assistive technology on purpose.

**Copy is the supported way to read a range.** Select the bytes and copy them as
hex into a tool that can render them meaningfully. Point interrogation — walk to
an offset, read the byte there — works with the keyboard and is announced; bulk
reading goes through copy.

**The char column is single-byte only.** A code page is a 256-entry
`byte → glyph` table — one glyph per byte, no multi-byte decoding. UTF-8
sequences, UTF-16, and the legacy CJK encodings are not rendered in the grid;
raw-text copy still decodes the selection as UTF-8 regardless of the code page.

**The Inspector shows primitive numerics only.** No timestamps, GUIDs, colours,
or disassembly, and no text line — the char column owns glyph rendering.

**The Bitmap is read-only, 1-bpp monochrome only, and has no export.** It never
writes bytes back, decodes no colour or multi-bit pixel formats, and there is no
way to save the rendered image. Selecting pixels is click and Shift-click only —
no click-and-drag range select — and there is no typed Origin field; follow,
lock, and Goto together cover targeting it.

## Accessibility

What is committed and in place, and how it was checked:

- **Keyboard operability** — every action (open, navigate, Goto, select, copy,
  reshape, byte order) is reachable and driveable from the keyboard with no
  pointer. The keydown handling for each is covered by the unit suite, and two
  keyboard-driven end-to-end journeys run in the Playwright suite: the phase-1
  copy path (open → Goto → arrows → shift-select → copy) and the phase-1.5
  decode path (move the Cursor → read an Inspector row → press `b` → switch the
  code page).
- **Honest labelling** — the file button, the bytes-per-row presets, the
  byte-order segment, the code-page selector, the Goto box, and the Inspector's
  header and value controls are all ordinary labelled controls; the
  directory-refusal message is an alert; the dead-source banner announces in
  place without stealing focus. No ARIA claims a capability the grid does not
  actually have.
- **An announced cursor** — the viewport is a single focusable
  `role="application"` region labelled with the open file's name, and a polite
  live region speaks the cursor as one sentence when it settles
  (*"offset 0x1F40, byte 4D, 'M'"* collapsed; *"selection 0x1F40 to 0x1F4F,
  16 bytes"* extended). `Ctrl+G` announces its destination the same way, and a
  byte-order flip announces *"Byte order: big-endian"* through the same action
  region a copy uses. The Inspector updates silently — it is read on demand, not
  spoken. Wheel and scrollbar scrolling stay silent.
- **Zoom, OS font scaling, reduced motion, and contrast** are supported — row
  height is measured from a rendered glyph and re-measured on zoom.

A manual **NVDA (Windows)** pass was run on 2026-09-08 (build `6b61f4b`): both
journeys — open a file and hear its name and size, walk the Cursor and hear the
offset and byte — pass. The **VoiceOver (macOS)** leg is out of scope; no Apple
hardware is available to the project. Full results are in
[`docs/manual-passes.md`](./docs/manual-passes.md).

**WCAG 1.4.10 (reflow) at 400% is not met for the grid.** Bytes per row is a
fixed set of presets, not a width-responsive layout, so at high browser zoom a
row outgrows the viewport and the viewport scrolls horizontally. Dropping to the
8-byte preset is the lever for reading the grid at high zoom. The chrome around
the grid reflows normally.

## Browser support

- **First-class** — current desktop Chrome, Edge, and Firefox.
- **Best-effort, untested** — desktop Safari. It should work and the Playwright
  config carries a WebKit project, but CI runs Chromium only, no Apple hardware
  is available to test real Safari, and a WebKit-only failure is not
  release-blocking.
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
nothing allocates the whole document, but they cannot measure frame times. That
pass was run on 2026-09-08 (build `6b61f4b`) against real files up to ~3 GB:
frame times stayed flat (~16 ms typical), the heap plateaued, and **no
main-thread work attributable to paging** was found — so the deferred worker
stays deferred
([ADR-0001](./docs/adr/0001-bytesource-boundary-and-deferred-worker.md)). Full
results are in [`docs/manual-passes.md`](./docs/manual-passes.md).

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
