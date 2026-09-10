<script setup lang="ts">
import { computed } from 'vue'
import { decodeInspectorRow, INSPECTOR_READ_LENGTH, INSPECTOR_ROWS } from '@/core'
import { useBytesAt } from '@/composables/useBytesAt'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'

// The Inspector (CONTEXT.md, #54, plan §3): a Panel decoding the bytes at the
// Cursor into every primitive numeric type at once — read on demand, never
// spoken (the Viewport's cursor live region already speaks position and byte,
// ADR-0005). Byte order (#55) comes from the `preferences` store; its control
// lives on the main toolbar. The `hex` toggle (plan §3.3) sits in a small
// control strip at the top of the Panel's content.
//
// Phase 1.75 surgery (plan-phase1.75.md §3.5): the bottom/right dock, the
// dock-toggle button, the collapse-to-thin-bar button, the inline-width `watch`
// and `resize: horizontal` are gone. Whether the Panel is shown is the
// Sidebar's accordion's job (#80); here it simply renders whenever a document
// is open.

const NO_CURSOR = '—' // no Cursor yet, or a type wider than the bytes left at EOF
const PENDING = '··' // bytes not yet resident — the grid's pending glyph

const documentStore = useDocumentStore()
const preferences = usePreferencesStore()

const hasSource = computed(() => documentStore.source !== null)

/** The Cursor — the focus end of the one Selection, or `null` before any click. */
const cursorOffset = computed(() => documentStore.selection?.focus ?? null)

// The ≤ 8 bytes at the Cursor, resident-synchronous when they can be, short at
// EOF, `null` while pending (#54, plan §3.4).
const run = useBytesAt(
  computed(() => documentStore.source),
  cursorOffset,
  INSPECTOR_READ_LENGTH,
)

/**
 * `value` — a real decode; `no-cursor` — no Cursor yet, or a type wider than the
 * bytes left at EOF; `pending` — the run is not yet resident (plan §3.4). The
 * glyph and the disabled/enabled state both follow from this, rather than being
 * inferred by string-comparing the glyph back.
 */
type RowState = 'value' | 'no-cursor' | 'pending'

interface RenderedRow {
  readonly key: string
  readonly label: string
  readonly ariaLabel: string
  readonly state: RowState
  readonly text: string
}

/**
 * One hairline-separated group of rows (plan §3.2) — `u16`/`i16`, `f32`/`f64`,
 * etc. The group, not the row, is the wrap unit: the unsigned and signed rows of
 * a width always move to the next line together.
 */
interface RenderedGroup {
  readonly key: string
  readonly rows: RenderedRow[]
}

const GLYPH: Record<Exclude<RowState, 'value'>, string> = {
  'no-cursor': NO_CURSOR,
  pending: PENDING,
}

const groups = computed<RenderedGroup[]>(() => {
  const bytes = run.value
  const opts = { byteOrder: preferences.byteOrder, intHex: preferences.intHex }
  const out: RenderedGroup[] = []
  for (const row of INSPECTOR_ROWS) {
    let state: RowState
    if (cursorOffset.value === null || (bytes !== null && bytes.length < row.width)) {
      state = 'no-cursor'
    } else if (bytes === null) {
      state = 'pending'
    } else {
      state = 'value'
    }
    const rendered: RenderedRow = {
      key: row.key,
      label: row.key,
      ariaLabel: row.ariaLabel,
      state,
      text: state === 'value' ? decodeInspectorRow(row, bytes!, opts) : GLYPH[state],
    }
    const last = out[out.length - 1]
    const groupKey = `g${row.group}`
    if (last !== undefined && last.key === groupKey) {
      last.rows.push(rendered)
    } else {
      out.push({ key: groupKey, rows: [rendered] })
    }
  }
  return out
})

function toggleHex(): void {
  preferences.setIntHex(!preferences.intHex)
}

function copyRow(row: RenderedRow): void {
  if (row.state !== 'value') {
    return
  }
  void documentStore.copyInspectorValue(row.label, row.text)
}
</script>

<template>
  <section
    v-if="hasSource"
    class="inspector"
    role="region"
    aria-label="Cursor inspector"
    data-region="inspector"
  >
    <div class="inspector__controls">
      <button
        type="button"
        class="inspector__ctl inspector__ctl--text"
        :aria-pressed="preferences.intHex"
        aria-label="Show integers as hexadecimal"
        data-field="inspector-hex"
        @click="toggleHex"
      >
        hex
      </button>
    </div>

    <div class="inspector__rows">
      <ul
        v-for="(group, index) in groups"
        :key="group.key"
        class="inspector__group"
        :class="{ 'inspector__group--rule': index > 0 }"
      >
        <li v-for="row in group.rows" :key="row.key" class="inspector__row">
          <span class="inspector__label" :title="row.ariaLabel">{{ row.label }}</span>
          <button
            type="button"
            class="inspector__value"
            :class="{ 'inspector__value--placeholder': row.state !== 'value' }"
            :disabled="row.state !== 'value'"
            :aria-label="`Copy the ${row.ariaLabel} value`"
            :data-field="`inspector-${row.key}`"
            @click="copyRow(row)"
          >
            {{ row.text }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* A full-width strip above the status bar: the control strip, then the rows,
   the group the wrap unit on a narrow screen (plan §3.1, §3.2). The Sidebar
   relocation and per-section collapse are #80's. */
.inspector {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 1.5ch;
  width: 100%;
  max-height: 40%;
  overflow: auto;
  padding: 0.25rem 0.5rem;
  border-top: 1px solid var(--color-border);
  font-family: var(--font-mono);
  color: var(--color-fg);
  background: var(--color-bg);
}

.inspector__controls {
  display: inline-flex;
  align-items: center;
  gap: 0.5ch;
  flex: none;
}

.inspector__ctl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6em;
  padding: 0.1em 0.3em;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: none;
  color: var(--color-fg);
  font: inherit;
  cursor: pointer;
}

.inspector__ctl[aria-pressed='true'] {
  background: var(--color-selection);
  color: var(--color-selection-fg);
}

.inspector__rows {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1.5ch;
}

/* The group is the wrap unit (plan §3.1): its rows sit in a row and never break
   apart — a narrow viewport wraps whole groups. */
.inspector__group {
  display: flex;
  align-items: baseline;
  flex-wrap: nowrap;
  gap: 0.75ch 1.5ch;
  margin: 0;
  padding: 0;
  list-style: none;
}

.inspector__row {
  display: inline-flex;
  align-items: baseline;
  gap: 0.75ch;
}

/* The hairline between groups (plan §3.2): a rule before every group but the first. */
.inspector__group--rule {
  border-left: 1px solid var(--color-border);
  padding-left: 1.5ch;
}

.inspector__label {
  color: var(--color-fg-dim);
}

.inspector__value {
  border: none;
  background: none;
  color: var(--color-fg);
  font: inherit;
  padding: 0 0.25ch;
  cursor: pointer;
}

.inspector__value:hover:not(:disabled) {
  background: var(--color-hover);
}

.inspector__value--placeholder {
  color: var(--color-fg-dim);
  cursor: default;
}
</style>
