import { beforeEach, describe, expect, it } from 'vitest'
import { DomHexRenderer } from '../DomHexRenderer'

function textsOf(root: ParentNode, selector: string): (string | null)[] {
  return [...root.querySelectorAll(selector)].map((node) => node.textContent)
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
    renderer.render({
      rows: [{ offset: 0, bytes: Uint8Array.from([0x4d, 0x5a, 0x00, 0x7f]) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })

    const row = container.querySelector('.hex-row')!
    expect(row.querySelector('.hex-row__addr')!.textContent).toBe('00000000')
    expect(textsOf(row, '.hex-row__byte')).toEqual(['4D', '5A', '00', '7F'])
    expect(row.querySelector('.hex-row__ascii')!.textContent).toBe('MZ..')
  })

  it('widens the address gutter to the width it is handed', () => {
    renderer.render({
      rows: [{ offset: 0x1f40, bytes: new Uint8Array(1) }],
      bytesPerRow: 16,
      addressWidth: 10,
    })
    expect(container.querySelector('.hex-row__addr')!.textContent).toBe('0000001F40')
  })

  it('iterates the bytes array it is handed, not bytesPerRow', () => {
    // A row longer than bytesPerRow must paint bytes.length columns — the
    // phase-1.5 pin (ADR-0002 amendment). No observable phase-1 effect.
    renderer.render({
      rows: [{ offset: 0, bytes: new Uint8Array(20) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    expect(container.querySelectorAll('.hex-row__byte')).toHaveLength(20)
  })

  it('paints a pending row dim with ·· placeholders', () => {
    renderer.render({
      rows: [{ offset: 0, bytes: null }],
      bytesPerRow: 8,
      addressWidth: 8,
    })

    const row = container.querySelector('.hex-row')!
    expect(row.classList.contains('hex-row--pending')).toBe(true)
    expect(row.querySelectorAll('.hex-row__byte')).toHaveLength(8)
    expect(textsOf(row, '.hex-row__byte').every((text) => text === '··')).toBe(true)
    // A placeholder byte is not addressable — nothing to select there.
    expect(row.querySelector('.hex-row__byte')!.getAttribute('data-offset')).toBeNull()
  })

  it('tags rendered bytes with their absolute offset in both panes', () => {
    renderer.render({
      rows: [{ offset: 0x30, bytes: new Uint8Array(4) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    expect(textsOf(container, '.hex-row__byte[data-offset]').length).toBe(4)
    expect(container.querySelector('.hex-row__byte')!.getAttribute('data-offset')).toBe('48')
    expect(container.querySelector('.hex-row__char')!.getAttribute('data-offset')).toBe('48')
  })

  it('recycles row elements across renders and hides the surplus', () => {
    renderer.render({
      rows: [
        { offset: 0, bytes: new Uint8Array(16) },
        { offset: 16, bytes: new Uint8Array(16) },
      ],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    const firstPass = [...container.querySelectorAll('.hex-row')]
    expect(firstPass).toHaveLength(2)

    renderer.render({
      rows: [{ offset: 0, bytes: new Uint8Array(16) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    const secondPass = [...container.querySelectorAll('.hex-row')]
    expect(secondPass[0]).toBe(firstPass[0]) // same node, reused
    expect((secondPass[1] as HTMLElement).hidden).toBe(true)
  })

  it('reuses the cell spans across renders, rewriting only their content', () => {
    renderer.render({
      rows: [{ offset: 0, bytes: Uint8Array.from([0x00, 0x01, 0x02]) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    const firstCells = [...container.querySelectorAll('.hex-row__byte')]

    renderer.render({
      rows: [{ offset: 0, bytes: Uint8Array.from([0xaa, 0xbb, 0xcc]) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    const secondCells = [...container.querySelectorAll('.hex-row__byte')]

    expect(secondCells).toEqual(firstCells) // same nodes, in place
    expect(secondCells.map((c) => c.textContent)).toEqual(['AA', 'BB', 'CC'])
  })

  it('grows and shrinks a row’s cell count as byte counts change', () => {
    renderer.render({
      rows: [{ offset: 0, bytes: new Uint8Array(16) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    expect(container.querySelectorAll('.hex-row__byte')).toHaveLength(16)

    renderer.render({
      rows: [{ offset: 0, bytes: new Uint8Array(4) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    expect(container.querySelectorAll('.hex-row__byte')).toHaveLength(4)
  })

  it('marks rows aria-hidden — the grid is not in the a11y tree (ADR-0005)', () => {
    renderer.render({
      rows: [{ offset: 0, bytes: new Uint8Array(4) }],
      bytesPerRow: 16,
      addressWidth: 8,
    })
    expect(container.querySelector('.hex-row')!.getAttribute('aria-hidden')).toBe('true')
  })
})
