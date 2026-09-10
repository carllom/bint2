<script setup lang="ts">
import { AccordionHeader, AccordionTrigger, useForwardProps } from 'reka-ui'
import type { AccordionTriggerProps } from 'reka-ui'

// Reka UI wrapper — a Panel's titled toggle (ADR-0009, plan §3.1 / §3.5, #77).
// APG requires the trigger to sit inside a heading, so `AccordionHeader` is
// folded in here (default level `h3`) rather than left for every call site to
// remember. The trigger stays a pure toggle whose label is the slot — the
// disclosure chevron is a CSS `::before`, not a DOM node, so `as-child` still
// collapses cleanly onto a caller's own element.
//
// Reka drives `data-state="open" | "closed"` and `data-disabled` on the button;
// every visual below hangs off those.

const props = defineProps<AccordionTriggerProps>()

const forwarded = useForwardProps(props)
</script>

<template>
  <AccordionHeader class="accordion-trigger__header">
    <AccordionTrigger v-bind="forwarded" class="accordion-trigger">
      <slot />
    </AccordionTrigger>
  </AccordionHeader>
</template>

<style scoped>
.accordion-trigger__header {
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}

.accordion-trigger {
  display: flex;
  align-items: center;
  gap: 0.5ch;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: none;
  background: none;
  color: var(--color-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.accordion-trigger:hover:not([data-disabled]) {
  background: var(--color-hover);
}

.accordion-trigger:focus-visible {
  outline: 1px solid var(--color-cursor);
  outline-offset: -1px;
}

.accordion-trigger[data-disabled] {
  color: var(--color-fg-dim);
  cursor: default;
}

/* The `[data-state]`-driven visual: a disclosure chevron that points right when
   closed and rotates down when open. A pseudo-element so no DOM node is added. */
.accordion-trigger::before {
  content: '▸' / '';
  flex: none;
  color: var(--color-fg-dim);
  transition: transform 120ms ease-out;
}

.accordion-trigger[data-state='open']::before {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .accordion-trigger::before {
    transition: none;
  }
}
</style>
