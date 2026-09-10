<script setup lang="ts">
import { SplitterGroup, useForwardPropsEmits } from 'reka-ui'
import type { SplitterGroupProps } from 'reka-ui'

// Reka UI wrapper — the hex-grid ‖ Sidebar split container (ADR-0009, plan §3.2,
// #77). Reka puts `data-orientation` on the rendered element; the layout below
// hangs off it.
//
// `auto-save-id` and `storage` are dropped from the prop surface on purpose:
// layout persistence is owned by the Pinia `preferences` store, one owner and
// one storage key (ADR-0009 §5). The library never gets its own localStorage.

const props = defineProps<Omit<SplitterGroupProps, 'autoSaveId' | 'storage'>>()

const emits = defineEmits<{
  /** The panel sizes after a resize, in the group's size unit; the caller persists the committed width. */
  layout: [sizes: number[]]
}>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <SplitterGroup v-bind="forwarded" class="splitter-group">
    <slot />
  </SplitterGroup>
</template>

<style scoped>
.splitter-group {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.splitter-group[data-orientation='vertical'] {
  flex-direction: column;
}
</style>
