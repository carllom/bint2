import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import type { DerivedWorkJobHandle, SelectionRange, StatsResult } from '@/core'
import { useDocumentStore } from '@/stores/document'

export type EntropyMode = 'map' | 'histogram'
export type EntropyScope = 'file' | 'selection'

/**
 * The exact `(range, blockSize)` the current {@link result} answers for —
 * what the Panel compares the *live* scope/Selection/block-size inputs
 * against to decide staleness (#107, plan-phase2.md §4.3): "changing scope,
 * the Selection's range, or block size marks the current joint result
 * stale... rather than clearing it". Kept alongside `result` rather than
 * re-derived, since the live inputs may already have moved on by the time a
 * result lands.
 */
export interface EntropyComputedFor extends SelectionRange {
  readonly blockSize: number
}

/**
 * The Entropy panel's Map/Histogram state (#107, CONTEXT.md's Entropy map /
 * Byte histogram, ADR-0012, plan-phase2.md §4). A store of its own — not
 * component-local state — for the same reason `useBitmapStore` exists: the
 * Entropy accordion section is `unmount-on-hide`, and a completed (or
 * in-flight) joint scan is expensive enough (18-24s continuous, plan §2.1)
 * that collapsing the section to glance at another Panel must not lose it.
 *
 * `mode` and `scope` are session-only (plan §5 boundary matrix) — never
 * `bint2:preferences` — mirroring the Bitmap Origin mode's own session-only
 * precedent (ADR-0008).
 */
export const useEntropyStore = defineStore('entropy', () => {
  const documentStore = useDocumentStore()

  /** Map (default) | Histogram — a pure view-swap over one computed result (ADR-0012); never retriggers Compute. */
  const mode = ref<EntropyMode>('map')
  /** Whole file (default) | Selection — falls back to whole file with no non-collapsed Selection (plan §4.3). */
  const scope = ref<EntropyScope>('file')
  /** The last completed joint scan — both renderings' shared source (ADR-0012). `null` until the first Compute lands. */
  const result = shallowRef<StatsResult | null>(null)
  /** What `result` was computed for — see {@link EntropyComputedFor}. */
  const computedFor = shallowRef<EntropyComputedFor | null>(null)
  /** True while a `'stats'` job dispatched by {@link compute} is in flight. */
  const pending = ref(false)
  const progressPercent = ref(0)
  /** The in-flight job's handle, kept here (not component-local) so Cancel still works after the section closes mid-Compute. */
  const jobHandle = shallowRef<DerivedWorkJobHandle<StatsResult> | null>(null)

  /** A new/closed document invalidates every previous result (plan §6, the universal reset) — cancels any in-flight job too. */
  watch(
    () => documentStore.source,
    () => {
      jobHandle.value?.cancel()
      jobHandle.value = null
      mode.value = 'map'
      scope.value = 'file'
      result.value = null
      computedFor.value = null
      pending.value = false
      progressPercent.value = 0
    },
  )

  function setMode(next: EntropyMode): void {
    mode.value = next
  }

  function setScope(next: EntropyScope): void {
    scope.value = next
  }

  /**
   * The Compute action (plan §4.2): dispatches the joint `'stats'` scan over
   * `range` at `blockSize` to the document's shared `DerivedWorkClient`.
   * Supersedes whatever job — search or a previous stats scan, of any kind
   * (ADR-0013 §2.4/§2.7) — is currently running on that client; a no-op with
   * no document open. `result` and `computedFor` are left exactly as they
   * were until this one resolves, so the previous result stays visible
   * (dimmed as stale by the Panel) rather than being cleared mid-scan.
   */
  function compute(range: SelectionRange, blockSize: number): void {
    const client = documentStore.derivedWorkClient
    if (client === null) {
      return
    }
    pending.value = true
    progressPercent.value = 0
    const handle = client.stats({ range, blockSize }, (progress) => {
      progressPercent.value = progress.percent
    })
    jobHandle.value = handle

    handle.result
      .then((next) => {
        if (jobHandle.value !== handle) {
          return // superseded/cancelled before this landed
        }
        result.value = next
        computedFor.value = { start: range.start, end: range.end, blockSize }
        pending.value = false
        jobHandle.value = null
      })
      .catch(() => {
        if (jobHandle.value !== handle) {
          return
        }
        // Cancelled (explicitly, or superseded by another job) or errored:
        // nothing new landed — the previous result/computedFor, if any, is
        // untouched.
        pending.value = false
        jobHandle.value = null
      })
  }

  /** Stops the in-flight Compute (plan §4.2). The previous result, if any, is untouched. */
  function cancel(): void {
    jobHandle.value?.cancel()
    jobHandle.value = null
    pending.value = false
  }

  return {
    mode,
    scope,
    result,
    computedFor,
    pending,
    progressPercent,
    setMode,
    setScope,
    compute,
    cancel,
  }
})
