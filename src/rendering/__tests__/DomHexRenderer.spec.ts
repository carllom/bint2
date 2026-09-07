import { beforeEach, describe, expect, it } from 'vitest'
import type { HexGridView, SelectionView } from '../HexRowRenderer'
import { DomHexRenderer } from '../DomHexRenderer'

function textsOf(root: ParentNode, selector: string): (string | null)[] {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent)
}

/** A grid view with `selection: null` unless overridden. */
function view(
  partial: Omit<HexGridView, 'selection'> & { selection?: SelectionView | null },
): HexGridView {
  return { selection: null, ...partial }
}

describe('DomHexRenderer', () => {
  let container: HTMLElement
  let renderer: DomHexRenderer

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    renderer = new DomHexRenderer(container)
  })

  it('renders address, hex and ascii for a row', () => {
    renderer.render(
      view({
        rows: [{ offset: 0, bytes: Uint8Array.from([0x4d, 0x5a, 0x00, 0x7f]) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )

    const row = container.querySelector('.hex-row')!
    expect(row.querySelector('.hex-row__addr')!.textContent).toBe('00000000')
    expect(textsOf(row, '.hex-row__byte')).toEqual(['4D', '5A', '00', '7F'])
    expect(row.querySelector('.hex-row__ascii')!.textContent).toBe('MZ..')
  })

  it('widens the address gutter to the width it is handed', () => {
    renderer.render(
      view({
        rows: [{ offset: 0x1f40, bytes: new Uint8Array(1) }],
        bytesPerRow: 16,
        addressWidth: 10,
      }),
    )
    expect(container.querySelector('.hex-row__addr')!.textContent).toBe('0000001F40')
  })

  it('iterates the bytes array it is handed, not bytesPerRow', () => {
    // A row longer than bytesPerRow must paint bytes.length columns — the
    // phase-1.5 pin (ADR-0002 amendment). No observable phase-1 effect.
    renderer.render(
      view({
        rows: [{ offset: 0, bytes: new Uint8Array(20) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    expect(container.querySelectorAll('.hex-row__byte')).toHaveLength(20)
  })

  it('paints a pending row dim with ·· placeholders', () => {
    renderer.render(
      view({
        rows: [{ offset: 0, bytes: null }],
        bytesPerRow: 8,
        addressWidth: 8,
      }),
    )

    const row = container.querySelector('.hex-row')!
    expect(row.classList.contains('hex-row--pending')).toBe(true)
    expect(row.querySelectorAll('.hex-row__byte')).toHaveLength(8)
    expect(textsOf(row, '.hex-row__byte').every((text) => text === '··')).toBe(true)
    // A placeholder byte is not addressable — nothing to select there.
    expect(row.querySelector('.hex-row__byte')!.getAttribute('data-offset')).toBeNull()
  })

  it('tags rendered bytes with their absolute offset in both panes', () => {
    renderer.render(
      view({
        rows: [{ offset: 0x30, bytes: new Uint8Array(4) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    expect(textsOf(container, '.hex-row__byte[data-offset]').length).toBe(4)
    expect(container.querySelector('.hex-row__byte')!.getAttribute('data-offset')).toBe('48')
    expect(container.querySelector('.hex-row__char')!.getAttribute('data-offset')).toBe('48')
  })

  it('recycles row elements across renders and hides the surplus', () => {
    renderer.render(
      view({
        rows: [
          { offset: 0, bytes: new Uint8Array(16) },
          { offset: 16, bytes: new Uint8Array(16) },
        ],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    const firstPass = [...container.querySelectorAll('.hex-row')]
    expect(firstPass).toHaveLength(2)

    renderer.render(
      view({
        rows: [{ offset: 0, bytes: new Uint8Array(16) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    const secondPass = [...container.querySelectorAll('.hex-row')]
    expect(secondPass[0]).toBe(firstPass[0]) // same node, reused
    expect((secondPass[1] as HTMLElement).hidden).toBe(true)
  })

  it('reuses the cell spans across renders, rewriting only their content', () => {
    renderer.render(
      view({
        rows: [{ offset: 0, bytes: Uint8Array.from([0x00, 0x01, 0x02]) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    const firstCells = [...container.querySelectorAll('.hex-row__byte')]

    renderer.render(
      view({
        rows: [{ offset: 0, bytes: Uint8Array.from([0xaa, 0xbb, 0xcc]) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    const secondCells = [...container.querySelectorAll('.hex-row__byte')]

    expect(secondCells).toEqual(firstCells) // same nodes, in place
    expect(secondCells.map((c) => c.textContent)).toEqual(['AA', 'BB', 'CC'])
  })

  it('grows and shrinks a row’s cell count as byte counts change', () => {
    renderer.render(
      view({
        rows: [{ offset: 0, bytes: new Uint8Array(16) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    expect(container.querySelectorAll('.hex-row__byte')).toHaveLength(16)

    renderer.render(
      view({
        rows: [{ offset: 0, bytes: new Uint8Array(4) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    expect(container.querySelectorAll('.hex-row__byte')).toHaveLength(4)
  })

  it('marks rows aria-hidden — the grid is not in the a11y tree (ADR-0005)', () => {
    renderer.render(
      view({
        rows: [{ offset: 0, bytes: new Uint8Array(4) }],
        bytesPerRow: 16,
        addressWidth: 8,
      }),
    )
    expect(container.querySelector('.hex-row')!.getAttribute('aria-hidden')).toBe('true')
  })

  describe('painting the one Selection (#22, ADR-0003)', () => {
    const rows = [
      { offset: 0, bytes: new Uint8Array(8) },
      { offset: 8, bytes: new Uint8Array(8) },
    ]

    /** `--selected` byte offsets, read from the hex pane. */
    function selectedOffsets(): number[] {
      return [...container.querySelectorAll<HTMLElement>('.hex-row__byte--selected')].map((c) =>
        Number(c.dataset.offset),
      )
    }

    it('fills the half-open byte range in both panes, never past `end`', () => {
      renderer.render(
        view({
          rows,
          bytesPerRow: 8,
          addressWidth: 8,
          selection: { start: 3, end: 10, cursor: 9 },
        }),
      )
      expect(selectedOffsets()).toEqual([3, 4, 5, 6, 7, 8, 9])
      // The ASCII pane highlights exactly the same bytes — a consequence, not a
      // second computation.
      const asciiSelected = [...container.querySelectorAll<HTMLElement>('.hex-row__char--selected')]
      expect(asciiSelected.map((c) => Number(c.dataset.offset))).toEqual([3, 4, 5, 6, 7, 8, 9])
    })

    it('marks the focus byte as the Cursor in both panes', () => {
      renderer.render(
        view({
          rows,
          bytesPerRow: 8,
          addressWidth: 8,
          selection: { start: 3, end: 10, cursor: 9 },
        }),
      )
      expect(container.querySelectorAll('.hex-row__byte--cursor')).toHaveLength(1)
      expect(container.querySelector('.hex-row__byte--cursor')!.getAttribute('data-offset')).toBe(
        '9',
      )
      expect(container.querySelector('.hex-row__char--cursor')!.getAttribute('data-offset')).toBe(
        '9',
      )
    })

    it('fills nothing for a collapsed Selection but still marks the Cursor byte', () => {
      renderer.render(
        view({
          rows,
          bytesPerRow: 8,
          addressWidth: 8,
          selection: { start: 5, end: 5, cursor: 5 },
        }),
      )
      expect(container.querySelectorAll('.hex-row__byte--selected')).toHaveLength(0)
      expect(container.querySelector('.hex-row__byte--cursor')!.getAttribute('data-offset')).toBe(
        '5',
      )
    })

    it('clears stale marks off recycled cells when the Selection moves', () => {
      renderer.render(
        view({
          rows,
          bytesPerRow: 8,
          addressWidth: 8,
          selection: { start: 1, end: 4, cursor: 3 },
        }),
      )
      expect(selectedOffsets()).toEqual([1, 2, 3])

      renderer.render(
        view({
          rows,
          bytesPerRow: 8,
          addressWidth: 8,
          selection: { start: 11, end: 14, cursor: 13 },
        }),
      )
      expect(selectedOffsets()).toEqual([11, 12, 13])
      expect(container.querySelectorAll('.hex-row__byte--cursor')).toHaveLength(1)
    })

    it('paints no marks at all when there is no Selection', () => {
      renderer.render(view({ rows, bytesPerRow: 8, addressWidth: 8, selection: null }))
      expect(container.querySelectorAll('[class*="--selected"]')).toHaveLength(0)
      expect(container.querySelectorAll('[class*="--cursor"]')).toHaveLength(0)
    })
  })

  describe('byteAtPoint', () => {
    /** Lay each addressable cell out as a 10×10 box, hex pane then ASCII pane. */
    function stubCellBoxes(): void {
      for (const cell of container.querySelectorAll<HTMLElement>('[data-offset]')) {
        const offset = Number(cell.dataset.offset)
        const pane = cell.classList.contains('hex-row__byte') ? 0 : 1
        const left = pane * 1000 + offset * 10
        const top = pane === 0 ? 0 : 0
        cell.getBoundingClientRect = () =>
          ({
            left,
            right: left + 10,
            top,
            bottom: top + 10,
            width: 10,
            height: 10,
            x: left,
            y: top,
            toJSON() {},
          }) as DOMRect
      }
    }

    beforeEach(() => {
      renderer.render(
        view({
          rows: [{ offset: 0x40, bytes: new Uint8Array(4) }],
          bytesPerRow: 16,
          addressWidth: 8,
        }),
      )
      stubCellBoxes()
    })

    it('returns the byte index under a hex-pane point', () => {
      // Cell for offset `o` spans x = o*10 .. o*10+10 in the hex pane.
      expect(renderer.byteAtPoint(0x40 * 10 + 5, 5)).toBe(0x40)
      expect(renderer.byteAtPoint(0x42 * 10 + 5, 5)).toBe(0x42)
    })

    it('returns the same byte index for the matching ASCII-pane point — one byte, two paints', () => {
      expect(renderer.byteAtPoint(1000 + 0x42 * 10 + 5, 5)).toBe(0x42)
    })

    it('returns null when the point is on no rendered byte', () => {
      expect(renderer.byteAtPoint(5, 5)).toBeNull()
      expect(renderer.byteAtPoint(500, 500)).toBeNull()
    })

    it('never returns a sub-byte position — the result is always a whole byte index', () => {
      // Every x across a cell maps to the same integer offset.
      for (let x = 0x40 * 10; x < 0x40 * 10 + 10; x++) {
        expect(renderer.byteAtPoint(x, 5)).toBe(0x40)
      }
    })
  })
})
