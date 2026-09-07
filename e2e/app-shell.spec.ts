import { expect, test } from '@playwright/test'

test('renders the empty monospace app shell', async ({ page }) => {
  await page.goto('/')

  for (const region of ['toolbar', 'banner', 'viewport', 'status-bar']) {
    await expect(page.locator(`[data-region="${region}"]`)).toBeAttached()
  }

  const fontFamily = await page
    .locator('.app-shell')
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(fontFamily).toMatch(/mono/i)
})

test('nothing is borrowed from the Vue template', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('You did it!')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'About' })).toHaveCount(0)
  await expect(page.locator('img[alt="Vue logo"]')).toHaveCount(0)
})
