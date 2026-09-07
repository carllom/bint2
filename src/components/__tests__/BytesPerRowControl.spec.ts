import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BytesPerRowControl from '../BytesPerRowControl.vue'
import { useDocumentStore } from '@/stores/document'

let pinia: Pinia

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

function mountControl() {
  return mount(BytesPerRowControl, { global: { plugins: [pinia] } })
}

describe('BytesPerRowControl', () => {
  it('offers 8 / 16 / 24 / 32 as labelled radio controls', () => {
    const control = mountControl()
    const options = control.findAll('input[type=radio]')
    expect(options.map((o) => (o.element as HTMLInputElement).value)).toEqual([
      '8',
      '16',
      '24',
      '32',
    ])
    // Each radio sits inside its own <label> carrying the number.
    expect(control.findAll('label').map((l) => l.text())).toEqual(['8', '16', '24', '32'])
  })

  it('names the group so the controls are not four loose radios', () => {
    expect(mountControl().find('legend').text()).toBe('Bytes per row')
  })

  it('checks 16 by default', () => {
    const checked = mountControl()
      .findAll('input[type=radio]')
      .filter((o) => (o.element as HTMLInputElement).checked)
    expect(checked.map((o) => (o.element as HTMLInputElement).value)).toEqual(['16'])
  })

  it('reshapes the store to the chosen preset', async () => {
    const control = mountControl()
    const store = useDocumentStore(pinia)

    await control.findAll('input[type=radio]')[2]!.trigger('change') // 24
    expect(store.bytesPerRow).toBe(24)
  })

  it('follows the store when the preset changes elsewhere', async () => {
    const control = mountControl()
    const store = useDocumentStore(pinia)

    store.setBytesPerRow(32)
    await control.vm.$nextTick()

    const checked = control
      .findAll('input[type=radio]')
      .filter((o) => (o.element as HTMLInputElement).checked)
    expect(checked.map((o) => (o.element as HTMLInputElement).value)).toEqual(['32'])
  })
})
