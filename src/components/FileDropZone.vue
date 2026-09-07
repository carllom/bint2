<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { byteSourceFactoryKey, defaultByteSourceFactory } from '@/byteSourceFactory'
import { useDocumentStore } from '@/stores/document'

// Phase-1 file open (plan §6, #21): one `File`, via this button's hidden
// <input> or window drag-drop. No folder, no multi-file, no picker API. The
// reject policy for everything that isn't the happy path is spec'd in #21; the
// only path that surfaces anything is a dropped directory, refused inline here.
//
// That refusal message stays local to this component. It and the dead-source
// banner (ADR-0004) are mutually exclusive states — the drop zone is the
// no-document state, the banner the document-is-dead state — so they are
// deliberately not unified behind a shared notification abstraction.

const DIRECTORY_REFUSAL = 'That’s a folder — drop a single file instead.'

const documentStore = useDocumentStore()
const createByteSource = inject(byteSourceFactoryKey, defaultByteSourceFactory)
const input = useTemplateRef<HTMLInputElement>('input')
const refusal = ref<string | null>(null)

function open(file: File): void {
  refusal.value = null
  documentStore.open(createByteSource(file), file.name)
}

function onPickClick(): void {
  // Reaching for the picker is a fresh attempt — drop a stale directory refusal
  // now rather than leaving it up behind the OS dialog. Cancelling the picker
  // still changes nothing else (#21).
  refusal.value = null
  input.value?.click()
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

/**
 * A dropped directory arrives in `dataTransfer.files` as a zero-byte, typeless
 * entry indistinguishable from a real empty file — which must open. Only the
 * filesystem entry tells the two apart. Anything less certain than an explicit
 * `isDirectory` falls through to the open path.
 */
function isDirectoryDrop(dataTransfer: DataTransfer): boolean {
  const entry = dataTransfer.items?.[0]?.webkitGetAsEntry?.()
  return entry?.isDirectory === true
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) {
    return
  }
  // A fresh drop gesture supersedes an earlier refusal, whatever it turns out
  // to be — so a stale "that's a folder" never outlives the drag it described.
  refusal.value = null
  if (isDirectoryDrop(dataTransfer)) {
    refusal.value = DIRECTORY_REFUSAL
    return
  }
  const file = dataTransfer.files?.[0]
  if (file) {
    open(file)
  }
  // A non-file drop (text fragment, link) has no `files` entry — ignored.
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
    <button type="button" class="file-drop-zone__button" @click="onPickClick">Open file…</button>
    <input ref="input" class="file-drop-zone__input" type="file" hidden @change="onPick" />
    <p v-if="refusal" class="file-drop-zone__refusal" role="alert">{{ refusal }}</p>
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

.file-drop-zone__refusal {
  margin: 0 0 0 0.75rem;
  color: var(--color-fg-dim);
}
</style>
