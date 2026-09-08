import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import {
  clampTopOffset,
  cursorAt,
  extendTo,
  rangeOf,
  toByteSize,
  toByteSizeDetail,
  toHexString,
  toRawText,
} from '@/core'
import type { ByteSource, Selection, ViewportMetrics } from '@/core'

/**
 * The bytes-per-row presets the reader can reshape the grid to (#19, ADR-0006).
 * Every one is a multiple of 8 — the alignment constraint phase 1 owes the
 * phase-1.5 element view — and the grid is never width-responsive, so these are
 * the only lever.
 */
export const BYTES_PER_ROW_PRESETS = [8, 16, 24, 32] as const
export type BytesPerRow = (typeof BYTES_PER_ROW_PRESETS)[number]

/**
 * The copy cap: **8 MiB of source bytes**, counted on the Selection's own
 * extent, never on the hex output (#25, ADR-0003). The Selection itself is
 * uncapped — marking a huge region is always allowed — but copying past this is
 * **refused**, not truncated: a silently short result is the exact bug this tool
 * exists to catch.
 */
export const COPY_BYTE_CAP = 8 * 1024 * 1024

/**
 * The outcome of the last action that feeds the action-status slot (ADR-0005):
 * a Selection copy — hex or raw text (#25, #30) — an Inspector row-value copy
 * (#54, plan §3.6), or a byte-order flip (#55, plan §4.3). What the visible
 * status bar and the action live region (#28) both read.
 */
export interface ActionStatus {
  readonly ok: boolean
  readonly message: string
  /**
   * A copy message reports on the Selection it was made from, so the
   * Selection-move watch clears it. A `sticky` message — the byte-order flip
   * (#55, plan §4.4) — has no such tie to the Selection and stays until the
   * next action replaces it.
   */
  readonly sticky?: boolean
}

/**
 * Whether the open document's {@link ByteSource} can still be trusted
 * (#26, ADR-0004). `'ok'` shows no chrome. `'gone'` is the latched
 * `source-gone` terminal state. `'failing'` is the escalation `HexViewer`
 * raises after too many consecutive `read-failed` rejections — the same
 * banner, different wording, and a single successful read resets it to
 * `'ok'`. `source-closed` never reaches this: it fires only because the
 * reader opened another document, and `open` below already resets to `'ok'`.
 */
