import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { rowByteSpan } from '@/core'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi)

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

  /**
   * The Bitmap's effective render height in rows. `bitmapHeight` may be `null`
   * (→ measured by `BitmapPanel` at first open), so the Panel is the only place
   * that knows the resolved value; it writes it here so the Extent marker
   * (plan §4.8) can compute the run's end without re-deriving that measurement.
   * `1` until the Panel first reports — harmless, the marker only renders while
   * locked *and* the Panel is mounted.
   */
  const renderHeight = ref(1)

  const documentStore = useDocumentStore()
  const preferences = usePreferencesStore()

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
   * Nudge the locked Origin by `delta` bytes — `±1`, `±Stride`, `±(Stride ×
   * rows)` from the section's `←→` / `↑↓` / `PageUp`·`PageDown` keys (plan
   * §4.5). Clamped to `[0, size]`; Origin `== size` is a legal "nudged off the
   * end" state (plan §4.10). A no-op while following, so a stray call in Follow
   * mode can never resurrect a stale offset.
   */
  function nudgeOrigin(delta: number): void {
    if (!originLocked.value || lockedOffset.value === null) {
      return
    }
    lockedOffset.value = clamp(lockedOffset.value + delta, 0, documentStore.fileSize)
  }

  /**
   * Jump the locked Origin to an absolute offset — `Home` → `0`, `End` → `size`
   * (plan §4.5, §4.10). Same clamp, same Follow-mode no-op as {@link nudgeOrigin}.
   */
  function jumpOrigin(to: number): void {
    if (!originLocked.value) {
      return
    }
    lockedOffset.value = clamp(to, 0, documentStore.fileSize)
  }

  /** `BitmapPanel` reports its resolved render height (rows) here — see
   *  {@link renderHeight}. */
  function setRenderHeight(rows: number): void {
    renderHeight.value = Math.max(1, Math.trunc(rows))
  }

  /**
   * The locked **Extent** as a half-open byte range `[start, end)` —
   * `[Origin, Origin + Stride·(Height−1) + Width)` (CONTEXT.md "Extent",
   * plan §4.8). `null` unless the Origin is locked; Follow mode shows nothing —
   * the linkage there *is* the Cursor. Transient view chrome, not an
   * Annotation: the hex grid's passive gutter overlay reads this (ADR-0011).
   */
  const extent = computed<{ start: number; end: number } | null>(() => {
    if (!originLocked.value || lockedOffset.value === null) {
      return null
    }
    const span = rowByteSpan({
      width: preferences.bitmapWidth,
      stride: preferences.bitmapStride,
      height: renderHeight.value,
    })
    return { start: lockedOffset.value, end: lockedOffset.value + span }
  })

  return {
    originLocked,
    lockedOffset,
    extent,
    lockOrigin,
    followCursor,
    nudgeOrigin,
    jumpOrigin,
    setRenderHeight,
  }
})
