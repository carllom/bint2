<script lang="ts">
/** What {@link FindBox} exposes to HexViewer through a template ref. */
export interface FindBoxHandle {
  /** Open the box (`/` while the grid has focus), or refocus it if already open. */
  reveal(): Promise<void>
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { parseHexPattern, stepMatch } from '@/core'
import type { DerivedWorkJobHandle, SearchDirection, SearchProgress, SearchResult } from '@/core'
import { useDocumentStore } from '@/stores/document'

// Search (#103, ADR-0013, docs/plan-phase2.md §3): a transient modal Find box,
// GotoBox-styled, opening on `/` while the grid has focus (HexViewer's own
// onKeyDown, scoped to the row area, is what makes that true — this component
// never listens on `window`) and closing on `Esc`. Hex mode only for this
// ticket; the text-mode toggle and Selection scoping are later tickets
// (#97/#100's remaining scope) and touch nothing here.
//
// `SearchParams` (`DerivedWork.ts`) carries only a pattern — no "from offset",
// no direction — so a `'search'` job always answers with every match in the
// file at once. Enter/Shift+Enter dispatch that job only the first time for a
// given term; the offsets it returns are cached here and every following
// Next/Previous for the same term is a local, instant `stepMatch` lookup, no
// second job. A different term supersedes whatever job is running — including
// mid-scan — via `DerivedWorkClient.search`'s own supersession, so no explicit
// cancel is needed on this end for that case; a same-term Next/Previous while
// one is in flight is a no-op this component alone is responsible for, since
// the client's supersession does not know two calls share a term.

const emit = defineEmits<{ close: [] }>()

const documentStore = useDocumentStore()

const open = ref(false)
// Persists across close -> reopen for the session (plan §3.1, boundary
// matrix): never reset except by a document change, below.
const text = ref('')
const dialogEl = useTemplateRef<HTMLElement>('dialog')
const inputEl = useTemplateRef<HTMLInputElement>('input')

const pattern = computed(() => parseHexPattern(text.value))
const invalid = computed(() => text.value.trim() !== '' && pattern.value === null)
// `parseHexPattern` never returns a non-null empty array (an empty term is
// itself invalid, `null`), so `pattern.value !== null` alone already implies
// at least one byte.
const canFind = computed(() => pattern.value !== null)

interface MatchCache {
  readonly pattern: Uint8Array
  readonly matches: Float64Array
}
interface RunningJob {
  readonly handle: DerivedWorkJobHandle<SearchResult>
  readonly pattern: Uint8Array
}

// The last *completed* scan, cached against the exact pattern bytes it answers
// for — see the module doc above for why Next/Previous do not simply
// re-dispatch. Invalidated only by a document change (below); an in-flight job
// that later resolves for the same term replaces it.
const cache = ref<MatchCache | null>(null)
const pending = ref(false)
const progressPercent = ref(0)
let job: RunningJob | null = null

// Wrap / no-match — the shared status-line message (plan §3.3): the two are
// mutually exclusive because each dispatch of `applyMatch` sets this to
// exactly one outcome. `null` shows nothing.
const statusMessage = ref<string | null>(null)

const statusText = computed(() => {
  if (invalid.value) {
    return 'Enter a valid hex byte sequence — pairs of hex digits.'
  }
  if (pending.value) {
    return `Searching… ${Math.round(progressPercent.value * 100)}%`
  }
  return statusMessage.value ?? ''
})

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function currentOffset(): number {
  const sel = documentStore.selection
  return sel === null ? 0 : sel.focus
}

/** Move the Cursor to a match and reveal it, or report why there is none. */
function applyMatch(
  step: { offset: number; wrapped: boolean } | null,
  direction: SearchDirection,
): void {
  if (step === null) {
    statusMessage.value = 'No match found.'
    return
  }
  documentStore.setCursor(step.offset)
  documentStore.requestReveal(step.offset)
  statusMessage.value = step.wrapped
    ? direction === 'next'
      ? 'Wrapped to start of file.'
      : 'Wrapped to end of file.'
    : null
}

function runFrom(matches: Float64Array, direction: SearchDirection): void {
  applyMatch(stepMatch(matches, currentOffset(), direction), direction)
}

function cancelPending(): void {
  job?.handle.cancel()
  job = null
  pending.value = false
}

/**
 * Enter (`'next'`) / Shift+Enter (`'previous'`), from the keyboard or the
 * buttons. A no-op while the term is invalid/empty — "Find is disabled until
 * fixed" (plan §3.2) is enforced here and by the buttons' own `disabled`.
 */
function find(direction: SearchDirection): void {
  const p = pattern.value
  if (p === null) {
    return
  }

  // Cached result for this exact term: step through it locally, no dispatch.
  if (cache.value !== null && sameBytes(cache.value.pattern, p)) {
    runFrom(cache.value.matches, direction)
    return
  }

  // Same-term Next/Previous while a job for it is already in flight — a no-op
  // (ADR-0013 §2.7): it never queues, never cancels itself.
  if (pending.value && job !== null && sameBytes(job.pattern, p)) {
    return
  }

  const client = documentStore.derivedWorkClient
  if (client === null) {
    return // no document / no worker-crossing client — nothing to dispatch to
  }

  // A different term reaches here while another job is running: `search()`
  // below supersedes it on its own (DerivedWorkClient's own cancel-on-new-job
  // rule), so nothing extra is cancelled here.
  statusMessage.value = null
  pending.value = true
  progressPercent.value = 0
  const handle = client.search({ pattern: p }, (progress: SearchProgress) => {
    progressPercent.value = progress.percent
  })
  job = { handle, pattern: p }

  handle.result
    .then((result: SearchResult) => {
      if (job?.handle !== handle) {
        return // superseded/cancelled before this landed
      }
      cache.value = { pattern: p, matches: result.matches }
      pending.value = false
      job = null
      runFrom(result.matches, direction)
    })
    .catch(() => {
      if (job?.handle !== handle) {
        return
      }
      // Cancelled (explicitly, or superseded by a later dispatch already
      // handled above) or errored: nothing to walk. Leave the box quiet
      // rather than reporting a cancel as "no match".
      pending.value = false
      job = null
    })
}

function cancel(): void {
  cancelPending()
}

async function reveal(): Promise<void> {
  if (open.value) {
    inputEl.value?.focus()
    inputEl.value?.select()
    return
  }
  open.value = true
  statusMessage.value = null
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function close(): void {
  if (!open.value) {
    return
  }
  cancelPending()
  open.value = false
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    find(event.shiftKey ? 'previous' : 'next')
  } else if (event.key === 'Tab') {
    trapTab(event)
  }
}

/** Keep Tab / Shift+Tab cycling inside the box while it is open (ADR-0005, mirrors GotoBox). */
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

/** As GotoBox: pull focus back if it escapes the open box by any other route. */
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

// A new (or closed) document invalidates everything the previous one's scan
// produced — a match offset means nothing against different bytes — and its
// DerivedWorkClient is gone with it (the store already terminated the
// worker). The term itself resets too: it persists close -> reopen *within a
// document* (plan §3.1), not across an unrelated file the reader has since
// opened. Closed the same way a newly opened document supersedes GotoBox.
watch(
  () => documentStore.source,
  () => {
    cancelPending()
    cache.value = null
    statusMessage.value = null
    text.value = ''
    open.value = false
  },
)

// "Any change to term... while a job is running cancels it" (plan §3.4): a
// same-term Next/Previous while pending is a no-op (handled in `find`), but
// editing the term *itself* mid-scan — without pressing Enter/Shift+Enter
// again — must not let that stale in-flight job land and move the Cursor for
// a term the box no longer shows.
watch(text, () => {
  if (
    pending.value &&
    job !== null &&
    (pattern.value === null || !sameBytes(job.pattern, pattern.value))
  ) {
    cancelPending()
  }
})

defineExpose({ reveal } satisfies FindBoxHandle)
</script>

<template>
  <div v-if="open" class="find-box__backdrop" @pointerdown="close">
    <div
      ref="dialog"
      class="find-box"
      role="dialog"
      aria-modal="true"
      aria-label="Find"
      @pointerdown.stop
      @keydown="onKeydown"
      @focusout="onFocusout"
    >
      <div class="find-box__row">
        <label class="find-box__label" for="find-box-input">Find (hex)</label>
        <input
          id="find-box-input"
          ref="input"
          v-model="text"
          class="find-box__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="4D 5A"
          :aria-invalid="invalid || undefined"
          aria-describedby="find-box-status"
        />
        <button type="button" class="find-box__next" :disabled="!canFind" @click="find('next')">
          Next
        </button>
        <button
          type="button"
          class="find-box__previous"
          :disabled="!canFind"
          @click="find('previous')"
        >
          Previous
        </button>
        <button v-if="pending" type="button" class="find-box__cancel" @click="cancel">
          Cancel
        </button>
        <button type="button" class="find-box__close" @click="close">Close</button>
      </div>
      <p
        id="find-box-status"
        class="find-box__status"
        role="status"
        aria-live="polite"
        :class="{ 'find-box__status--error': invalid }"
      >
        <span v-if="pending" class="find-box__spinner" aria-hidden="true" />
        {{ statusText }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Shields the grid exactly like GotoBox's own backdrop. */
.find-box__backdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
}

.find-box {
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

.find-box__row {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.find-box__label {
  color: var(--color-fg-dim);
}

.find-box__input {
  min-width: 16ch;
  padding: 0.15rem 0.35rem;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font: inherit;
}

.find-box__input[aria-invalid='true'] {
  border-color: var(--color-cursor);
}

.find-box__next,
.find-box__previous,
.find-box__cancel,
.find-box__close {
  padding: 0.15rem 0.6rem;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font: inherit;
  cursor: pointer;
}

.find-box__next:disabled,
.find-box__previous:disabled {
  color: var(--color-fg-dim);
  cursor: default;
}

.find-box__status {
  margin: 0.35rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.5ch;
  color: var(--color-fg-dim);
  font-size: 0.85em;
  min-height: 1.2em;
}

.find-box__status--error {
  color: var(--color-cursor);
}

.find-box__spinner {
  width: 0.8em;
  height: 0.8em;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-fg-dim);
  animation: find-box-spin 0.6s linear infinite;
}

@keyframes find-box-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
