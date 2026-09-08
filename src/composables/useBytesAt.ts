import { shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { ByteSourceError } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'

/**
 * A short run of bytes starting at `offset` — the generalisation of
 * {@link useByteAt} the Inspector needs (#54, plan §3.4). It reads
 * `min(length, size - offset)` bytes, so a run that would cross EOF comes back
 * **short** rather than failing: the Inspector paints a dim `—` for a numeric
 * row whose type is wider than what came back.
 *
 * `readSync` serves the run in the same frame when the whole thing is resident;
 * otherwise the guarded async `read` fills it in. Staleness is guarded exactly
 * as {@link useByteAt} guards it — by capturing `source` and `offset` and
 * comparing them by identity / value when the read resolves — and a
 * `source-gone` rejection raises the dead-source banner (#26, ADR-0004), the
 * one escalation this read makes on its own. `read-failed`'s
 * consecutive-rejection escalation stays owned by `HexViewer`'s row-fetch path.
 *
 * The returned ref is `null` while the run is not yet resident (the Panel shows
 * `··`) and a `Uint8Array` — possibly shorter than `length` at EOF — once it is.
 */
export function useBytesAt(
  source: Ref<ByteSource | null>,
  offset: Ref<number | null>,
  length: number,
): Ref<Uint8Array | null> {
  const bytes = shallowRef<Uint8Array | null>(null)
  const documentStore = useDocumentStore()

  watch(
    () => [source.value, offset.value] as const,
    ([src, at]) => {
      bytes.value = null
      if (src === null || at === null) {
        return
      }
      const want = Math.max(0, Math.min(length, src.size - at))
      if (want === 0) {
        bytes.value = new Uint8Array(0) // at or past EOF — nothing to read, not pending
        return
      }

      const hit = src.readSync(at, want)
      if (hit !== null) {
        bytes.value = hit
        return
      }
      src
        .read(at, want)
        .then((got) => {
          if (source.value === src && offset.value === at) {
            bytes.value = got
          }
        })
        .catch((error: unknown) => {
          if (source.value !== src || offset.value !== at) {
            return // a newer source or offset owns the Panel now
          }
          if (error instanceof ByteSourceError && error.code === 'source-gone') {
            documentStore.setSourceHealth('gone')
          }
          // read-failed / source-closed: leave the run pending, no escalation here.
        })
    },
    { immediate: true },
  )

  return bytes
}
