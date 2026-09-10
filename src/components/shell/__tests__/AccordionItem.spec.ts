import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'
import { AccordionItem as RekaAccordionItem } from 'reka-ui'
import AccordionRoot from '../AccordionRoot.vue'
import AccordionItem from '../AccordionItem.vue'
import AccordionTrigger from '../AccordionTrigger.vue'
import AccordionContent from '../AccordionContent.vue'
import { expectScopedStyleHook, mountAccordion, styleBlockOf } from './helpers'

// M1 wrapper layer (ADR-0009, plan §3.1, #77).

describe('AccordionItem wrapper', () => {
  it('forwards value — the item reflects the accordion model', () => {
    expect(
      mountAccordion({ root: { defaultValue: [] }, items: [{ props: { value: 'x' } }] })
        .find('.accordion-item')
        .attributes('data-state'),
    ).toBe('closed')
    expect(
      mountAccordion({ root: { defaultValue: ['x'] }, items: [{ props: { value: 'x' } }] })
        .find('.accordion-item')
        .attributes('data-state'),
    ).toBe('open')
  })

  it('drives the [data-state] styling hook open/closed', async () => {
    const wrapper = mountAccordion({ root: { defaultValue: [] } })
    const item = wrapper.find('.accordion-item')

    expect(item.attributes('data-state')).toBe('closed')
    await wrapper.find('button.accordion-trigger').trigger('click')
    expect(item.attributes('data-state')).toBe('open')
  })

  it('forwards disabled as the [data-disabled] hook, and dims off it in CSS', () => {
    const wrapper = mountAccordion({
      root: { defaultValue: [] },
      items: [{ props: { value: 'x', disabled: true } }],
    })
    expect(wrapper.find('.accordion-item').attributes('data-disabled')).toBe('')
    expect(wrapper.findComponent(RekaAccordionItem).props('disabled')).toBe(true)
    expect(styleBlockOf('AccordionItem.vue')).toMatch(
      /\.accordion-item\[data-disabled\][\s\S]*var\(--color-fg-dim\)/,
    )
  })

  it('forwards unmount-on-hide to Reka', () => {
    expect(
      mountAccordion({ root: { defaultValue: [] }, items: [{ props: { value: 'x', unmountOnHide: true } }] })
        .findComponent(RekaAccordionItem)
        .props('unmountOnHide'),
    ).toBe(true)
    expect(
      mountAccordion({ root: { defaultValue: [] }, items: [{ props: { value: 'x', unmountOnHide: false } }] })
        .findComponent(RekaAccordionItem)
        .props('unmountOnHide'),
    ).toBe(false)
  })

  it('forwards as-child so no wrapper element is added', () => {
    const wrapper = mount(AccordionRoot, {
      props: { defaultValue: ['x'] },
      slots: {
        default: () =>
          h(AccordionItem, { value: 'x', asChild: true }, () =>
            h('article', [h(AccordionTrigger, () => 'label'), h(AccordionContent, () => 'body')]),
          ),
      },
    })
    const article = wrapper.find('article')
    expect(article.exists()).toBe(true)
    expect(article.attributes('data-state')).toBe('open')
    expect(article.classes()).toContain('accordion-item')
    expect(wrapper.findAll('div.accordion-item')).toHaveLength(0)
  })

  it('carries the wrapper’s own scoped styling', () => {
    expectScopedStyleHook(mountAccordion().find('.accordion-item'))
  })
})
