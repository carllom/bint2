<script setup lang="ts">
import { computed } from 'vue'
import { isCollapsed, rangeOf, toBinary, toByteSizeDetail, toHex, toSignedByte } from '@/core'
import { useByteAt } from '@/composables/useByteAt'
import { useDocumentStore } from '@/stores/document'

// The packed, at-a-glance readout (plan §7, #23): where the Cursor is, what the
// byte under it is, how far the Selection reaches when it reaches at all, and
// which document is open. It is deliberately **not** a live region — speaking all
// of this on every Cursor move would be unusable; the spoken counterpart is a
// separate, shorter sentence handled with the viewport's live regions (ADR-0005).

const documentStore = useDocumentStore()

const hasSource = computed(() => documentStore.source !== null)

/** The moving end of the one Selection — the position the keyboard drives. */
const cursor = computed(() => documentStore.selection?.focus ?? null)

/**
 * The half-open byte range, shown **only** when the Selection actually spans
 * bytes. A collapsed Selection is just the Cursor and carries no extent.
 */
const range = computed(() => {
  const sel = documentStore.selection
  return sel !== null && !isCollapsed(sel) ? rangeOf(sel) : null
})

// The value of the single byte under the Cursor — a point read through the
// frozen ByteSource (ADR-0001), never the row path. Shared with the Viewport's
// cursor live region (#27) via `useByteAt`, which resolves it synchronously
// when resident and guards the async fallback against a Cursor or document
// that has since moved on.
const focusByte = useByteAt(
  computed(() => documentStore.source),
  cursor,
)

const cursorHex = computed(() => (cursor.value === null ? '' : toHex(cursor.value)))

/** The three interpretations of the byte under the Cursor, or placeholders. */
const byte = computed(() => {
  const value = focusByte.value
  if (value === null) {
    return { unsigned: '··', signed: '··', binary: '········' }
  }
  return { unsigned: String(value), signed: String(toSignedByte(value)), binary: toBinary(value) }
})

const selStartHex = computed(() => (range.value === null ? '' : toHex(range.value.start)))
const selEndHex = computed(() => (range.value === null ? '' : toHex(range.value.end)))
const selLength = computed(() => (range.value === null ? 0 : range.value.end - range.value.start))

// The exact byte count with a human-readable companion for the sizes the tool
// actually opens — both, so nothing about the size is ever only approximate.
const sizeText = computed(() => toByteSizeDetail(documentStore.fileSize))

// The action live region (#28, ADR-0005): the spoken counterpart to the visible
// copy status. It mirrors the store's one `copyStatus` — the same source the
// visible bar reads — so it announces a copy success or the over-cap refusal and
// nothing the bar does not already show. Transient: `copyStatus` is nulled the
// moment its Selection moves, and the region empties with it. It is its own
// element, never the visible bar (never spoken whole) and never the Viewport's
// cursor region (whose ~200 ms debounce would delay a refusal, and whose next
// Cursor move would stomp it).
const actionAnnouncement = computed(() => documentStore.copyStatus?.message ?? '')
</script>

<template>
  <div class="status-bar-area">
    <!-- Transient, role=status, its own element — see `actionAnnouncement` above
         and ADR-0005's "Two live regions, with disjoint jobs". Unconditional so
         it is already in the accessibility tree before the first copy. -->
    <div
      class="visually-hidden"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-field="action-live-region"
    >
      {{ actionAnnouncement }}
    </div>
    <div v-if="hasSource" class="status-bar">
      <span v-if="cursor !== null" class="status-bar__group" data-field="cursor-offset">
        <span class="status-bar__label">cur</span>
        <span>0x{{ cursorHex }}</span>
        <span class="status-bar__sep">·</span>
        <span>{{ cursor }}</span>
      </span>

      <span v-if="cursor !== null" class="status-bar__group">
        <span class="status-bar__label">u8</span>
        <span data-field="byte-unsigned">{{ byte.unsigned }}</span>
        <span class="status-bar__label">i8</span>
        <span data-field="byte-signed">{{ byte.signed }}</span>
        <span class="status-bar__label">bin</span>
        <span data-field="byte-binary">{{ byte.binary }}</span>
      </span>

      <span v-if="range !== null" class="status-bar__group">
        <span class="status-bar__label">sel</span>
        <span data-field="selection-start">0x{{ selStartHex }}</span>
        <span class="status-bar__sep">→</span>
        <span data-field="selection-end">0x{{ selEndHex }}</span>
        <span class="status-bar__sep">·</span>
        <span data-field="selection-length">{{ selLength }} B</span>
      </span>

      <span
        v-if="documentStore.copyStatus !== null"
        class="status-bar__group status-bar__copy"
        :class="{ 'status-bar__copy--refused': !documentStore.copyStatus.ok }"
        data-field="copy-status"
      >
        {{ documentStore.copyStatus.message }}
      </span>

      <span class="status-bar__group status-bar__doc">
        <span data-field="file-name">{{ documentStore.fileName }}</span>
        <span class="status-bar__sep">·</span>
        <span data-field="file-size">{{ sizeText }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5ch;
  align-items: baseline;
  padding: 0.25rem 0.5rem;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--color-fg);
}

.status-bar__group {
  display: inline-flex;
  gap: 0.75ch;
  align-items: baseline;
  flex: none;
}

/* Pushed to the trailing edge, but never clipped — the file name and size stay
   visible for as long as a document is open (#23). A too-narrow bar wraps. */
.status-bar__doc {
  margin-left: auto;
}

.status-bar__label,
.status-bar__sep {
  color: var(--color-fg-dim);
}

/* The last copy's outcome (#25). Plain text, not a live region — the spoken
   counterpart is the separate action region (#28, ADR-0005). */
.status-bar__copy {
  color: var(--color-fg-dim);
}

.status-bar__copy--refused {
  color: var(--color-cursor);
}

/* `.visually-hidden` (the action live region) is the shared global utility in
   assets/main.css — scoped styles can't reach it and it must not diverge. */
</style>
