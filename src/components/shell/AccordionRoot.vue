<script setup lang="ts">
import { AccordionRoot, useForwardProps } from 'reka-ui'
import type { AccordionRootProps } from 'reka-ui'

// Reka UI wrapper — the Sidebar's multi-open accordion (ADR-0009, plan §2.1,
// #77). The wrappers in this directory are the only place `reka-ui` may be
// imported; everything else imports these, and the eslint
// `app/reka-ui-confined-to-shell-chrome` rule enforces the fence.
//
// The wrapper owns 100% of the visual layer: `<style scoped>` on the existing
// `--color-*` / `--font-mono` tokens, visuals hung off Reka's `[data-state]`
// attributes, `as-child` forwarded to avoid extra elements, zero library CSS
// (Reka ships none). `type` is pinned to `"multiple"` — the one blessed mode
// (ADR-0009); a different mode needs its own decision ticket. Reka's
// `update:modelValue` is normalised to a plain `string[]` (the open item values)
// for the caller's bridge to the persisted panel-open booleans.

const props = defineProps<Omit<AccordionRootProps, 'type'>>()

const emits = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const forwarded = useForwardProps(props)

function relayModelValue(value: string | string[] | undefined): void {
  emits('update:modelValue', Array.isArray(value) ? value : value == null ? [] : [value])
}
</script>

<template>
  <AccordionRoot
    v-bind="forwarded"
    type="multiple"
    class="accordion-root"
    @update:model-value="relayModelValue"
  >
    <slot />
  </AccordionRoot>
</template>

<style scoped>
.accordion-root {
  display: flex;
  flex-direction: column;
  font-family: var(--font-mono);
  color: var(--color-fg);
}
</style>
