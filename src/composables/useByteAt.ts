import { shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import { ByteSourceError } from '@/core'
import type { ByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'

/**
 * The single byte at `offset` in `source` — the point read shared by the
 * status bar's `u8`/`i8`/`bin` fields (#23) and the Viewport's cursor live
 * region (#27). Resident bytes resolve synchronously through `readSync`
 * (ADR-0001: non-null only on a full local hit, so a hit is always exactly
 * the one byte asked for); otherwise the async `read` fills it in.
 *
 * Staleness is guarded the way the store's own `copySelectionAsHex` guards its
 * async read (`src/stores/document.ts`'s `abandoned()`): by capturing `source`
 * and `offset` and comparing them by identity/value when the read resolves,
 * rather than a generation counter — a `Selection` offset is a plain number
 * and a `ByteSource` is swapped wholesale on open, so `===` is exact.
 *
 * A `source-gone` rejection raises the dead-source banner (#26, ADR-0004) —
 * the one escalation this point-read makes on its own, mirroring what the
 * row-fetch path already reports for the same code. `read-failed`'s
 * consecutive-rejection escalation stays owned by the row-fetch path in
 * `HexViewer.vue`; a single missed point read is not what that counter means.
 */
export function useByteAt(
  source: Ref<ByteSource | null>,
  offset: Ref<number | null>,
): Ref<number | null> {
  const byte = shallowRef<number | null>(null)
  const documentStore = useDocumentStore()

  watch(
    () => [source.value, offset.value] as const,
    ([src, at]) => {
      byte.value = null
      if (src === null || at === null) {
        return
      }
      const hit = src.readSync(at, 1)
      if (hit !== null) {
        byte.value = hit[0]!
        return
      }
      src
        .read(at, 1)
        .then((bytes) => {
          if (source.value === src && offset.value === at) {
            byte.value = bytes[0]!
          }
        })
        .catch((error: unknown) => {
          if (source.value !== src || offset.value !== at) {
            return // a newer source or offset owns the announcement now
          }
          if (error instanceof ByteSourceError && error.code === 'source-gone') {
            documentStore.setSourceHealth('gone')
          }
          // read-failed / source-closed: leave the byte unknown, no escalation here.
        })
    },
    { immediate: true },
  )

  return byte
}
