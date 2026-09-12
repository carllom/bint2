import type { Page } from '@playwright/test'

/**
 * `Ctrl+G` to an exact offset — the fine navigation path Goto exists to
 * provide, and the setup step several journeys share to put the Cursor
 * somewhere predictable before the thing under test. `open.spec.ts`'s own
 * Goto test does not use this: it asserts the box takes focus on open, which
 * this helper deliberately skips past.
 */
export async function gotoOffset(page: Page, hex: string): Promise<void> {
  await page.keyboard.press('Control+g')
  await page.locator('#goto-box-input').fill(hex)
  await page.keyboard.press('Enter')
}
