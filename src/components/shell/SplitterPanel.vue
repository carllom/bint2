<script lang="ts">
/** What {@link SplitterPanel} exposes to a parent through a template ref. */
export interface SplitterPanelHandle {
  /** Resize to `size`, in the panel's `size-unit`. */
  resize: (size: number) => void
}
</script>

<script setup lang="ts">
import { useTemplateRef } from 'vue'
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

// Reka's panel is uncontrolled (`default-size` + an imperative API, no size
// prop to bind). The shell needs one imperative call: the wrapper-added
// "double-click the handle → reset to the default width" (plan §3.2). Re-expose
// just `resize` so that seam stays at this wrapper and `reka-ui` is never
// reached for directly.
const inner = useTemplateRef<{ resize: (size: number) => void }>('inner')

defineExpose({
  /** Resize to `size`, in the panel's `size-unit`. */
  resize: (size: number): void => inner.value?.resize(size),
} satisfies SplitterPanelHandle)
</script>

<template>
  <SplitterPanel ref="inner" v-bind="forwarded" class="splitter-panel">
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
