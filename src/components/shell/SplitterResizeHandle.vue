<script setup lang="ts">
import { SplitterResizeHandle, useForwardPropsEmits } from 'reka-ui'
import type { SplitterResizeHandleProps } from 'reka-ui'

// Reka UI wrapper — the draggable divider (ADR-0009, plan §3.2, #77). Reka puts
// `data-state="inactive" | "hover" | "drag"` and `data-orientation` on the
// element, keeps it focusable, and wires the APG window-splitter keyboard model
// (arrows resize, Home/End = min/max, Enter = toggle collapse). All the visuals
// — the 1px rule, the widened hit area, the active/focus highlight — hang off
// those attributes here; the library ships no CSS.

const props = defineProps<SplitterResizeHandleProps>()

const emits = defineEmits<{
  /** Fires as dragging starts (`true`) and ends (`false`). */
  dragging: [isDragging: boolean]
}>()

const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <SplitterResizeHandle v-bind="forwarded" class="splitter-resize-handle">
    <slot />
  </SplitterResizeHandle>
</template>

<style scoped>
/* A 1px rule on the border token, with a ~9px pointer hit area straddling it
   (the ::before). `flex: none` so the group's flex layout never steals from it. */
.splitter-resize-handle {
  position: relative;
  flex: none;
  background: var(--color-border);
}

.splitter-resize-handle[data-orientation='horizontal'] {
  width: 1px;
  cursor: col-resize;
}

.splitter-resize-handle[data-orientation='vertical'] {
  height: 1px;
  cursor: row-resize;
}

.splitter-resize-handle::before {
  content: '';
  position: absolute;
  inset: 0;
}

.splitter-resize-handle[data-orientation='horizontal']::before {
  inset: 0 -4px;
}

.splitter-resize-handle[data-orientation='vertical']::before {
  inset: -4px 0;
}

/* Hover and drag both light the rule; keyboard focus matches drag. */
.splitter-resize-handle[data-state='hover'],
.splitter-resize-handle[data-state='drag'] {
  background: var(--color-cursor);
}

.splitter-resize-handle:focus-visible {
  outline: none;
  background: var(--color-cursor);
}
</style>
