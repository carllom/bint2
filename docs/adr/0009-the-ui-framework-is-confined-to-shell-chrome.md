# The UI framework is confined to shell chrome

The shell migration (map [#63](https://github.com/carllom/bint2/issues/63),
[#68](https://github.com/carllom/bint2/issues/68)) needs a multi-open
**accordion** for the sidebar's sections and a **resizable split** between the
hex grid and that sidebar. Research
([#64](https://github.com/carllom/bint2/issues/64),
`docs/research/headless-ui-primitives.md`) compared the headless Vue 3 primitive
libraries. bint2 has a bespoke monospace aesthetic, a custom scrollbar, a
hand-written row renderer, and a framework-free `src/core`. The question this ADR
settles is which library, and how far into the codebase it is allowed to reach.

**Decision:** adopt **Reka UI** (`reka-ui`, pinned to an exact `2.10.4` in
`package.json`), used only for app-shell chrome.

- **Primitives in scope:** `AccordionRoot type="multiple"` (the sidebar's
  independently open/close sections) and `SplitterGroup` / `SplitterPanel` /
  `SplitterResizeHandle` (the hex-grid ↔ sidebar divider, an APG window-splitter
  with `min`/`max` and collapse). `CollapsibleRoot` is pre-blessed but ships
  nothing in phase 1.75 — it is available without a fresh decision if a
  non-accordion disclosure appears.
- **Wrapping:** each primitive lives behind a thin single-file component under
  `src/components/`. The wrapper owns 100% of the visual layer — `<style scoped>`
  on the existing `--color-*` / `--font-mono` tokens, visuals driven off Reka's
  `[data-state]` attributes, `as-child` to avoid extra elements, zero library
  CSS. Reka ships no stylesheet, no theme object, no class scheme.
- **The wrappers are the only seam.** An eslint `no-restricted-imports` rule
  bans `reka-ui` outside `src/components/**`, mirroring the existing
  `app/core-is-framework-free` rule.

The library is **not** allowed to be:

1. **Imported by `src/core/**`** — the framework-free rule stands (the eslint
   scope already excludes it; this makes the intent explicit).
2. **A general Panel / docking framework** — accordion, collapsible, resizable
   split, and nothing more. No arbitrary multi-panel layouts, drag-to-rearrange,
   or tear-off windows.
3. **A replacement for the bespoke rendering stack** — `PageCache`,
   `viewport.ts`, `DomHexRenderer`, `HexRowRenderer` and `VirtualScrollbar` are
   never ported to a Reka primitive.
4. **Extended silently** — no additional Reka component enters the codebase
   without a decision ticket like #67.
5. **An owner of persisted or themed state** — no library token/theme system,
   and the splitter's `auto-save-id` is not used. Sidebar width is persisted
   through the Pinia `preferences` store, like every other view setting, so
   there is one owner and one storage key.

**Bundle cost is accepted.** The two active primitives tree-shake to
low-single-digit KB gzip each; Reka's heavy transitive deps (`@floating-ui/*`,
`@tanstack/vue-virtual`, `@internationalized/*`) are lazy and off the
accordion / splitter code paths. No new CI size gate — a Reka bump that balloons
the shell chunk is the signal to revisit.

## Considered options

- **Bespoke everything** — a hand-written ~80-line splitter and a hand-rolled
  accordion. Rejected: we would own the long tail — pointer capture, touch, RTL,
  the ARIA window-splitter wiring, roving focus, window-resize reflow — for
  chrome that is not the product's value. Once a primitive library is in for the
  accordion, taking its splitter for free is strictly less work than either a
  bespoke divider or a second dependency.
- **Ark UI (`@ark-ui/vue`)** — the runner-up, same component coverage including
  an APG window-splitter. Rejected: heavier per component (each pulls its own
  `@zag-js/*` state machine; the splitter machine alone ≈13 KB gzip plus a
  one-time Zag core), a more React-first `asChild` / callback idiom, and a small
  Vue user base (~22K weekly npm downloads vs Reka's ~1.6M). It would only
  amortise if bint2 later adopted many complex primitives sharing one
  state-machine core.
- **Headless UI Vue (`@headlessui/vue`)** — rejected: no accordion, no splitter,
  no collapsible (only `Disclosure`); Vue stable frozen at 1.7.23 since
  September 2024, with the v2 rewrite shipped for React only.
- **PrimeVue unstyled / pass-through** — rejected: a styled library retrofitted
  with an unstyled mode; design-token and `pt` plumbing overhead; 852 open
  issues.
- **Reka's `auto-save-id` for splitter layout persistence** — rejected: it would
  hand the library ownership of persisted view state, on its own `localStorage`
  key with its own migration story, alongside the `preferences` store that owns
  everything else.

## Consequences

- The shell-migration ticket ([#68](https://github.com/carllom/bint2/issues/68))
  implements the wrapper components and the eslint rule, and routes the sidebar
  width through the `preferences` store.
- The full alternatives comparison, with primary-source citations, stays in
  `docs/research/headless-ui-primitives.md` (branch
  `research/headless-ui-primitives`) and is not restated here.
- Reka ships behavioural changes in minor releases, so the exact pin lives in
  `package.json`, not only the lockfile — every bump forces a deliberate
  changelog read.
- The `CONTEXT.md` **Panel** term is rewritten by #68 (sidebar + accordion), not
  by this decision. Reka UI is an implementation choice, not a domain concept,
  so it earns no glossary entry.
