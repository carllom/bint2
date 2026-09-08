import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ByteOrderControl from '../ByteOrderControl.vue'
import { useDocumentStore } from '@/stores/document'
import { usePreferencesStore } from '@/stores/preferences'

let pinia: Pinia

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

function mountControl() {
  return mount(ByteOrderControl, { global: { plugins: [pinia] } })
}

describe('ByteOrderControl (#55, plan §4.1)', () => {
  it('offers LE / BE as labelled radios, each with a spelled-out aria-label', () => {
    const control = mountControl()
    const radios = control.findAll('input[type=radio]')
    expect(radios.map((r) => (r.element as HTMLInputElement).value)).toEqual(['le', 'be'])
    expect(radios.map((r) => r.attributes('aria-label'))).toEqual(['little-endian', 'big-endian'])
    expect(control.findAll('label').map((l) => l.text())).toEqual(['LE', 'BE'])
  })

  it('names the group', () => {
    expect(mountControl().find('legend').text()).toBe('Byte order')
  })

  it('checks LE by default', () => {
    const checked = mountControl()
      .findAll('input[type=radio]')
      .filter((r) => (r.element as HTMLInputElement).checked)
    expect(checked.map((r) => (r.element as HTMLInputElement).value)).toEqual(['le'])
  })

  it('sets the preference and announces the flip', async () => {
    const control = mountControl()
    const prefs = usePreferencesStore(pinia)
    const store = useDocumentStore(pinia)

    await control.findAll('input[type=radio]')[1]!.trigger('change') // BE

    expect(prefs.byteOrder).toBe('be')
    expect(store.actionStatus).toMatchObject({ ok: true, message: 'Byte order: big-endian' })
  })

  it('follows the preference when it changes elsewhere (the hotkey)', async () => {
    const control = mountControl()
    usePreferencesStore(pinia).setByteOrder('be')
    await control.vm.$nextTick()

    const checked = control
      .findAll('input[type=radio]')
      .filter((r) => (r.element as HTMLInputElement).checked)
    expect(checked.map((r) => (r.element as HTMLInputElement).value)).toEqual(['be'])
  })

  it('does not re-announce when the current order is re-selected', async () => {
    const control = mountControl()
    const store = useDocumentStore(pinia)
    await control.findAll('input[type=radio]')[0]!.trigger('change') // LE, already LE
    expect(store.actionStatus).toBeNull()
  })
})
