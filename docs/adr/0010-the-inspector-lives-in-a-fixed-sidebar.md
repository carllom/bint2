# The Inspector lives in a fixed sidebar, not a dockable panel

Phase 1.5 shipped the **Inspector** as a Panel with a
`dock: 'bottom' | 'right'` preference and a collapse-to-bar. Phase 1.75
(map [#63](https://github.com/carllom/bint2/issues/63),
[#68](https://github.com/carllom/bint2/issues/68)) adds the **Bitmap** — a
second tool that has to live beside the Inspector. The question this ADR settles
is the layout shape those two tools share, and what becomes of `dock`.

**Decision:** one resizable right-hand **Sidebar** holding a fixed vertical
stack of independently collapsible **Panels** — the Inspector, then the Bitmap —
rendered as a Reka `AccordionRoot type="multiple"`. The `dock` preference is
**deleted**: there is no bottom placement and no per-Panel dock choice.

- **Grid ↔ sidebar split** is a Reka window-splitter (`size-unit="px"`, sidebar
  `min-size` 200, `max-size` dynamic = container width − the grid's own minimum
  computed from `bytesPerRow`, `collapsible` with `collapsed-size` 0). The width
  is persisted through the Pinia `preferences` store as `sidebarWidth`, **not**
  Reka's `auto-save-id` (ADR-0009). Double-click the handle resets to the
  default; the APG keyboard model (arrows resize, Home/End min/max, Enter toggle
  collapse) is kept.
- **Each Panel opens and closes on its own**, its state persisted
  (`inspectorOpen` default true, `bitmapOpen` default false). Items are
  `unmount-on-hide`: a closed Inspector runs no decode, a closed Bitmap holds no
  `PageCache` read.
- **The whole Sidebar collapses** to nothing via the splitter handle
  (`sidebarCollapsed`, persisted); the handle itself is the restore affordance,
  and expanding returns to the last width. This replaces the phase-1.5
  Inspector-only collapse-to-bar.
- **The Sidebar is hidden entirely when no document is open.**
- Section state and width are orthogonal — closing both Panels does not shrink
  the Sidebar; the splitter does.

## Considered options

- **Keep `dock` and add the Bitmap as a third dockable panel.** Rejected: two
  tools each with an independent bottom/right choice is the "general Panel /
  docking framework" that [ADR-0009](0009-the-ui-framework-is-confined-to-shell-chrome.md)
  rules out — combinatorial layout states, and the bottom strip cannot hold the
  Bitmap's vertical extent or its horizontal overflow scroll.
- **A single fixed placement (bottom-only or right-only) with no accordion.**
  Rejected: the Bitmap wants vertical height and a horizontal scroll box, which a
  bottom strip fights; a plain right column with no per-tool collapse forces both
  tools to share the height whether or not both are in use.
- **Tabs — one Panel visible at a time.** Rejected: the Inspector and the Bitmap
  are used *together* — byte-step the Cursor in the hex grid and watch both the
  decode and the pixels move (ADR-0008). Multi-open is the point.
- **Reka `auto-save-id` for width persistence.** Rejected for the same reason as
  in ADR-0009: it hands the library its own `localStorage` key and migration
  story alongside the `preferences` store that owns every other view setting.

## Consequences

- The `preferences` store loses `dock`, the `Dock` type, `isDock` and `setDock`;
  renames `collapsed` to `sidebarCollapsed`; and gains `sidebarWidth: number`
  (px, default 320, validated finite-or-default and clamped at use),
  `inspectorOpen: boolean` and `bitmapOpen: boolean`. A stored `collapsed` or
  `dock` key from phase 1.5 is ignored on load and dropped on the next write —
  no version stamp, no migration (the store's existing per-field validation
  already covers this).
- The Inspector's bottom-strip layout, its wrap-one-group-at-a-time behaviour,
  the dock toggle, the `resize: horizontal` right column and the thin-bar
  collapse are all removed. What survives: the row groups, the per-row copy
  buttons, and the `hex` toggle (moved to a control strip at the top of the
  Panel's content).
- `docs/plan-phase1.5.md` §2 / §3.1 and issue
  [#54](https://github.com/carllom/bint2/issues/54) get a "superseded by phase
  1.75" note — [#69](https://github.com/carllom/bint2/issues/69).
- `CONTEXT.md` gains a **Sidebar** term and redefines **Panel** (this ticket,
  [#68](https://github.com/carllom/bint2/issues/68)).
- ADR-0009 governs *which* library and *how far into the codebase* it reaches;
  this ADR governs the *layout shape* it renders. The Bitmap's own navigation
  model is [ADR-0008](0008-bitmap-origin-follows-or-locks-to-the-cursor.md), whose
  "the section is focused" plumbing this layout provides: a `tabindex="0"`
  container in the Bitmap Panel's content, the Width / Stride / Lock / Origin
  keys armed while focus is within it.
