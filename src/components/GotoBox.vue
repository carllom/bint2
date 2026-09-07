<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { parseOffset } from '@/core'
import type { ViewportMetrics } from '@/core'
import { useDocumentStore } from '@/stores/document'

// Exact navigation (#24, ADR-0006). `Ctrl+G` from anywhere opens the box; the
// reader types an offset in whichever base their other tool produced and both
// the Viewport and the Cursor land there. This is the fine path the two-level
// zoom scrollbar was ruled out for — without it there is no way to reach a
// specific offset at 700 MB scale.
//
// The box owns nothing about navigation: it parses the text, hands the number to
// the store's `gotoOffset` (which funnels through the one `clampTopOffset` choke
// point), and emits `close` so the Viewport takes focus back. `Esc` — or a click
// on the backdrop — closes it without moving. The backdrop also shields the grid
// behind it, so a stray click or wheel can neither move the Cursor nor steal
// focus out of the trap while the box is open.

const props = defineProps<{ metrics: ViewportMetrics }>()
const emit = defineEmits<{ close: [] }>()

const documentStore = useDocumentStore()

const open = ref(false)
const text = ref('')
const invalid = ref(false)
const inputEl = useTemplateRef<HTMLInputElement>('input')
const dialogEl = useTemplateRef<HTMLElement>('dialog')

// A newly opened document supersedes any Goto in progress — closed rather than
// left to fight the Viewport's own focus-on-open (#27, ADR-0005). Not routed
// through `cancel()`: that emits `close` to hand focus back, and the Viewport
// is already claiming it on this same source change.
watch(
  () => documentStore.source,
  () => {
    open.value = false
  },
)

/**
 * `Ctrl+G` / `Cmd+G` opens the box regardless of where focus sits. `Shift` and
 * `Alt` are excluded so `Ctrl+Shift+G` still reaches the browser's reverse-find.
 */
function onWindowKeydown(event: KeyboardEvent): void {
  if (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'g'
  ) {
    event.preventDefault()
    void reveal()
  }
}

async function reveal(): Promise<void> {
  if (open.value) {
    inputEl.value?.focus() // already open — just pull focus back to the field
    return
  }
  open.value = true
  text.value = ''
  invalid.value = false
  await nextTick()
  inputEl.value?.focus()
}

/**
 * The backstop to the Tab trap: if focus leaves the open box by any other route
 * (a programmatic `.focus()` elsewhere, browser chrome), pull it back to the
 * field. Skipped once the box is closing, so the deliberate hand-off to the
 * Viewport on confirm / `Esc` is not fought.
 */
function onFocusout(event: FocusEvent): void {
  if (!open.value) {
    return
  }
  const next = event.relatedTarget as Node | null
  if (next && dialogEl.value?.contains(next)) {
    return
  }
  inputEl.value?.focus()
}

/** Close without moving — `Esc` or the Cancel button. Focus returns to the Viewport. */
function cancel(): void {
  if (!open.value) {
    return
  }
  open.value = false
  emit('close')
}

/**
 * Parse the entry; jump and close on a valid offset, otherwise mark the field
 * invalid and stay open. An out-of-range value is *not* invalid — the store
 * clamps it to the document.
 */
function confirm(): void {
  const parsed = parseOffset(text.value)
  if (parsed === null) {
    invalid.value = true
    inputEl.value?.select()
    return
  }
  documentStore.gotoOffset(parsed, props.metrics)
  open.value = false
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  } else if (event.key === 'Tab') {
    trapTab(event)
  }
}

/** Keep Tab / Shift+Tab cycling inside the box while it is open (ADR-0005). */
function trapTab(event: KeyboardEvent): void {
  const focusable = dialogEl.value?.querySelectorAll<HTMLElement>('input, button:not([disabled])')
  if (!focusable || focusable.length === 0) {
    return
  }
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))
</script>

<template>
  <div v-if="open" class="goto-box__backdrop" @pointerdown="cancel">
    <div
      ref="dialog"
      class="goto-box"
      role="dialog"
      aria-modal="true"
      aria-label="Go to offset"
      @pointerdown.stop
      @keydown="onKeydown"
      @focusout="onFocusout"
    >
      <form class="goto-box__form" @submit.prevent="confirm">
        <label class="goto-box__label" for="goto-box-input">Go to offset</label>
        <input
          id="goto-box-input"
          ref="input"
          v-model="text"
          class="goto-box__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="0x1F40 or 8000"
          :aria-invalid="invalid || undefined"
          aria-describedby="goto-box-hint"
          @input="invalid = false"
        />
        <button type="submit" class="goto-box__go">Go</button>
        <button type="button" class="goto-box__cancel" @click="cancel">Cancel</button>
        <p id="goto-box-hint" class="goto-box__hint" :class="{ 'goto-box__hint--error': invalid }">
          {{
            invalid
              ? 'Enter a 0x-hex or decimal offset.'
              : 'Hex (0x…) or decimal — out of range clamps to the file.'
          }}
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* An invisible shield over the grid — no dim (this is a byte tool, the data
   stays readable), just a surface that swallows stray clicks and wheel and
   keeps the grid behind it from stealing focus out of the trap. */
.goto-box__backdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
}

.goto-box {
  position: absolute;
  top: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.5rem 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  font-family: var(--font-mono);
}

.goto-box__form {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 0.35rem 0.5rem;
  align-items: baseline;
}

.goto-box__label {
  color: var(--color-fg-dim);
}

.goto-box__input {
  min-width: 16ch;
  padding: 0.15rem 0.35rem;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font: inherit;
}

.goto-box__input[aria-invalid='true'] {
  border-color: var(--color-cursor);
}

.goto-box__go,
.goto-box__cancel {
  padding: 0.15rem 0.6rem;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font: inherit;
  cursor: pointer;
}

.goto-box__hint {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--color-fg-dim);
  font-size: 0.85em;
}

.goto-box__hint--error {
  color: var(--color-cursor);
}
</style>
