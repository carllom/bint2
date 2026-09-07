<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { thumbGeometry } from '@/core'
import type { ViewportMetrics } from '@/core'

/**
 * The custom row-space scrollbar (ADR-0006) — the **only** scrollbar at every
 * file size. Its thumb is sized and placed by {@link thumbGeometry} over
 * `topByteOffset`; there is no native scrollbar and no full-height spacer, so
 * nothing here depends on a browser layout height and it works identically at
 * 10 MB and at 2 GB.
 *
 * Drag is gross-only and that is accepted: at 2 GB one pixel of travel spans
 * ~215 k rows. The thumb never shrinks below `minThumbPx`, so it stays
 * grabbable. Fine movement is the wheel, the keyboard and Goto.
 *
 * The component owns no offset math: on drag it emits the new thumb-top pixel
 * and the parent maps it back through `offsetFromThumbPixel` and the
 * `clampTopOffset` choke point.
 */
const props = defineProps<{
  metrics: ViewportMetrics
  topByteOffset: number
}>()

const emit = defineEmits<{
  /** New thumb-top position in track pixels; the parent resolves it to an offset. */
  scrollToPixel: [thumbTopPx: number]
}>()

const geometry = computed(() => thumbGeometry(props.topByteOffset, props.metrics))

// Track pixels between the pointer and the top of the thumb, fixed at grab so
// the thumb tracks the pointer without jumping; and the track's page-top offset,
// captured once per drag.
let grabDy = 0
let trackTop = 0

function onPointerMove(event: PointerEvent): void {
  emit('scrollToPixel', event.clientY - trackTop - grabDy)
}

function endDrag(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
}

function onPointerDown(event: PointerEvent): void {
  event.preventDefault()
  const track = event.currentTarget as HTMLElement
  trackTop = track.getBoundingClientRect().top

  const { thumbY, thumbH } = geometry.value
  const pointerY = event.clientY - trackTop
  const onThumb = pointerY >= thumbY && pointerY <= thumbY + thumbH
  // On the thumb: preserve where it was grabbed. On the bare track: centre the
  // thumb under the pointer and jump there.
  grabDy = onThumb ? pointerY - thumbY : thumbH / 2

  track.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)

  emit('scrollToPixel', event.clientY - trackTop - grabDy)
}

onBeforeUnmount(endDrag) // never leave window drag listeners behind
</script>

<template>
  <!-- A pointer affordance only. Screen-reader navigation is the keyboard and
       Goto (ADR-0006), and thumb drag announces nothing (ADR-0005); the ARIA
       treatment of the Viewport and its controls lands with #27 / #28. -->
  <div class="virtual-scrollbar" @pointerdown="onPointerDown">
    <div
      class="virtual-scrollbar__thumb"
      :style="{ height: `${geometry.thumbH}px`, transform: `translateY(${geometry.thumbY}px)` }"
    />
  </div>
</template>

<style scoped>
.virtual-scrollbar {
  flex: none;
  width: 14px;
  height: 100%;
  background: var(--color-bg);
  border-left: 1px solid var(--color-border);
  touch-action: none;
  cursor: default;
}

.virtual-scrollbar__thumb {
  width: 8px;
  margin: 0 3px;
  border-radius: 4px;
  background: var(--color-border);
  /* Repositioned, not animated — `prefers-reduced-motion` needs nothing here. */
}

.virtual-scrollbar__thumb:hover,
.virtual-scrollbar:active .virtual-scrollbar__thumb {
  background: var(--color-fg-dim);
}
</style>
