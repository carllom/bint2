<script setup lang="ts">
import { BYTES_PER_ROW_PRESETS, useDocumentStore } from '@/stores/document'

// The toolbar control that reshapes the grid (#19). Four labelled presets,
// default 16, and the only lever on `bytesPerRow` — the grid is never
// width-responsive (ADR-0005). Changing the preset keeps the reader on the same
// byte, not the same row: preserving the offset is the Viewport's job, done
// through the `clampTopOffset` choke point (ADR-0006).

const documentStore = useDocumentStore()
</script>

<template>
  <fieldset class="bpr-control">
    <legend class="bpr-control__legend">Bytes per row</legend>
    <label v-for="preset in BYTES_PER_ROW_PRESETS" :key="preset" class="bpr-control__option">
      <input
        type="radio"
        name="bytes-per-row"
        :value="preset"
        :checked="documentStore.bytesPerRow === preset"
        @change="documentStore.setBytesPerRow(preset)"
      />
      {{ preset }}
    </label>
  </fieldset>
</template>

<style scoped>
.bpr-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 100%;
  margin: 0;
  padding: 0 0.5rem;
  border: none;
}

/* A <legend> is not a flex item; float it back inline beside the options. */
.bpr-control__legend {
  float: left;
  margin-right: 0.5rem;
  padding: 0;
  line-height: 2rem;
  color: var(--color-fg-dim);
}

.bpr-control__option {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
}
</style>
