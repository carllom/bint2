<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, useTemplateRef } from 'vue'
import { byteSourceFactoryKey, defaultByteSourceFactory } from '@/byteSourceFactory'
import { useDocumentStore } from '@/stores/document'

// Phase-1 file open (plan §6): one `File`, via this button's hidden <input> or
// window drag-drop. No folder, no multi-file, no picker API. The full reject
// policy (directory refusal, silent announcements) lands with the drop-zone UI
// at M5; here only the free parts hold — first-of-many, ignore a non-file drop,
// ignore a cancelled picker.

const documentStore = useDocumentStore()
const createByteSource = inject(byteSourceFactoryKey, defaultByteSourceFactory)
const input = useTemplateRef<HTMLInputElement>('input')

function open(file: File): void {
  documentStore.open(createByteSource(file), file.name)
}

function onPick(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    open(file)
  }
  // Reset so re-picking the same file still fires `change`.
  target.value = ''
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    open(file)
  }
}

function onDragOver(event: DragEvent): void {
  event.preventDefault() // required for `drop` to fire
}

onMounted(() => {
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <div class="file-drop-zone">
    <button type="button" class="file-drop-zone__button" @click="input?.click()">
      Open file…
    </button>
    <input ref="input" class="file-drop-zone__input" type="file" hidden @change="onPick" />
  </div>
</template>

<style scoped>
.file-drop-zone {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 0.5rem;
}

.file-drop-zone__button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0.15rem 0.6rem;
  cursor: pointer;
}

.file-drop-zone__button:hover {
  border-color: var(--color-fg-dim);
}
</style>
