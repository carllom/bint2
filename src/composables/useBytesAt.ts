import { shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import { ByteSourceError } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'

/**
 * A short run of bytes starting at `offset` — the generalisation of
 * {@link useByteAt} the Inspector and the Bitmap both read through (#54,
 * plan §3.4; plan-phase1.75 §4.6, #66). It reads `min(length, size - offset)`
 * bytes, so a run that would cross EOF comes back **short** rather than failing:
 * the Inspector paints a dim `—` for a numeric row whose type is wider than what
 * came back, and the Bitmap packs the bytes that exist and leaves the rest
 * background.
 *
 * `length` is a {@link MaybeRefOrGetter} so the span can change reactively: the
 * Bitmap's read span is `Stride·(Height − 1) + Width`, and a Width / Stride /
 * Height change must re-issue the read at the new length. `useByteAt` passes a
 * constant `1` and is unaffected.
 *
 * `readSync` serves the run in the same frame when the whole thing is resident
 * — the Bitmap's Follow-mode hot path, where consecutive spans overlap almost
 * entirely; otherwise the guarded async `read` fills it in. Staleness is guarded
 * by capturing `source`, `offset` **and the requested `length`** (`toValue`d
 * before the EOF clamp) and comparing them when the read settles, so a stale
 * read from a previous span cannot clobber a newer one. A `source-gone`
 * rejection raises the dead-source banner
 * (#26, ADR-0004), the one escalation this read makes on its own; `read-failed`'s
 * consecutive-rejection escalation stays owned by `HexViewer`'s row-fetch path.
 *
 * The returned ref is `null` while the run is not yet resident (the Panel shows
 * `··`) and a `Uint8Array` — possibly shorter than `length` at EOF — once it is.
 */
export function useBytesAt(
  source: Ref<ByteSource | null>,
  offset: Ref<number | null>,
  length: MaybeRefOrGetter<number>,
): Ref<Uint8Array | null> {
  const bytes = shallowRef<Uint8Array | null>(null)
  const documentStore = useDocumentStore()

  watch(
    () => [source.value, offset.value, toValue(length)] as const,
    ([src, at, len]) => {
      bytes.value = null
      if (src === null || at === null) {
        return
      }
      const want = Math.max(0, Math.min(len, src.size - at))
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
          if (source.value === src && offset.value === at && toValue(length) === len) {
            bytes.value = got
          }
        })
        .catch((error: unknown) => {
          if (source.value !== src || offset.value !== at || toValue(length) !== len) {
            return // a newer source, offset or span owns the Panel now
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
