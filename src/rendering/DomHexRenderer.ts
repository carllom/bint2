import { charFor, toAddress, toHex } from '@/core'
import type { HexGridView, HexRowRenderer, HexRowView } from './HexRowRenderer'

interface PooledRow {
  readonly el: HTMLElement
  readonly addr: HTMLElement
  readonly hex: HTMLElement
  readonly ascii: HTMLElement
}

const PENDING_HEX = '··' // ··
const PENDING_CHAR = '·' // ·

/**
 * Recycled-DOM-row renderer (plan §4). A pool of row elements is grown to fit
 * and reused across renders; the cell `<span>`s inside a row are likewise reused
 * and only their text / `data-offset` rewritten. Nodes are created only when the
 * pool or a row's column count grows, and never destroyed on a repaint.
 *
 * It **iterates the `bytes` array it is handed** and never assumes
 * `bytes.length === bytesPerRow` — pinned by a test, with no observable phase-1
 * effect, so phase 1.5's wider values survive it.
 */
export class DomHexRenderer implements HexRowRenderer {
  readonly #container: HTMLElement
  readonly #pool: PooledRow[] = []

  constructor(container: HTMLElement) {
    this.#container = container
  }

  render(view: HexGridView): void {
    while (this.#pool.length < view.rows.length) {
      this.#pool.push(this.#createRow())
    }
    this.#pool.forEach((row, index) => {
      const data = view.rows[index]
      if (data === undefined) {
        row.el.hidden = true
        return
      }
      row.el.hidden = false
      this.#paintRow(row, data, view)
    })
  }

  byteAtPoint(x: number, y: number): number | null {
    for (const row of this.#pool) {
      if (row.el.hidden) {
        continue
      }
      for (const cell of row.el.querySelectorAll<HTMLElement>('[data-offset]')) {
        const rect = cell.getBoundingClientRect()
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return Number(cell.dataset.offset)
        }
      }
    }
    return null
  }

  #createRow(): PooledRow {
    const el = document.createElement('div')
    el.className = 'hex-row'
    el.setAttribute('aria-hidden', 'true') // ADR-0005: the grid is not a document

    const addr = document.createElement('span')
    addr.className = 'hex-row__addr'
    const hex = document.createElement('span')
    hex.className = 'hex-row__hex'
    const ascii = document.createElement('span')
    ascii.className = 'hex-row__ascii'

    el.append(addr, hex, ascii)
    this.#container.append(el)
    return { el, addr, hex, ascii }
  }

  #paintRow(row: PooledRow, data: HexRowView, view: HexGridView): void {
    row.addr.textContent = toAddress(data.offset, view.addressWidth)

    const { bytes } = data
    const pending = bytes === null
    row.el.classList.toggle('hex-row--pending', pending)

    // A pending row shows `bytesPerRow` placeholders; a loaded row shows exactly
    // as many columns as it was handed bytes — not `bytesPerRow`.
    const columns = pending ? view.bytesPerRow : bytes.length
    const hexCells = fitCells(row.hex, 'hex-row__byte', columns)
    const asciiCells = fitCells(row.ascii, 'hex-row__char', columns)
    const sel = view.selection
    const { hoveredByte } = view

    for (let column = 0; column < columns; column++) {
      const hexCell = hexCells[column]!
      const asciiCell = asciiCells[column]!
      if (pending) {
        hexCell.textContent = PENDING_HEX
        asciiCell.textContent = PENDING_CHAR
        hexCell.removeAttribute('data-offset')
        asciiCell.removeAttribute('data-offset')
        // A placeholder byte carries no offset — nothing to select, hover or point at.
        markCell(hexCell, 'hex-row__byte', false, false, false)
        markCell(asciiCell, 'hex-row__char', false, false, false)
      } else {
        const absOffset = data.offset + column
        const byte = bytes[column]!
        hexCell.textContent = toHex(byte, 2)
        asciiCell.textContent = charFor(byte, view.codePage)
        const offset = String(absOffset)
        hexCell.dataset.offset = offset
        asciiCell.dataset.offset = offset
        // Both panes paint from the same byte range, never from pixel geometry —
        // the linked hex↔ASCII highlight is a consequence (ADR-0003). An empty
        // range (`start === end`) is the Cursor, so nothing fills.
        const selected = sel !== null && absOffset >= sel.start && absOffset < sel.end
        const isCursor = sel !== null && absOffset === sel.cursor
        // Same offset-driven path as the Selection; both panes marking the same
        // byte is again a consequence, not a second computation (#30).
        const isHovered = hoveredByte !== null && absOffset === hoveredByte
        markCell(hexCell, 'hex-row__byte', selected, isCursor, isHovered)
        markCell(asciiCell, 'hex-row__char', selected, isCursor, isHovered)
      }
    }
  }
}

/** Toggle the `--selected` / `--cursor` / `--hovered` modifiers on a recycled cell. */
function markCell(
  cell: HTMLElement,
  base: string,
  selected: boolean,
  cursor: boolean,
  hovered: boolean,
): void {
  cell.classList.toggle(`${base}--selected`, selected)
  cell.classList.toggle(`${base}--cursor`, cursor)
  cell.classList.toggle(`${base}--hovered`, hovered)
}

/** Grow or shrink `parent`'s `<span>` children to `count`, then return them. */
function fitCells(parent: HTMLElement, className: string, count: number): HTMLElement[] {
  while (parent.childElementCount < count) {
    const span = document.createElement('span')
    span.className = className
    parent.append(span)
  }
  while (parent.childElementCount > count) {
    parent.lastElementChild!.remove()
  }
  return Array.from(parent.children) as HTMLElement[]
}
