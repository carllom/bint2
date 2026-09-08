<script setup lang="ts">
import { CODE_PAGES } from '@/core'
import type { CodePage } from '@/core'
import { usePreferencesStore } from '@/stores/preferences'

// The toolbar selector for the char column's code page (#56, plan §5.3): a
// plain `<select>` beside the bytes-per-row and byte-order controls. Persisted
// as `codePage`; no hotkey (a six-way list does not cycle cleanly on one key).
// One view-wide setting — not per-Selection, per-Annotation, or per-file.

const LABELS: Record<CodePage, string> = {
  ascii: 'ASCII',
  cp437: 'CP437 (DOS)',
  'windows-1252': 'Windows-1252',
  petscii: 'PETSCII (graphics)',
  'petscii-lower': 'PETSCII (lowercase)',
  akai: 'AKAI',
}

const preferences = usePreferencesStore()

function onChange(event: Event): void {
  preferences.setCodePage((event.target as HTMLSelectElement).value as CodePage)
}
</script>

<template>
  <label class="code-page-control">
    <span class="code-page-control__label">Code page</span>
    <select
      class="code-page-control__select"
      :value="preferences.codePage"
      @change="onChange"
    >
      <option v-for="page in CODE_PAGES" :key="page" :value="page">{{ LABELS[page] }}</option>
    </select>
  </label>
</template>

<style scoped>
.code-page-control {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 100%;
  padding: 0 0.5rem;
}

.code-page-control__label {
  color: var(--color-fg-dim);
}

.code-page-control__select {
  font: inherit;
  color: var(--color-fg);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0.1em 0.3em;
}
</style>
