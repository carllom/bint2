import { describe, expect, it } from 'vitest'
import {
  APPROX_CH_PX,
  DEFAULT_SIDEBAR_WIDTH,
  gridMinCh,
  gridMinPx,
  SIDEBAR_MIN_PX,
  sidebarMaxSize,
} from '../sidebarLayout'

// The pure layout arithmetic behind the shell splitter (plan-phase1.75.md §3.2,
// ADR-0010): the hex grid's dynamic minimum width tracks `bytesPerRow`, and the
// Sidebar's `max-size` is "container width − that minimum", never below the
// Sidebar's own 200 px floor.

describe('gridMinCh — the grid minimum in `ch`, tracking bytesPerRow', () => {
  it('is the phase-1.5 141ch figure at 32 bytes per row', () => {
    // offset gutter (8) + two row gaps (4) + hex column (3·bpr − 1) + char
    // column (bpr) + grid padding (2) — the old Inspector `141ch` math.
    expect(gridMinCh(32)).toBe(141)
  })

  it('scales linearly with the row width (4ch per byte)', () => {
    expect(gridMinCh(8)).toBe(45)
    expect(gridMinCh(16)).toBe(77)
    expect(gridMinCh(24)).toBe(109)
    expect(gridMinCh(16) - gridMinCh(8)).toBe(32)
  })
})

describe('gridMinPx — the same minimum in CSS px', () => {
  it('converts `ch` at the shell monospace metric and rounds up', () => {
    expect(gridMinPx(32)).toBe(Math.ceil(141 * APPROX_CH_PX))
    expect(gridMinPx(16)).toBe(Math.ceil(77 * APPROX_CH_PX))
  })

  it('rises with the row width', () => {
    expect(gridMinPx(32)).toBeGreaterThan(gridMinPx(8))
  })
})

describe('sidebarMaxSize — container width − grid minimum, floored at 200', () => {
  it('leaves the grid its minimum when there is room', () => {
    const containerWidth = 2000
    expect(sidebarMaxSize(containerWidth, 16)).toBe(containerWidth - gridMinPx(16))
  })

  it('never drops below the Sidebar 200 px floor when the window is narrow', () => {
    expect(sidebarMaxSize(300, 32)).toBe(SIDEBAR_MIN_PX)
    expect(sidebarMaxSize(0, 16)).toBe(SIDEBAR_MIN_PX)
  })

  it('exposes the default reset width', () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(320)
  })
})
