import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { ByteSource } from '@/core'

/**
 * The open document: its {@link ByteSource} and its identity. Shared through a
 * store so the drop zone, viewer and (later) toolbar / status bar don't
 * prop-drill (plan §10).
 *
 * Opening a second document closes the first — the universal reset (plan §6).
 */
export const useDocumentStore = defineStore('document', () => {
  // shallowRef: the source wraps a `File` and manages its own state; Vue must
  // not deep-proxy it.
  const source = shallowRef<ByteSource | null>(null)
  const fileName = ref<string | null>(null)
  const fileSize = ref(0)

  function open(next: ByteSource, name: string): void {
    source.value?.close()
    source.value = next
    fileName.value = name
    fileSize.value = next.size
  }

  return { source, fileName, fileSize, open }
})
