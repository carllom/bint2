import { shallowRef, watch } from 'vue'
import type { Ref } from 'vue'
import type { ByteSource } from '@/core'
import { useBytesAt } from './useBytesAt'

/**
 * The single byte at `offset` in `source` — the point read shared by the
 * Viewport's cursor live region (#27) and, before phase 1.5, the status bar's
 * `u8`/`i8`/`bin` fields (#23). It is {@link useBytesAt} with a run length of
 * one, mapped to the byte value (or `null` when the run is pending, empty at
 * EOF, or there is no source / offset). All of the interesting behaviour —
 * resident-synchronous resolution, the identity-based staleness guard, the
 * `source-gone` → dead-source-banner escalation — lives in `useBytesAt`.
 */
export function useByteAt(
  source: Ref<ByteSource | null>,
  offset: Ref<number | null>,
): Ref<number | null> {
  const run = useBytesAt(source, offset, 1)
  const byte = shallowRef<number | null>(null)
  watch(
    run,
    (bytes) => {
      byte.value = bytes !== null && bytes.length >= 1 ? bytes[0]! : null
    },
    { immediate: true },
  )
  return byte
}
