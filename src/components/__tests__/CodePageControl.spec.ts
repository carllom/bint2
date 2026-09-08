import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CodePageControl from '../CodePageControl.vue'
import { usePreferencesStore } from '@/stores/preferences'

let pinia: Pinia

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

function mountControl() {
  return mount(CodePageControl, { global: { plugins: [pinia] } })
}

describe('CodePageControl (#56, plan §5.3)', () => {
  it('is a labelled select offering the six pages in order, ASCII first', () => {
    const control = mountControl()
    expect(control.find('label').text()).toContain('Code page')
    const options = control.findAll('option')
    expect(options.map((o) => (o.element as HTMLOptionElement).value)).toEqual([
      'ascii',
      'cp437',
      'windows-1252',
      'petscii',
      'petscii-lower',
      'akai',
    ])
    expect(options[0]!.text()).toBe('ASCII')
    expect(options[1]!.text()).toBe('CP437 (DOS)')
  })

  it('shows ASCII selected by default', () => {
    expect((mountControl().find('select').element as HTMLSelectElement).value).toBe('ascii')
  })

  it('sets the preference on change', async () => {
    const control = mountControl()
    const select = control.find('select')
    ;(select.element as HTMLSelectElement).value = 'cp437'
    await select.trigger('change')
    expect(usePreferencesStore(pinia).codePage).toBe('cp437')
  })

  it('follows the preference when it changes elsewhere', async () => {
    const control = mountControl()
    usePreferencesStore(pinia).setCodePage('petscii')
    await control.vm.$nextTick()
    expect((control.find('select').element as HTMLSelectElement).value).toBe('petscii')
  })
})
