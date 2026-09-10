import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import AccordionRoot from '../AccordionRoot.vue'
import AccordionItem from '../AccordionItem.vue'
import AccordionTrigger from '../AccordionTrigger.vue'
import { expectScopedStyleHook, mountAccordion, styleBlockOf } from './helpers'

// M1 wrapper layer (ADR-0009, plan §2, #77): the wrapper forwards props/events
// to `reka-ui` and owns 100% of the visuals off `[data-state]` — no library CSS.

const TWO_ITEMS = [
  { props: { value: 'a' }, label: 'A' },
  { props: { value: 'b' }, label: 'B' },
] as const

describe('AccordionRoot wrapper', () => {
  it('pins type="multiple" so Panels open independently', async () => {
    const wrapper = mountAccordion({ root: { defaultValue: ['a'] }, items: TWO_ITEMS })

    await wrapper.findAll('button.accordion-trigger')[1]!.trigger('click') // open B, leave A open

    expect(wrapper.findAll('.accordion-item').map((i) => i.attributes('data-state'))).toEqual([
      'open',
      'open',
    ])
  })

  it('forwards defaultValue as the initial open set', () => {
    const states = mountAccordion({ root: { defaultValue: ['b'] }, items: TWO_ITEMS })
      .findAll('.accordion-item')
      .map((i) => i.attributes('data-state'))
    expect(states).toEqual(['closed', 'open'])
  })

  it('re-emits update:modelValue with the new open set when a trigger is clicked', async () => {
    const wrapper = mountAccordion({ root: { modelValue: [] }, items: TWO_ITEMS }) // controlled, left unchanged
    await wrapper.findAll('button.accordion-trigger')[0]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([['a']])
  })

  it('relays the open set as a plain string[] (empty when the last Panel closes)', async () => {
    const wrapper = mountAccordion({ root: { defaultValue: ['a'] }, items: TWO_ITEMS })
    await wrapper.findAll('button.accordion-trigger')[0]!.trigger('click') // close A

    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([[]])
  })

  it('forwards disabled to every trigger', () => {
    const wrapper = mountAccordion({ root: { disabled: true }, items: TWO_ITEMS })
    for (const button of wrapper.findAll('button.accordion-trigger')) {
      expect(button.attributes('data-disabled')).toBe('')
      expect(button.attributes('disabled')).toBeDefined()
    }
  })

  it('forwards as so no extra element is added (as-child support)', () => {
    const wrapper = mount(AccordionRoot, {
      props: { as: 'section' },
      slots: {
        default: () => h(AccordionItem, { value: 'x' }, () => h(AccordionTrigger, () => 'x')),
      },
    })
    expect(wrapper.find('.accordion-root').element.tagName).toBe('SECTION')
  })

  it('carries the wrapper’s own scoped styling on the token palette', () => {
    expectScopedStyleHook(mountAccordion().find('.accordion-root'))
    expect(styleBlockOf('AccordionRoot.vue')).toMatch(/var\(--(color-fg|font-mono)\)/)
  })
})
