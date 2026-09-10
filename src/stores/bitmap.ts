import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useDocumentStore } from '@/stores/document'

/**
 * The Bitmap's follow/lock **Origin** state machine (CONTEXT.md "Origin",
 * ADR-0008, plan-phase1.75 §4.4). Two modes:
 *
 * - **Follow** (default): the Origin === the Cursor's byte offset, tracked
 *   byte-for-byte. `BitmapPanel` couples the two; this store just says "not
 *   locked".
 * - **Lock**: the Origin is frozen at {@link lockedOffset}. The Cursor moves
 *   independently and the render takes no Cursor input; the section's own
 *   arrow / page / Home-End keys nudge the offset here (plan §4.5).
 *
 * Session-only and deliberately **not persisted** — `bint2:preferences` never
 * sees the mode or the offset, and every browser reload starts in Follow
 * (ADR-0008 Consequences; plan §4.2). Persisting the mode, and named saved
 * Bitmap views, is a sanctioned later extension near the **Annotation** concept.
 *
 * It lives in a store rather than in `BitmapPanel.vue` for one reason: the
 * Bitmap accordion section is `unmount-on-hide`, and the lock (mode + offset)
 * must survive the section closing and reopening (plan §3.6, §4.2). A store
 * outlives the component; component-local state would not.
 */
export const useBitmapStore = defineStore('bitmap', () => {
  /** `true` while the Origin is locked; `false` in Follow mode (the default). */
  const originLocked = ref(false)
  /**
   * The frozen Origin byte offset while locked, `null` in Follow. Only the
   * section's nudge keys move it — never a Cursor move (plan §4.4).
   */
  const lockedOffset = ref<number | null>(null)

  const documentStore = useDocumentStore()

  /**
   * Opening another document is the universal reset (plan §6, document store
   * `open`): a locked offset measured against the previous file is meaningless
   * against the new one, so the mode falls back to Follow. This is not the
   * browser reload ADR-0008 speaks of, but carrying a stale locked offset
   * across a document switch would be a worse surprise than dropping the lock.
   */
  watch(
    () => documentStore.source,
    () => {
      originLocked.value = false
      lockedOffset.value = null
    },
    { flush: 'sync' },
  )

  /**
   * **Lock Origin** (plan §4.4): freeze the Origin at `offset` — the Cursor's
   * current offset, passed in by `BitmapPanel` since only it knows the live
   * coupling.
   */
  function lockOrigin(offset: number): void {
    originLocked.value = true
    lockedOffset.value = offset
  }

  /**
   * **Follow Cursor** (plan §4.4): drop the lock and resume tracking. The
   * caller re-couples the Origin to the Cursor's *current* offset, so this
   * "snaps back" even if the Cursor moved while locked.
   */
  function followCursor(): void {
    originLocked.value = false
    lockedOffset.value = null
  }

  /**
   * Move the locked Origin to `offset` — the section's `←→` / `↑↓` /
   * `PageUp`·`PageDown` / `Home`·`End` keys (plan §4.5), already clamped by the
   * caller to `[0, size]`. A no-op while following, so a stray call in Follow
   * mode can never resurrect a stale offset.
   */
  function setLockedOffset(offset: number): void {
    if (originLocked.value) {
      lockedOffset.value = offset
    }
  }

  return { originLocked, lockedOffset, lockOrigin, followCursor, setLockedOffset }
})