export type SourceHealth = 'ok' | 'gone' | 'failing'

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

  // The one marked range (CONTEXT.md, ADR-0003). `null` until the reader first
  // points at a byte; `anchor === focus` is the Cursor. Held as byte offsets, so
  // both panes paint from it and no sub-byte position is representable. It does
  // not survive the document being closed.
  const selection = shallowRef<Selection | null>(null)

  // The last action-status message — a copy's success / refusal, or a
  // byte-order flip (#55). Transient: the watch below clears it when the
  // Selection moves, and `open` clears it when another document opens, so a
  // stale "Copied …" never lingers. Held here, not in a component, so the
  // visible status bar and the accessibility action region (#28) read the one
  // source. Renamed from `copyStatus` — two features now feed it (plan §4.4).
  const actionStatus = shallowRef<ActionStatus | null>(null)

  // The dead-source banner's state (#26, ADR-0004). `HexViewer` is what
  // observes the reads that drive this; the store just holds and resets it.
  const sourceHealth = shallowRef<SourceHealth>('ok')

  // A copy message reports on the Selection it was made from; the moment that
  // Selection moves, the message is stale. A `sticky` message — the byte-order
  // flip (#55) — has no such tie and rides straight through (plan §4.4).
  // (Opening a document is handled in `open`, which nulls the Selection and the
  // message together.)
  watch(
    selection,
    (next, prev) => {
      if (prev !== null && next !== prev && actionStatus.value?.sticky !== true) {
        actionStatus.value = null
      }
    },
    { flush: 'sync' },
  )

  function open(next: ByteSource, name: string): void {
    source.value?.close()
    source.value = next
    fileName.value = name
    fileSize.value = next.size
    topByteOffset.value = 0
    selection.value = null
    actionStatus.value = null
    sourceHealth.value = 'ok'
  }

  /**
   * Set by `HexViewer` — the sole writer — as it observes reads succeed or
   * reject (#26, ADR-0004). `'gone'` latches: once set, only `open` (a new
   * document) can move away from it. Without this guard, a `read-failed`
   * rejection settling after the `source-gone` rejection that latched the
   * source (both dispatched in the same batch of row reads, so I/O
   * completion order rather than dispatch order decides which settles last)
   * could downgrade the banner to `'failing'`, or a stale success could then
   * dismiss it entirely — for a source that is in fact permanently dead.
   */
  function setSourceHealth(next: SourceHealth): void {
    if (sourceHealth.value === 'gone' && next !== 'gone') {
      return
    }
    sourceHealth.value = next
  }

  /** Snap an arbitrary offset onto a real byte `[0, size - 1]`. */
  function clampByte(offset: number): number {
    if (!Number.isFinite(offset)) {
      return 0
    }
    return Math.min(Math.max(Math.trunc(offset), 0), fileSize.value - 1)
  }

  /**
   * Put the Cursor on `offset` — a plain click or an unshifted arrow. The
   * Selection collapses to a single position and any previous range is gone;
   * there is never more than one range.
   */
  function setCursor(offset: number): void {
    if (source.value === null || fileSize.value === 0) {
      return
    }
    selection.value = cursorAt(clampByte(offset))
  }

  /**
   * Extend the Selection's focus to `offset` — drag, Shift+click, Shift+arrows.
   * The anchor stays put, so a backwards Selection extends backwards. With no
   * Selection yet, this anchors where it lands.
   */
  function extendSelectionTo(offset: number): void {
    if (source.value === null || fileSize.value === 0) {
      return
    }
    const to = clampByte(offset)
    selection.value = selection.value === null ? cursorAt(to) : extendTo(selection.value, to)
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
   * Jump to an absolute byte offset — the Goto action (#24, ADR-0006). Unlike
   * the wheel and thumb drag, this gesture also moves the Cursor: it lands the
   * Cursor on the requested byte and the Viewport on that byte's row. An
   * out-of-range offset is **clamped to the document** (`clampByte`), never
   * rejected, and the view still funnels through {@link clampTopOffset} — the
   * single navigation choke point — so Goto is not a bypass.
   */
  function gotoOffset(offset: number, metrics: ViewportMetrics): void {
    if (source.value === null || fileSize.value === 0) {
      return
    }
    const target = clampByte(offset)
    selection.value = cursorAt(target)
    topByteOffset.value = clampTopOffset(target, metrics)
  }

  /** Write to the real platform clipboard — the injected default for both copies. */
  const platformWriteText = (text: string): Promise<void> => navigator.clipboard.writeText(text)

  /**
   * Copy the Selection to the clipboard, rendered by `render` — as hex (#25,
   * plan §7) or as raw text (#30). The two differ only in that renderer and the
   * word in the success message; everything that makes copy careful is shared
   * and lives here once.
   *
   * The Selection is uncapped, but the **copy** is not: past
   * {@link COPY_BYTE_CAP} of source bytes it is **refused** with a message
   * naming both the cap and the Selection's size, and nothing reaches the
   * clipboard — never a silently truncated result.
   *
   * The bytes are taken in **one** `read` call, which the page cache serves as a
   * Direct read once it is over its threshold (ADR-0002): the copy populates no
   * Pages and cannot flush the working set. Resident bytes are taken straight
   * from `readSync` first, so a wholly-resident Selection still copies after the
   * source has become a dead source.
   *
   * The `read` can suspend for the length of a Direct read; if the Selection
   * moves or another document opens in that window, whatever it resolves into
   * belongs to a range the reader has left, so it is dropped — no stale
   * clipboard, no stale message.
   */
  async function copySelection(
    kind: 'hex' | 'text',
    render: (bytes: Uint8Array) => string,
    writeText: (text: string) => Promise<void>,
  ): Promise<void> {
    const src = source.value
    const sel = selection.value
    if (src === null || sel === null || fileSize.value === 0) {
      return
    }
    // True once the copy's context is gone — a different source, or a moved
    // Selection. `rangeOf` offsets are already byte-clamped by the store, so
    // `end - start` needs no further clamping and is always ≥ 1.
    const abandoned = (): boolean => source.value !== src || selection.value !== sel

    const { start, end } = rangeOf(sel)
    const bytes = end - start

    if (bytes > COPY_BYTE_CAP) {
      actionStatus.value = {
        ok: false,
        message:
          `Selection is ${toByteSizeDetail(bytes)} — ` +
          `over the ${toByteSize(COPY_BYTE_CAP)} copy limit. Nothing was copied.`,
      }
      return
    }

    // Resident bytes first: no fetch, nothing populated, and it still works once
    // the source is dead. Otherwise one `read` — a Direct read past the cache's
    // threshold — which also populates nothing.
    let data = src.readSync(start, bytes)
    if (data === null) {
      try {
        data = await src.read(start, bytes)
      } catch {
        data = src.readSync(start, bytes) // died in flight, but maybe resident
      }
      if (abandoned()) {
        return
      }
    }
    if (data === null || data.length < bytes) {
      actionStatus.value = { ok: false, message: 'Selection could not be read. Nothing was copied.' }
      return
    }

    try {
      await writeText(render(data))
    } catch {
      if (!abandoned()) {
        actionStatus.value = { ok: false, message: 'The clipboard could not be written.' }
      }
      return
    }
    if (abandoned()) {
      return
    }
    actionStatus.value = {
      ok: true,
      message: `Copied ${bytes.toLocaleString()} bytes to the clipboard as ${kind}.`,
    }
  }

  /**
   * Copy the Selection as a spaced-hex string (#25) — the byte-exact form.
   * `writeText` is injected so the store stays testable without a real
   * clipboard; the default is the platform one.
   */
  function copySelectionAsHex(
    writeText: (text: string) => Promise<void> = platformWriteText,
  ): Promise<void> {
    return copySelection('hex', toHexString, writeText)
  }

  /**
   * Copy the Selection decoded as UTF-8 text (#30) — the convenience for when
   * what is marked is an embedded string. Same cap, same refusal, same
   * staleness guards as {@link copySelectionAsHex}; only the rendering differs.
   */
  function copySelectionAsText(
    writeText: (text: string) => Promise<void> = platformWriteText,
  ): Promise<void> {
    return copySelection('text', toRawText, writeText)
  }

  /**
   * Copy one Inspector row's currently-displayed value (#54, plan §3.6). The
   * Panel passes the row's terse label (`u32`) and the exact text it is showing
   * — already formatted for `hex` and byte order — so this is a plain clipboard
   * write with no rendering of its own. Confirmation rides the same
   * {@link actionStatus} slot as a Selection copy; there is no new surface.
   * `writeText` is injected for testing, defaulting to the platform clipboard.
   */
  async function copyInspectorValue(
    label: string,
    text: string,
    writeText: (text: string) => Promise<void> = platformWriteText,
  ): Promise<void> {
    try {
      await writeText(text)
    } catch {
      actionStatus.value = { ok: false, message: 'The clipboard could not be written.' }
      return
    }
    actionStatus.value = { ok: true, message: `Copied ${label} value` }
  }

  /**
   * Announce a byte-order flip through the action-status slot (#55, plan §4.3).
   * A plain transient set with no staleness watch of its own — `sticky` so the
   * Selection-move watch does not clear it; it stays until the next action
   * replaces it (plan §4.4).
   */
  function announceByteOrder(order: 'le' | 'be'): void {
    actionStatus.value = {
      ok: true,
      sticky: true,
      message: `Byte order: ${order === 'le' ? 'little-endian' : 'big-endian'}`,
    }
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
    selection,
    actionStatus,
    sourceHealth,
    open,
    scrollTo,
    gotoOffset,
    setBytesPerRow,
    setCursor,
    extendSelectionTo,
    copySelectionAsHex,
    copySelectionAsText,
    copyInspectorValue,
    announceByteOrder,
    setSourceHealth,
  }
})
