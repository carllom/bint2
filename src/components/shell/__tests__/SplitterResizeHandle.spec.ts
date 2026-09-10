import { describe, expect, it } from 'vitest'
import { SplitterResizeHandle as RekaSplitterResizeHandle } from 'reka-ui'
import SplitterResizeHandle from '../SplitterResizeHandle.vue'
import { expectScopedStyleHook, mountSplitter, styleBlockOf } from './helpers'

// M1 wrapper layer (ADR-0009, plan §3.2, #77).

describe('SplitterResizeHandle wrapper', () => {
  it('renders an APG separator, focusable, starting inactive', () => {
    const el = mountSplitter().find('.splitter-resize-handle')
    expect(el.attributes('role')).toBe('separator')
    expect(el.attributes('tabindex')).toBe('0')
    // the [data-state] styling hook: inactive | hover | drag
    expect(el.attributes('data-state')).toBe('inactive')
  })

  it('inherits [data-orientation] from the group for its cursor / hit-area rules', () => {
    expect(
      mountSplitter({ group: { direction: 'horizontal' } }).find('.splitter-resize-handle').attributes('data-orientation'),
    ).toBe('horizontal')
    expect(
      mountSplitter({ group: { direction: 'vertical' } }).find('.splitter-resize-handle').attributes('data-orientation'),
    ).toBe('vertical')
  })

  it('keys the divider highlight off [data-state] and the cursor off [data-orientation] in CSS', () => {
    const style = styleBlockOf('SplitterResizeHandle.vue')
    expect(style).toMatch(/\[data-state='drag'\]/)
    expect(style).toMatch(/\[data-state='hover'\]/)
    expect(style).toMatch(/\[data-orientation='horizontal'\][\s\S]*cursor: col-resize/)
    expect(style).toMatch(/var\(--color-(border|cursor)\)/)
  })

  it('re-emits dragging from the inner primitive', () => {
    const handleWrapper = mountSplitter().findComponent(SplitterResizeHandle)
    const reka = handleWrapper.findComponent(RekaSplitterResizeHandle)

    reka.vm.$emit('dragging', true)
    reka.vm.$emit('dragging', false)

    expect(handleWrapper.emitted('dragging')).toEqual([[true], [false]])
  })

  it('carries the wrapper’s own scoped styling', () => {
    const el = mountSplitter().find('.splitter-resize-handle')
    expect(el.classes()).toContain('splitter-resize-handle')
    expectScopedStyleHook(el)
  })
})
