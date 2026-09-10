<script setup lang="ts">
import { AccordionItem, useForwardProps } from 'reka-ui'
import type { AccordionItemProps } from 'reka-ui'

// Reka UI wrapper — one Panel in the Sidebar stack (ADR-0009, plan §3.1, #77).
// Reka puts `data-state="open" | "closed"` and `data-disabled` on the rendered
// element; the visuals below hang off those. `unmount-on-hide` is forwarded so
// a closed Panel holds no content (plan §3.1); `value` is the item's identity
// within the accordion.

const props = defineProps<AccordionItemProps>()

const forwarded = useForwardProps(props)
</script>

<template>
  <AccordionItem v-bind="forwarded" class="accordion-item">
    <slot />
  </AccordionItem>
</template>

<style scoped>
/* A hairline between Panels, on the shared border token. The first item's rule
   is drawn by the accordion container's own top border in the shell, not here. */
.accordion-item {
  border-top: 1px solid var(--color-border);
}

.accordion-item:first-child {
  border-top: none;
}

.accordion-item[data-disabled] {
  color: var(--color-fg-dim);
}
</style>
