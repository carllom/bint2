<script setup lang="ts">
import { computed, nextTick, useTemplateRef } from 'vue'
import { decodeInspectorRow, INSPECTOR_READ_LENGTH, INSPECTOR_ROWS } from '@/core'
import { useBytesAt } from '@/composables/useBytesAt'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'

// The Inspector (CONTEXT.md, #54, plan §3): a docked Panel decoding the bytes at
// the Cursor into every primitive numeric type at once — read on demand, never
// spoken (the Viewport's cursor live region already speaks position and byte,
// ADR-0005). A one-off in a named `HomeView` layout slot, not a panel
// framework. Byte order (#55) comes from the `preferences` store; its control
// lives on the main toolbar, not this header.

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

interface RenderedRow {
  readonly key: string
  readonly label: string
  readonly ariaLabel: string
  /** True where the group index changes — a hairline is drawn before it. */
  readonly groupStart: boolean
  readonly text: string
  readonly placeholder: boolean
}

const rows = computed<RenderedRow[]>(() => {
  const bytes = run.value
  const opts = { byteOrder: preferences.byteOrder, intHex: preferences.intHex }
  let lastGroup = 0
  return INSPECTOR_ROWS.map((row) => {
    let text: string
    if (cursorOffset.value === null) {
      text = NO_CURSOR
    } else if (bytes === null) {
      text = PENDING
    } else if (bytes.length < row.width) {
      text = NO_CURSOR
    } else {
      text = decodeInspectorRow(row, bytes, opts)
    }
    const groupStart = row.group !== lastGroup && lastGroup !== 0
    lastGroup = row.group
    return {
      key: row.key,
      label: row.key,
      ariaLabel: row.ariaLabel,
      groupStart,
      text,
      placeholder: text === NO_CURSOR || text === PENDING,
    }
  })
})

const collapseToggle = useTemplateRef<HTMLButtonElement>('collapseToggle')
const expandBar = useTemplateRef<HTMLButtonElement>('expandBar')

/** Collapse / expand, keeping focus on whichever control the reader is now on (plan §3.7). */
async function toggleCollapsed(): Promise<void> {
  const next = !preferences.collapsed
  preferences.setCollapsed(next)
  await nextTick()
  if (next) {
    expandBar.value?.focus()
  } else {
    collapseToggle.value?.focus()
  }
}

function toggleDock(): void {
  preferences.setDock(preferences.dock === 'bottom' ? 'right' : 'bottom')
}

function toggleHex(): void {
  preferences.setIntHex(!preferences.intHex)
}

function copyRow(row: RenderedRow): void {
  if (row.placeholder) {
    return
  }
  void documentStore.copyInspectorValue(row.label, row.text)
}
</script>

<template>
  <section
    v-if="hasSource"
    class="inspector"
    :class="[`inspector--${preferences.dock}`, { 'inspector--collapsed': preferences.collapsed }]"
    role="region"
    aria-label="Cursor inspector"
    data-region="inspector"
  >
    <button
      v-if="preferences.collapsed"
      ref="expandBar"
      type="button"
      class="inspector__bar"
      :aria-expanded="false"
      data-field="inspector-expand"
      @click="toggleCollapsed"
    >
      <span class="inspector__bar-label">inspector</span>
      <span class="inspector__chevron" aria-hidden="true">▸</span>
    </button>

    <template v-else>
      <div class="inspector__header">
        <button
          ref="collapseToggle"
          type="button"
          class="inspector__ctl"
          :aria-expanded="true"
          aria-label="Collapse the inspector"
          data-field="inspector-collapse"
          @click="toggleCollapsed"
        >
          <span aria-hidden="true">▾</span>
        </button>
        <button
          type="button"
          class="inspector__ctl"
          :aria-label="
            preferences.dock === 'bottom' ? 'Dock the inspector right' : 'Dock the inspector bottom'
          "
          data-field="inspector-dock"
          @click="toggleDock"
        >
          <span aria-hidden="true">{{ preferences.dock === 'bottom' ? '⇥' : '⤓' }}</span>
        </button>
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

      <ul class="inspector__rows">
        <li
          v-for="row in rows"
          :key="row.key"
          class="inspector__row"
          :class="{ 'inspector__row--group-start': row.groupStart }"
        >
          <span class="inspector__label" :title="row.ariaLabel">{{ row.label }}</span>
          <button
            type="button"
            class="inspector__value"
            :class="{ 'inspector__value--placeholder': row.placeholder }"
            :disabled="row.placeholder"
            :aria-label="`Copy the ${row.ariaLabel} value`"
            :data-field="`inspector-${row.key}`"
            @click="copyRow(row)"
          >
            {{ row.text }}
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.inspector {
  flex: none;
  font-family: var(--font-mono);
  color: var(--color-fg);
  background: var(--color-bg);
}

/* Bottom strip: full width above the status bar, header then fields, wrapping
   to multiple rows on a narrow screen (plan §3.1). */
.inspector--bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 1.5ch;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border-top: 1px solid var(--color-border);
}

/* Right column: a stacked column down the right edge, header above the stack. */
.inspector--right {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  height: 100%;
  width: 16ch;
  padding: 0.5rem;
  overflow-y: auto;
  border-left: 1px solid var(--color-border);
}

.inspector__bar {
  display: flex;
  align-items: center;
  gap: 0.5ch;
  width: 100%;
  padding: 0.25rem 0.5rem;
  border: none;
  background: none;
  color: var(--color-fg-dim);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.inspector--right.inspector--collapsed {
  width: auto;
}

.inspector__header {
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
  margin: 0;
  padding: 0;
  list-style: none;
}

.inspector--right .inspector__rows {
  flex-direction: column;
  flex-wrap: nowrap;
}

.inspector__row {
  display: inline-flex;
  align-items: baseline;
  gap: 0.75ch;
}

/* The hairline between groups (plan §3.2): a rule before the first row of a
   group — vertical in the bottom strip, horizontal in the right column. */
.inspector--bottom .inspector__row--group-start {
  border-left: 1px solid var(--color-border);
  padding-left: 1.5ch;
}

.inspector--right .inspector__row--group-start {
  border-top: 1px solid var(--color-border);
  padding-top: 0.25rem;
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
