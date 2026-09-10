import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { h } from 'vue'
import type {
  AccordionContentProps,
  AccordionItemProps,
  AccordionRootProps,
  AccordionTriggerProps,
  SplitterGroupProps,
  SplitterPanelProps,
  SplitterResizeHandleProps,
} from 'reka-ui'
import AccordionRoot from '../AccordionRoot.vue'
import AccordionItem from '../AccordionItem.vue'
import AccordionTrigger from '../AccordionTrigger.vue'
import AccordionContent from '../AccordionContent.vue'
import SplitterGroup from '../SplitterGroup.vue'
import SplitterPanel from '../SplitterPanel.vue'
import SplitterResizeHandle from '../SplitterResizeHandle.vue'

// Shared scaffolding for the shell-wrapper specs (M1, ADR-0009, #77). The
// wrappers are only meaningful inside their Reka context, so every spec builds
// the same little tree with one thing varying — that tree lives here once.

/** Asserts the element carries a `data-v-*` marker, i.e. the wrapper's own
 *  `<style scoped>` reaches it (the styling is ours, not the library's). */
export function expectScopedStyleHook(el: DOMWrapper<Element>): void {
  expect(Object.keys(el.attributes()).some((attr) => attr.startsWith('data-v-'))).toBe(true)
}

/** The text of a wrapper's `<style scoped>` block, for asserting which
 *  `[data-state]` / `[data-orientation]` selectors actually drive a visual. */
export function styleBlockOf(componentFile: string): string {
  const path = join(process.cwd(), 'src/components/shell', componentFile)
  return readFileSync(path, 'utf8').match(/<style scoped>([\s\S]*?)<\/style>/)?.[1] ?? ''
}

interface AccordionOptions {
  root?: Partial<Omit<AccordionRootProps, 'type'>>
  items?: ReadonlyArray<{ props: AccordionItemProps; label?: string }>
  trigger?: AccordionTriggerProps
  content?: AccordionContentProps
}

/** `AccordionRoot > (AccordionItem > AccordionTrigger + AccordionContent)+`.
 *  Defaults to a single item with `value: 'x'`. */
export function mountAccordion(options: AccordionOptions = {}) {
  const items = options.items ?? [{ props: { value: 'x' } }]
  return mount(AccordionRoot, {
    props: options.root ?? {},
    slots: {
      default: () =>
        items.map(({ props, label }) =>
          h(AccordionItem, { ...props, key: props.value }, () => [
            h(AccordionTrigger, options.trigger ?? {}, () => label ?? props.value),
            h(AccordionContent, options.content ?? {}, () => `${label ?? props.value} body`),
          ]),
        ),
    },
  })
}

interface SplitterOptions {
  group?: Omit<SplitterGroupProps, 'autoSaveId' | 'storage'>
  panel?: SplitterPanelProps
  handle?: SplitterResizeHandleProps
}

/** `SplitterGroup > SplitterPanel[data-test=subject] + SplitterResizeHandle + SplitterPanel`.
 *  Defaults to a horizontal group. */
export function mountSplitter(options: SplitterOptions = {}) {
  return mount(SplitterGroup, {
    props: options.group ?? { direction: 'horizontal' },
    slots: {
      default: () => [
        h(SplitterPanel, { ...(options.panel ?? {}), 'data-test': 'subject' }, () => 'left'),
        h(SplitterResizeHandle, options.handle ?? {}),
        h(SplitterPanel, () => 'right'),
      ],
    },
  })
}
