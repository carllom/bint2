import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { FIXTURE_PATH } from './support/fixture'

// An axe-core smoke pass over the application chrome — the toolbar, the
// dead-source banner slot, the status bar — with a file open so every control
// is present (issue #31). Deliberately thin: a regression tripwire, not a
// full-page audit.
//
// Scoped to WCAG 2.0 / 2.1 level A and AA failures — not axe's "best-practice"
// heuristics. The only thing the full ruleset flags in the chrome is
// `page-has-heading-one` ("the page should have an <h1>"), and bint2's shell is
// a single-purpose byte tool, not a document (ADR-0005) — it has no headings by
// design. Gating on that heuristic would make this pass permanently red.
//
// THE VIEWPORT IS EXCLUDED BY SELECTOR ON PURPOSE. Per ADR-0005 it is
// `role="application"` wrapping an `aria-hidden` byte grid — reading the grid
// as a document is an explicit non-goal, and the announced Cursor is what
// carries accessibility there. axe cannot know that: it flags the
// application-role container and the aria-hidden scrollable grid on every run,
// forever. Left in, this pass would be red permanently and get muted wholesale,
// which is how these suites die. Excluding the one region keeps it able to
// catch a real regression in the chrome.
const VIEWPORT = '[data-region="viewport"]'

test('the application chrome has no axe-core violations', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('[data-field="file-name"]')).not.toBeEmpty()

  const { violations } = await new AxeBuilder({ page })
    .exclude(VIEWPORT)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  expect(violations).toEqual([])
})
