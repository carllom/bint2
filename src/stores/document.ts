import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { clampTopOffset } from '@/core'
import type { ByteSource, ViewportMetrics } from '@/core'

/**
 * The bytes-per-row presets the reader can reshape the grid to (#19, ADR-0006).
 * Every one is a multiple of 8 — the alignment constraint phase 1 owes the
 * phase-1.5 element view — and the grid is never width-responsive, so these are
 * the only lever.
 */
export const BYTES_PER_ROW_PRESETS = [8, 16, 24, 32] as const
export type BytesPerRow = (typeof BYTES_PER_ROW_PRESETS)[number]

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
  // One of BYTES_PER_ROW_PRESETS; default 16. Changing it is the only way the
  // grid reshapes (#19).
  const bytesPerRow = ref<BytesPerRow>(16)

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

  /**
   * Reshape the grid to `next` bytes per row (#19, ADR-0006). Only the preset
   * changes here; `topByteOffset` is realigned to the new row width by the
   * Viewport, which funnels the current offset back through {@link
   * clampTopOffset} — the one navigation choke point — the moment the metrics
   * change. The byte offset is preserved (aligned **down**), not the row index,
   * so repeated changes ratchet the offset down by up to `next - 1` bytes each.
   * A non-preset value is ignored.
   */
  function setBytesPerRow(next: number): void {
    if ((BYTES_PER_ROW_PRESETS as readonly number[]).includes(next)) {
      bytesPerRow.value = next as BytesPerRow
    }
  }

  return {
    source,
    fileName,
    fileSize,
    topByteOffset,
    bytesPerRow,
    open,
    scrollTo,
    setBytesPerRow,
  }
})
