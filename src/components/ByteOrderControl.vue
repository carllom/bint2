<script setup lang="ts">
import { usePreferencesStore } from '@/stores/preferences'
import { useDocumentStore } from '@/stores/document'

// The toolbar control for the one view-wide byte order (#55, ADR-0007). A radio
// segment mirroring `BytesPerRowControl`, immediately after it — `LE` / `BE`
// with a spelled-out `aria-label` each. The plain `b` hotkey in `HexViewer`
// flips the same setting; both announce through the action region (plan §4.3).
// Likely becomes a button group once a component library lands (plan §4.1).

const OPTIONS = [
  { value: 'le', label: 'LE', aria: 'little-endian' },
  { value: 'be', label: 'BE', aria: 'big-endian' },
] as const

const preferences = usePreferencesStore()
const documentStore = useDocumentStore()

function choose(value: 'le' | 'be'): void {
  if (value === preferences.byteOrder) {
    return
  }
  preferences.setByteOrder(value)
  documentStore.announceByteOrder(value)
}
</script>

<template>
  <fieldset class="byte-order-control">
    <legend class="byte-order-control__legend">Byte order</legend>
    <label
      v-for="option in OPTIONS"
      :key="option.value"
      class="byte-order-control__option"
    >
      <input
        type="radio"
        name="byte-order"
        :value="option.value"
        :aria-label="option.aria"
        :checked="preferences.byteOrder === option.value"
        @change="choose(option.value)"
      />
      {{ option.label }}
    </label>
  </fieldset>
</template>

<style scoped>
.byte-order-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 100%;
  margin: 0;
  padding: 0 0.5rem;
  border: none;
}

/* A <legend> is not a flex item; float it back inline beside the options. */
.byte-order-control__legend {
  float: left;
  margin-right: 0.5rem;
  padding: 0;
  line-height: 2rem;
  color: var(--color-fg-dim);
}

.byte-order-control__option {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
}
</style>
