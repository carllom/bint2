import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { FileByteSource } from '@/core'
import { useDocumentStore } from '@/stores/document'
import HomeView from '@/views/HomeView.vue'

// The char column's code page (#56, plan §5), at the app-shell seam: the
// toolbar <select> changing the visible glyphs for a known window, the shared
// "." for windows-1252's holes, CP437 showing ☺ / ╔ where ASCII shows ".", the
// spoken announcement staying ASCII, raw-text copy staying UTF-8, persistence.

let pinia: Pinia
let wrapper: VueWrapper | null = null

function mountApp(): VueWrapper {
  wrapper = mount(HomeView, { attachTo: document.body, global: { plugins: [pinia] } })
  return wrapper
}

function fileOf(bytes: number[], name = 'cp.bin'): File {
  return new File([Uint8Array.from(bytes)], name)
}

async function openBytes(bytes: number[]): Promise<void> {
  useDocumentStore(pinia).open(new FileByteSource(fileOf(bytes)), 'cp.bin')
  await flushPromises()
}

/** The per-byte char-column glyphs of the first row, whitespace preserved. */
function charGlyphs(app: VueWrapper): string[] {
  return app.findAll('.hex-row').at(0)!.findAll('.hex-row__char').map((c) => c.element.textContent!)
}

async function choosePage(app: VueWrapper, value: string): Promise<void> {
  const select = app.find('.code-page-control__select')
  ;(select.element as HTMLSelectElement).value = value
  await select.trigger('change')
  await flushPromises()
}

// 0x03 ♥/control, 0x41 'A', 0x81 windows-1252 hole, 0xC9 box-drawing/É, 0xFF.
const WINDOW = [0x03, 0x41, 0x81, 0xc9, 0xff]

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the code page changes only the visible char column (plan §5)', () => {
  it('defaults to ASCII — control / high bytes are "."', async () => {
    const app = mountApp()
    await openBytes(WINDOW)
    expect(charGlyphs(app)).toEqual(['.', 'A', '.', '.', '.'])
  })

  it('CP437 shows ♥ and ╔ where ASCII shows "."', async () => {
    const app = mountApp()
    await openBytes(WINDOW)
    await choosePage(app, 'cp437')
    expect(charGlyphs(app)).toEqual(['♥', 'A', 'ü', '╔', ' '])
  })

  it('windows-1252 renders the shared "." for an unassigned slot', async () => {
    const app = mountApp()
    await openBytes(WINDOW)
    await choosePage(app, 'windows-1252')
    // 0x81 is a genuine hole -> "."; 0xC9 / 0xFF are Latin-1 glyphs.
    expect(charGlyphs(app)).toEqual(['.', 'A', '.', 'É', 'ÿ'])
  })

  it('leaves the hex column and the offset column untouched', async () => {
    const app = mountApp()
    await openBytes(WINDOW)
    const hexBefore = app.findAll('.hex-row__byte').map((c) => c.text())
    const addrBefore = app.find('.hex-row__addr').text()

    await choosePage(app, 'petscii')

    expect(app.findAll('.hex-row__byte').map((c) => c.text())).toEqual(hexBefore)
    expect(app.find('.hex-row__addr').text()).toBe(addrBefore)
  })

  it('persists across a remount', async () => {
    const app = mountApp()
    await openBytes(WINDOW)
    await choosePage(app, 'cp437')
    app.unmount()

    setActivePinia((pinia = createPinia()))
    const app2 = mountApp()
    await openBytes(WINDOW)
    expect(charGlyphs(app2)[0]).toBe('♥')
    expect((app2.find('.code-page-control__select').element as HTMLSelectElement).value).toBe('cp437')
  })
})

describe('the code page never reaches decode, copy, or speech (plan §5.4)', () => {
  it('the spoken cursor announcement stays ASCII while the visible column changes', async () => {
    const app = mountApp()
    await openBytes(WINDOW)
    await choosePage(app, 'cp437')
    expect(charGlyphs(app)[3]).toBe('╔') // visible column is CP437

    vi.useFakeTimers()
    useDocumentStore(pinia).setCursor(3) // the 0xC9 byte
    await vi.advanceTimersByTimeAsync(200)
    vi.useRealTimers()
    await flushPromises()

    const spoken = app.find('[data-field="cursor-live-region"]').text()
    expect(spoken).toContain('byte C9')
    expect(spoken).toContain("'.'") // toAsciiChar(0xC9), not ╔
    expect(spoken).not.toContain('╔')
  })

  it('raw-text copy stays UTF-8, not the code page', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const app = mountApp()
    // 0xC3 0xA9 is "é" in UTF-8.
    await openBytes([0xc3, 0xa9])
    await choosePage(app, 'cp437')
    const store = useDocumentStore(pinia)
    store.setCursor(0)
    store.extendSelectionTo(1)

    await app.find('.hex-viewer__row-area').trigger('keydown', { key: 'c', ctrlKey: true, altKey: true })
    await flushPromises()

    expect(writeText).toHaveBeenCalledExactlyOnceWith('é')
  })
})
