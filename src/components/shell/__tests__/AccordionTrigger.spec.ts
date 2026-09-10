import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import AccordionRoot from '../AccordionRoot.vue'
import AccordionItem from '../AccordionItem.vue'
import AccordionTrigger from '../AccordionTrigger.vue'
import AccordionContent from '../AccordionContent.vue'
import { mountAccordion, styleBlockOf } from './helpers'

// M1 wrapper layer (ADR-0009, plan §3.1 / §3.5, #77).

describe('AccordionTrigger wrapper', () => {
  it('folds the APG heading in (default h3), wrapping a real <button>', () => {
    const heading = mountAccordion().find('h3.accordion-trigger__header')
    expect(heading.exists()).toBe(true)
    const button = heading.find('button.accordion-trigger')
    expect(button.exists()).toBe(true)
    expect(button.attributes('type')).toBe('button')
  })

  it('keeps the trigger a pure toggle — the label is the only slotted content', () => {
    const button = mountAccordion({ items: [{ props: { value: 'x' }, label: 'Panel title' }] }).find(
      'button.accordion-trigger',
    )
    expect(button.text()).toBe('Panel title')
  })

  it('carries the [data-state] hook and keys the chevron off it in CSS', async () => {
    const button = mountAccordion({ root: { defaultValue: [] } }).find('button.accordion-trigger')

    expect(button.attributes('data-state')).toBe('closed')
    await button.trigger('click')
    expect(button.attributes('data-state')).toBe('open')

    expect(styleBlockOf('AccordionTrigger.vue')).toMatch(
      /\.accordion-trigger\[data-state='open'\]::before\s*\{\s*transform: rotate/,
    )
  })

  it('clicking the trigger re-emits update:modelValue through the root', async () => {
    const wrapper = mountAccordion({ root: { modelValue: [] } })
    await wrapper.find('button.accordion-trigger').trigger('click')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([['x']])
  })

  it('forwards as-child onto the caller’s own control', () => {
    const wrapper = mount(AccordionRoot, {
      props: { defaultValue: [] },
      slots: {
        default: () =>
          h(AccordionItem, { value: 'x' }, () => [
            h(AccordionTrigger, { asChild: true }, () => h('button', { class: 'custom-trigger' }, 'T')),
            h(AccordionContent, () => 'body'),
          ]),
      },
    })
    const buttons = wrapper.findAll('button.accordion-trigger')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.classes()).toContain('custom-trigger')
  })
})
