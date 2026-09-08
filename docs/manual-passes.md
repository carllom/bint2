# M8 manual passes — performance and screen reader

Two checks that a person has to drive, plus a place to write down what they
found. They are deliberately outside the automated suite and outside CI.

The synthetic `size = 2e9` shell tests prove the coordinate math and the
no-whole-document-allocation property — that nothing on the read path scales
with file size. They **cannot** prove frame times, and `axe` **cannot** tell
you whether a screen reader actually speaks the Cursor. That is what these
passes are for.

Re-run both whenever the render path, the page cache, the scrollbar model, or
any of the accessibility markup changes materially. Record the date, the build
(`git rev-parse --short HEAD`), the browser and OS, and the machine class each
time — the numbers are only comparable against their context.

---

## Pass 1 — Performance on real large files

### What it has to show

- **≤ ~700 MB — fully responsive.** Sustained wheel scroll, a held arrow key,
  repeated `PageDown`, a full-track thumb drag, `Ctrl+End`, `Ctrl+G`, and a
  bytes-per-row change all keep up with no visible stutter and no growing lag.
- **~2 GB — no crash.** The tab opens the file, renders, navigates, and closes
  it again without an out-of-memory kill or an unrecoverable hang. Coarser
  thumb granularity is expected and is not a failure (see the README size
  bands); a crash, a blank grid that never recovers, or unbounded memory
  growth is.

### Setup

1. Build and serve the production bundle — not the dev server:

   ```sh
   npm run build
   npm run preview
   ```

2. Get two real files. Zeroed files are acceptable for the paging and
   coordinate paths (bytes are bytes), but a file with varied content also
   exercises the char column, so prefer a real large media file or archive
   where you have one.

   - Windows: `fsutil file createnew big-700mb.bin 734003200` and
     `fsutil file createnew big-2gb.bin 2147483648`.
   - macOS / Linux: `mkfile 700m big-700mb.bin` / `truncate -s 2G big-2gb.bin`,
     or `head -c 2147483648 /dev/urandom > big-2gb.bin` for varied content.

3. Open Chrome DevTools → **Performance**. Have the **Console** ready too.

### What to exercise, at each size

Open the file both ways — drop it on the window, and pick it with the toolbar
button — then, with a Performance recording running:

- Sustained wheel scroll, several seconds, both directions.
- A held `↓` and a held `→` for several seconds each.
- `PageDown` held / repeated.
- A thumb drag from the top of the track to the bottom and back.
- `Ctrl+End`, then `Ctrl+Home`.
- `Ctrl+G` to a mid-file offset, then to an offset near the end.
- Cycle bytes per row 16 → 32 → 8 → 16 while the grid is populated.
- Select a small range and `Ctrl+C`.

Watch for: long tasks (the red-cornered blocks, > 50 ms) on the main thread
during scroll and paging; frame times that climb the longer you scroll rather
than staying flat; memory in the **Memory** panel growing without bound as you
move around (it should plateau — the page cache is capped at ≤ 16 MiB
regardless of file size).

### The deferred-worker trigger (ADR-0001)

The worker described in
[`docs/adr/0001-bytesource-boundary-and-deferred-worker.md`](./adr/0001-bytesource-boundary-and-deferred-worker.md)
is built only against evidence. One of its two triggers is measured here:

> **Paging** — the M8 manual perf pass shows main-thread long tasks
> *attributable to paging* at the ~700 MB tier.

Make the attribution a measurement, not a judgement, with the page cache's
`stats` counters (`hits`, `misses`, `evictions`, `pagesResident`,
`pendingCount`, `bytesFetched` — a developer surface, never shown in the UI,
per ADR-0002). Read them off the open source: Vue DevTools → **Pinia** →
`document` → `source` exposes the live `FileByteSource`, whose `stats` getter
carries the counters.

Procedure:

1. Note `stats` immediately after the file opens and the first screen paints.
2. Do one sustained scroll run at ~700 MB with the Performance recording on.
3. Note `stats` again.
4. For each long task in the recording, line its timestamp up against the
   scroll. A long task that coincides with `misses` and `bytesFetched`
   climbing is **paging-attributable** — record it as trigger evidence. A long
   task while those counters are flat is something else (layout, style
   recalc, GC) and is not this trigger.

If any paging-attributable long task is found at ~700 MB, that is the recorded
evidence that would start the worker. If none is found, record that too — a
clean pass is the result that keeps the worker deferred.

### Results

> **Status: not yet run.** Fill in on the first pass.

| Field | Value |
| --- | --- |
| Date | 2026-09-08 |
| Build (`git rev-parse --short HEAD`) | 6b61f4b |
| Machine (CPU / RAM) | i7-1355U / 32 GB |
| Browser / OS | Edge 152 / Windows 11 |
| Files used (size, zeroed or real content) | `file1.iso` 573MB real content, `file2.vhd` 592MB real content, `file3.zip` 3.08GB real content |

**≤ 700 MB — fully responsive?**

