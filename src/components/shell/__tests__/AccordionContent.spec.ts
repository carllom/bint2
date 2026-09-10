import { describe, expect, it } from 'vitest'
import { AccordionContent as RekaAccordionContent } from 'reka-ui'
import { mountAccordion, styleBlockOf } from './helpers'

// M1 wrapper layer (ADR-0009, plan §3.1, #77).

describe('AccordionContent wrapper', () => {
  it('renders an accessible region wired to its trigger', () => {
    const wrapper = mountAccordion({ root: { defaultValue: ['x'] } })
    const region = wrapper.find('.accordion-content')
    expect(region.attributes('role')).toBe('region')
    expect(region.attributes('aria-labelledby')).toBe(
      wrapper.find('button.accordion-trigger').attributes('id'),
    )
  })

  it('puts the slot in an inner box so padding stays out of the collapse measurement', () => {
    const inner = mountAccordion({ root: { defaultValue: ['x'] } }).find(
      '.accordion-content .accordion-content__inner',
    )
    expect(inner.exists()).toBe(true)
    expect(inner.text()).toBe('x body')
  })

  it('drives the [data-state] styling hook once the Panel has toggled', async () => {
    const wrapper = mountAccordion({ root: { defaultValue: [] } })
    const trigger = wrapper.find('button.accordion-trigger')

    await trigger.trigger('click') // closed -> open
    expect(wrapper.find('.accordion-content').attributes('data-state')).toBe('open')

    await trigger.trigger('click') // open -> closed
    expect(wrapper.find('.accordion-content').attributes('data-state')).toBe('closed')
  })

  it('keys the enter animation off [data-state="open"] and the exposed height var', () => {
    const style = styleBlockOf('AccordionContent.vue')
    expect(style).toMatch(/\.accordion-content\[data-state='open'\]\s*\{\s*animation:/)
    expect(style).toMatch(/var\(--reka-accordion-content-height\)/)
    // no dead [data-state='closed'] rule — Reka unmounts a closed region
    expect(style).not.toMatch(/\[data-state='closed'\]/)
  })

  it('exposes --reka-accordion-content-height on the region for that animation', () => {
    const style =
      mountAccordion({ root: { defaultValue: ['x'] } }).find('.accordion-content').attributes('style') ?? ''
    expect(style).toContain('--reka-accordion-content-height')
  })

  it('forwards force-mount / as-child to Reka', () => {
    expect(
      mountAccordion({ root: { defaultValue: [] }, content: { forceMount: true } })
        .findComponent(RekaAccordionContent)
        .props('forceMount'),
    ).toBe(true)
  })
})
