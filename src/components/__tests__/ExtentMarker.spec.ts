import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { ViewportMetrics } from '@/core'
import ExtentMarker from '@/components/ExtentMarker.vue'

// The passive gutter overlay for a locked Bitmap's Extent (plan-phase1.75 §4.8,
// ADR-0011). Pure geometry off `topByteOffset` + the measured row height — no
// store, no renderer. Mounted directly with props; the "shown only while locked
// AND the Panel is mounted", pointer-events pass-through and chevron→scroll
// wiring are asserted at the app-shell seam in `BitmapPanel.spec.ts`.

const BPR = 16
const ROW_PX = 18
const VIEWPORT_PX = 720 // 40 whole rows fit

function metricsWith(over: Partial<ViewportMetrics> = {}): ViewportMetrics {
  return {
    size: 1_000_000,
    bytesPerRow: BPR,
    viewportPx: VIEWPORT_PX,
    rowPx: ROW_PX,
    trackPx: VIEWPORT_PX,
    minThumbPx: 24,
    ...over,
  }
}

function mountMarker(
  props: {
    range?: { start: number; end: number } | null
    topByteOffset?: number
    metrics?: ViewportMetrics
  } = {},
): VueWrapper {
  return mount(ExtentMarker, {
    props: {
      range: { start: 0, end: 256 },
      topByteOffset: 0,
      metrics: metricsWith(),
      ...props,
    },
  })
}

const band = (w: VueWrapper) => w.find('[data-field="extent-band"]')
const chevron = (w: VueWrapper) => w.find('[data-field="extent-chevron"]')

describe('ExtentMarker — nothing to draw', () => {
  it('renders nothing when there is no locked Extent', () => {
    expect(mountMarker({ range: null }).find('.extent-marker').exists()).toBe(false)
  })

  it('renders nothing before the row height is measured', () => {
    expect(
      mountMarker({ metrics: metricsWith({ rowPx: 0 }) }).find('.extent-marker').exists(),
    ).toBe(false)
  })
})

describe('ExtentMarker — the band, positioned from topByteOffset + row height', () => {
  it('spans the first to the last covered row, both ends capped', () => {
    // range [0, 256): rows 0..15 (byte 255 is the last covered).
    const w = mountMarker({ range: { start: 0, end: 256 }, topByteOffset: 0 })
    expect(band(w).exists()).toBe(true)
    expect(chevron(w).exists()).toBe(false)
    expect(band(w).attributes('style')).toContain('top: 0px')
    expect(band(w).attributes('style')).toContain(`height: ${16 * ROW_PX}px`)
    expect(band(w).classes()).toContain('extent-marker__band--cap-top')
    expect(band(w).classes()).toContain('extent-marker__band--cap-bottom')
  })

  it('offsets the band by the scrolled rows', () => {
    // topByteOffset row 3; Extent rows 5..8 → 2 rows down, 4 rows tall.
    const w = mountMarker({ range: { start: 5 * BPR, end: 9 * BPR }, topByteOffset: 3 * BPR })
    expect(band(w).attributes('style')).toContain(`top: ${2 * ROW_PX}px`)
    expect(band(w).attributes('style')).toContain(`height: ${4 * ROW_PX}px`)
  })

  it('clips at the viewport top and drops that cap when the first row is scrolled above', () => {
    // Extent rows 5..19, viewport starts at row 10.
    const w = mountMarker({ range: { start: 5 * BPR, end: 20 * BPR }, topByteOffset: 10 * BPR })
    expect(band(w).attributes('style')).toContain('top: 0px')
    expect(band(w).attributes('style')).toContain(`height: ${10 * ROW_PX}px`) // rows 10..19
    expect(band(w).classes()).not.toContain('extent-marker__band--cap-top')
    expect(band(w).classes()).toContain('extent-marker__band--cap-bottom')
  })

  it('fills the whole gutter with no caps when the Extent spans past both edges', () => {
    const w = mountMarker({
      range: { start: 2 * BPR, end: 200 * BPR },
      topByteOffset: 20 * BPR,
    })
    expect(chevron(w).exists()).toBe(false)
    expect(band(w).attributes('style')).toContain('top: 0px')
    expect(band(w).attributes('style')).toContain(`height: ${VIEWPORT_PX}px`)
    expect(band(w).classes()).not.toContain('extent-marker__band--cap-top')
    expect(band(w).classes()).not.toContain('extent-marker__band--cap-bottom')
  })
})

describe('ExtentMarker — the off-screen chevron', () => {
  it('points up and emits reveal when the Extent is entirely above the viewport', async () => {
    const w = mountMarker({ range: { start: 0, end: 64 }, topByteOffset: 100 * BPR })
    expect(band(w).exists()).toBe(false)
    expect(chevron(w).text()).toBe('▲')
    expect(chevron(w).classes()).toContain('extent-marker__chevron--up')

    await chevron(w).trigger('click')
    expect(w.emitted('reveal')).toHaveLength(1)
  })

  it('points down only once the Extent clears the partial sliver row the grid paints', () => {
    // 40 whole rows fit; the grid paints one more partial row (row 40). An Extent
    // starting on that sliver is still "on screen" — no chevron.
    const sliver = mountMarker({ range: { start: 40 * BPR, end: 41 * BPR }, topByteOffset: 0 })
    expect(chevron(sliver).exists()).toBe(false)

    // Row 41 is genuinely below the fold → the down chevron.
    const below = mountMarker({ range: { start: 41 * BPR, end: 41 * BPR + 16 }, topByteOffset: 0 })
    expect(chevron(below).text()).toBe('▼')
    expect(chevron(below).classes()).toContain('extent-marker__chevron--down')
  })

  it('shows no chevron while any whole row of the Extent is on screen', () => {
    const w = mountMarker({ range: { start: 39 * BPR, end: 40 * BPR }, topByteOffset: 0 })
    expect(chevron(w).exists()).toBe(false)
    expect(band(w).exists()).toBe(true)
  })
})

describe('ExtentMarker — decorative (ADR-0005)', () => {
  it('is aria-hidden with no live region, and the chevron is not a tab stop', () => {
    const w = mountMarker({ range: { start: 0, end: 64 }, topByteOffset: 100 * BPR })
    expect(w.find('.extent-marker').attributes('aria-hidden')).toBe('true')
    expect(w.find('[aria-live]').exists()).toBe(false)
    expect(chevron(w).attributes('tabindex')).toBe('-1')
  })
})
