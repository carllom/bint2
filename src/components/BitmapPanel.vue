<script setup lang="ts">
import { computed } from 'vue'
import { useDocumentStore } from '@/stores/document'

// The Bitmap Panel (CONTEXT.md, plan-phase1.75.md §4) — P1.75-M4 (#80) ships
// the SHELL ONLY: the titled section is the accordion's job; this is its
// content — a focusable container (plan §3.6) and the muted "No Cursor yet"
// hint (plan §4.4, mirroring the Inspector's). No `<canvas>`, no `PageCache`
// read, no follow/lock Origin state machine — those are M5 (#65, #66, ADR-0008).
//
// The focusable container is where M5 will bind the Width / Stride / Lock /
// Origin keys (`code`-based, plan §4.5), armed only while focus is *within* it —
// never on the accordion trigger. It already takes focus on `pointerdown` and
// via Tab so that plumbing lands now, with the rest of the shell.
//
// Not here yet, both arriving with the canvas in M5: the content header (the
// Width / Stride / Zoom / invert controls and the read-only "Following cursor" /
// "Locked · 0x…" status, plan §4.4) and the inner horizontal-only scroll box
// for image-width overflow (plan §3.1) — there is nothing to head or to scroll
// until pixels exist.

const documentStore = useDocumentStore()

// The Bitmap needs an Origin, which in Follow mode tracks the Cursor byte
// offset (plan §4.4). Before the reader has pointed at any byte there is no
// Selection at all — that is the "No Cursor yet" state (plan §3.4).
const hasSelection = computed(() => documentStore.selection !== null)

function focusSelf(event: PointerEvent): void {
  ;(event.currentTarget as HTMLElement).focus()
}
</script>

<template>
  <div
    class="bitmap"
    role="group"
    aria-label="Bitmap"
    tabindex="0"
    data-region="bitmap"
    @pointerdown="focusSelf"
  >
    <p v-if="!hasSelection" class="bitmap__hint" data-field="bitmap-no-cursor">
      No Cursor yet — click a byte in the grid to point the bitmap.
    </p>
  </div>
</template>

<style scoped>
/* Natural content height — the whole Sidebar scrolls if the stack overflows,
   the section never gets a scrollbar of its own (plan §3.1). The visible focus
   ring is the cue that the Bitmap keys (M5) are armed. */
.bitmap {
  min-height: 2rem;
  font-family: var(--font-mono);
  color: var(--color-fg);
}

.bitmap:focus-visible {
  outline: 1px solid var(--color-cursor);
  outline-offset: -1px;
}

.bitmap__hint {
  color: var(--color-fg-dim);
}
</style>
