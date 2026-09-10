import { describe, expect, it } from 'vitest'
import { SplitterGroup as RekaSplitterGroup } from 'reka-ui'
import { expectScopedStyleHook, mountSplitter, styleBlockOf } from './helpers'

// M1 wrapper layer (ADR-0009, plan §3.2, #77).

describe('SplitterGroup wrapper', () => {
  it('forwards direction as the [data-orientation] styling hook', () => {
    expect(mountSplitter({ group: { direction: 'horizontal' } }).find('.splitter-group').attributes('data-orientation')).toBe(
      'horizontal',
    )
    expect(mountSplitter({ group: { direction: 'vertical' } }).find('.splitter-group').attributes('data-orientation')).toBe(
      'vertical',
    )
  })

  it('keys the stacked layout off [data-orientation="vertical"] in CSS', () => {
    expect(styleBlockOf('SplitterGroup.vue')).toMatch(
      /\.splitter-group\[data-orientation='vertical'\]\s*\{\s*flex-direction: column/,
    )
  })

  it('re-emits layout with the panel sizes', () => {
    const wrapper = mountSplitter()
    wrapper.findComponent(RekaSplitterGroup).vm.$emit('layout', [40, 60])
    expect(wrapper.emitted('layout')![0]).toEqual([[40, 60]])
  })

  it('does not declare auto-save-id / storage (ADR-0009 §5 — persistence stays in the store)', () => {
    const declared = Object.keys(mountSplitter().vm.$props)
    expect(declared).toContain('direction')
    expect(declared).not.toContain('autoSaveId')
    expect(declared).not.toContain('storage')
  })

  it('carries the wrapper’s own scoped styling', () => {
    expectScopedStyleHook(mountSplitter().find('.splitter-group'))
  })
})
