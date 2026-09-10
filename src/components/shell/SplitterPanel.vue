<script setup lang="ts">
import { SplitterPanel, useForwardPropsEmits } from 'reka-ui'
import type { SplitterPanelProps } from 'reka-ui'

// Reka UI wrapper — one side of the split (ADR-0009, plan §3.2, #77). Reka puts
// `data-state="collapsed" | "expanded"` on the element when the panel is
// `collapsible`; the visuals below hang off it. Sizing props (`min-size`,
// `max-size`, `default-size`, `collapsible`, `collapsed-size`, `size-unit`) are
// forwarded untouched — the shell sets them and the committed size is persisted
// through the `preferences` store, not `auto-save-id` (ADR-0009 §5).

const props = defineProps<SplitterPanelProps>()

const emits = defineEmits<{
  /** Current size and the previous one, in the panel's size unit. */
  resize: [size: number, prevSize: number | undefined]
  /** The panel collapsed past its `min-size`. */
  collapse: []
  /** The panel expanded back from collapsed. */
  expand: []
}>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <SplitterPanel v-bind="forwarded" class="splitter-panel">
    <slot />
  </SplitterPanel>
</template>

<style scoped>
.splitter-panel {
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}
</style>
