<script setup lang="ts">
import { AccordionContent, useForwardProps } from 'reka-ui'
import type { AccordionContentProps } from 'reka-ui'

// Reka UI wrapper — a Panel's content region (ADR-0009, plan §3.1, #77). Reka
// puts `data-state="open" | "closed"` on the region and exposes its measured
// height as `--reka-accordion-content-height`; the enter height animation below
// is ours, hung off both. There is no exit animation: Reka's default
// `unmount-on-hide` removes a closed region from the DOM, so a
// `[data-state='closed']` rule would be dead — an exit transition would need
// the shell to opt into `unmount-on-hide=false` (a later concern).

const props = defineProps<AccordionContentProps>()

const forwarded = useForwardProps(props)
</script>

<template>
  <AccordionContent v-bind="forwarded" class="accordion-content">
    <div class="accordion-content__inner">
      <slot />
    </div>
  </AccordionContent>
</template>

<style scoped>
.accordion-content {
  overflow: hidden;
  color: var(--color-fg);
}

.accordion-content[data-state='open'] {
  animation: accordion-content-open 150ms ease-out;
}

@keyframes accordion-content-open {
  from {
    height: 0;
  }
  to {
    height: var(--reka-accordion-content-height);
  }
}

@media (prefers-reduced-motion: reduce) {
  .accordion-content {
    animation: none;
  }
}

.accordion-content__inner {
  padding: 0.5rem;
}
</style>
