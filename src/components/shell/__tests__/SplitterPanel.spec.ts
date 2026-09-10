import { describe, expect, it } from 'vitest'
import { SplitterPanel as RekaSplitterPanel } from 'reka-ui'
import SplitterPanel from '../SplitterPanel.vue'
import { expectScopedStyleHook, mountSplitter } from './helpers'

// M1 wrapper layer (ADR-0009, plan §3.2, #77). The panel wrapper is nested in a
// group, so assertions target the wrapper instance found inside the mount.

describe('SplitterPanel wrapper', () => {
  it('forwards collapsible so Reka emits the [data-state] hook', () => {
    // `collapsible` → Reka stamps collapsed|expanded (the exact value depends on
    // measured width, which is 0 in the test DOM); without it, no attribute.
    expect(['collapsed', 'expanded']).toContain(
      mountSplitter({ panel: { collapsible: true } }).find('[data-test="subject"]').attributes('data-state'),
    )
    expect(mountSplitter().find('[data-test="subject"]').attributes('data-state')).toBeUndefined()
  })

  it('forwards the sizing props to Reka', () => {
    const reka = mountSplitter({
      panel: { minSize: 25, defaultSize: 40, sizeUnit: 'px', collapsedSize: 0 },
    })
      .findComponent(SplitterPanel)
      .findComponent(RekaSplitterPanel)
    expect(reka.props('minSize')).toBe(25)
    expect(reka.props('defaultSize')).toBe(40)
    expect(reka.props('sizeUnit')).toBe('px')
    expect(reka.props('collapsedSize')).toBe(0)
  })

  it('re-emits resize / collapse / expand from the inner primitive', () => {
    const panelWrapper = mountSplitter({ panel: { collapsible: true } }).findComponent(SplitterPanel)
    const reka = panelWrapper.findComponent(RekaSplitterPanel)

    reka.vm.$emit('resize', 33.3, 50)
    reka.vm.$emit('collapse')
    reka.vm.$emit('expand')

    expect(panelWrapper.emitted('resize')![0]).toEqual([33.3, 50])
    expect(panelWrapper.emitted('collapse')).toHaveLength(1)
    expect(panelWrapper.emitted('expand')).toHaveLength(1)
  })

  it('carries the wrapper’s own scoped styling', () => {
    const el = mountSplitter().find('[data-test="subject"]')
    expect(el.classes()).toContain('splitter-panel')
    expectScopedStyleHook(el)
  })
})
