import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { clampTopOffset } from '@/core'
import type { ByteSource, ViewportMetrics } from '@/core'

/**
 * The open document: its {@link ByteSource}, its identity, and where the
 * Viewport sits in it. Shared through a store so the drop zone, viewer,
 * scrollbar and (later) toolbar / status bar don't prop-drill (plan §10).
 *
 * Opening a second document closes the first — the universal reset (plan §6).
 */
export const useDocumentStore = defineStore('document', () => {
  // shallowRef: the source wraps a `File` and manages its own state; Vue must
  // not deep-proxy it.
  const source = shallowRef<ByteSource | null>(null)
  const fileName = ref<string | null>(null)
  const fileSize = ref(0)

  // The sole scroll coordinate (ADR-0006): an integer, always a clamped multiple
  // of `bytesPerRow`. The first row is derived from it, never stored alongside.
  const topByteOffset = ref(0)
  // Fixed at 16 for now; the presets that vary it — and preserve the byte
  // offset across a change — land with their own milestone (#19).
  const bytesPerRow = ref(16)

  function open(next: ByteSource, name: string): void {
    source.value?.close()
    source.value = next
    fileName.value = name
    fileSize.value = next.size
    topByteOffset.value = 0
  }

  /**
   * Move the Viewport. Every navigation gesture — wheel, thumb drag, later Goto
   * and the keyboard — produces a candidate offset and funnels it through
   * {@link clampTopOffset}, the single choke point (ADR-0006).
   */
  function scrollTo(candidateOffset: number, metrics: ViewportMetrics): void {
    topByteOffset.value = clampTopOffset(candidateOffset, metrics)
  }

  return { source, fileName, fileSize, topByteOffset, bytesPerRow, open, scrollTo }
})