- Wheel scroll: *yes*
- Held arrow / `PageDown`: *yes*
- Thumb drag: *yes*
- `Ctrl+End` / `Ctrl+Home`: *yes*
- `Ctrl+G`: *yes* 2ab73xx 2efcbxx
- Bytes-per-row change: *yes*
- Copy of a small range: *yes*
- Frame times flat over a long scroll (y/n), typical / worst ms: *yes, typically 16 / 33, scarce occurrences of 50ms*
- Memory plateaus (y/n): *yes, heap stays within 2.4-4.1MB*

**~2 GB — no crash?**

- Opened and rendered (y/n): *yes*
- Navigated without hang / OOM (y/n): *yes*
- Closed / replaced cleanly (y/n): *yes*
- Thumb granularity observed (rows per pixel, if estimated): *280000 rows per pixel based on the viewport height and total number of rows for `file3.zip`*

**Deferred-worker trigger:**

- `stats` before scroll: `{ "hits": 0, "misses": 26, "evictions": 0, "pagesResident": 2, "pendingCount": 0, "bytesFetched": 131072}`
- `stats` after scroll:
  - *thumb scroll file3.zip* `{ "hits": 0, "misses": 3120, "evictions": 103, "pagesResident": 256, "pendingCount": 0, "bytesFetched": 23527424 }`
  - *wheel/page scroll file3.zip* `{ "hits": 4350, "misses": 26, "evictions": 0, "pagesResident": 2, "pendingCount": 0, "bytesFetched": 131072 }`
- Paging-attributable long tasks at ~700 MB (list with timestamps, or "none"): *none*
- Verdict: worker stays deferred / evidence to build the worker recorded

**Other findings / follow-ups:**

---

## Pass 2 — Screen reader

### What it has to show

Two journeys, on each of NVDA (Windows) and VoiceOver (macOS):

- **A — Open a file and hear its name and size.**
- **B — Walk the Cursor and hear the offset and the byte at each step.**

The byte grid itself is hidden from assistive technology on purpose
([ADR-0005](./adr/0005-the-byte-grid-is-not-a-document.md)); it is **not** part
of either journey. What is under test is the announced Cursor and the honest
labelling around it, not a reading of the dump.

### Setup

- **Windows / NVDA** — install NVDA (free), current desktop Chrome, Edge, or
  Firefox. Run against `npm run preview`. A small real file (a few KB) is
  enough; the point is what is spoken, not scale.
- **macOS / VoiceOver** — built in, toggle with `Cmd+F5`. Current desktop
  Safari and Chrome. Learn the VoiceOver key (`Ctrl+Option`, written `VO`).

### Journey A — open, hear name and size

1. Load the app. Tab to the file button; confirm it is announced as a button
   with an intelligible name.
2. Open a file.
3. Move the reader through the toolbar and status bar. Confirm the **file
   name** and the **total size** are both reachable and spoken. The status bar
   is not a live region, so this is deliberate navigation, not an
   announcement — reading it on demand is the pass.

### Journey B — walk the Cursor, hear offset and byte

1. With a file open, move focus into the viewport (Tab until the
   `role="application"` region takes focus; confirm it is announced with the
   file's name).
2. Press `→` once. Within about a second the live region should speak one
   sentence naming the **offset** and the **byte** — for example
   *"offset 0x0001, byte 4D, 'M'"*. Wheel and scrollbar scrolling must stay
   silent; only Cursor moves speak.
3. Press `→` several more times, then `↓`, then `←`. Each settle speaks the
   new position. Rapid presses should collapse to one announcement when the
   Cursor settles, not queue one per keystroke.
4. Shift+`→` a few times to extend a range; confirm the sentence switches to
   the selection form (*"selection 0x0001 to 0x0004, 4 bytes"*).
5. `Ctrl+G`, enter an offset, confirm; the destination is announced the same
   way. Confirm focus returns to the viewport, and returns there on `Esc`
   too.

### Results

> **Status: not yet run.** Fill in on the first pass.

| Field | Value |
| --- | --- |
| Date | 2026-09-08 |
| Build (`git rev-parse --short HEAD`) | 6b61f4b |
| NVDA version / browser | 2026.2 / Edge 152 |
| macOS / VoiceOver / browser | N/A macOS is out of scope |

**NVDA — Journey A (open, name, size):** pass / fail + notes

pass. Works as expected.

**NVDA — Journey B (walk the Cursor):** pass / fail + notes

pass. Works more or less as expected. Falls back to announcing the filename and size after *goto offset*. Nuisance, not a real problem.

**VoiceOver — Journey A:** pass / fail + notes

N/A no macOS testing done

**VoiceOver — Journey B:** pass / fail + notes

N/A no macOS testing done

**Bugs found / follow-ups:**

---

## Feeding results back

- The README **Performance** and **Accessibility** sections state what is
  verified. When a pass is run, update those sections from "scheduled" /
  "not yet run" to what the pass actually showed, and link the filled-in
  results here.
- A paging-attributable long task at ~700 MB is recorded against ADR-0001's
  trigger and is the signal to open a ticket for the worker.
- A screen-reader bug that contradicts the README's accessibility claims is
  release-relevant; file it before amending the claim.
