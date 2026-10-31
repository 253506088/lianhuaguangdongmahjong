import { test, expect } from '@playwright/test'

for (const [name, width, height] of [['desktop', 1280, 720], ['phone', 915, 412]] as const) {
  test(`flower faces, separate racks and detail view on ${name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const failures: string[] = []
    page.on('response', response => { if (/\/f[1-8]\.svg/.test(response.url()) && !response.ok()) failures.push(response.url()) })
    await page.goto('/tests/e2e/fixtures/flowers.html')
    await expect(page.locator('.mahjong-scene')).toBeVisible()
    await expect(page.locator('.flower-badge')).toHaveCount(4)
    await expect.poll(() => page.evaluate(() => document.querySelector('canvas')?.width ?? 0)).toBeGreaterThan(0)
    // The renderer exposes its frame count only for browser verification.
    await expect.poll(() => page.evaluate(() => (window as any).__tableRenderedFrames?.() ?? 0)).toBeGreaterThan(0)
    // Include the real header: its transparent box used to intercept the far
    // player's badge, which was also partly outside a short landscape screen.
    for (const badge of await page.locator('.flower-badge').all()) {
      const rect = await badge.boundingBox()
      expect(rect).not.toBeNull()
      expect(rect!.y).toBeGreaterThanOrEqual(0)
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(height)
      await badge.click()
      await expect(page.locator('.flower-detail')).toBeVisible()
      await expect(page.locator('.flower-detail figcaption')).toHaveCount(2)
      await page.getByRole('button', { name: '关闭花牌' }).click()
    }
    await page.getByRole('button', { name: '切换牌桌主题' }).click()
    await expect(page.getByRole('menu', { name: '牌桌主题' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: testInfo.outputPath(`flowers-${name}.png`) })
    await page.locator('.user-identity .flower-badge').click()
    await expect(page.getByRole('dialog', { name: '本家的花牌' })).toBeVisible()
    await expect(page.locator('.flower-detail figcaption')).toHaveText(['春', '夏'])
    await page.getByRole('button', { name: '关闭花牌' }).click()
    await page.evaluate(() => (window as any).flowerFixture.reset())
    await expect(page.locator('.flower-badge')).toHaveCount(0)
    await page.evaluate(() => (window as any).flowerFixture.draw(0, 'f8'))
    await expect(page.locator('.user-identity .flower-badge')).toHaveText('花 1')
    await page.goto('/tests/e2e/fixtures/flowers.html?max=1&theme=llmAnime')
    await expect(page.locator('.user-identity .flower-badge')).toHaveText('花 8')
    await page.locator('.user-identity .flower-badge').click()
    await expect(page.locator('.flower-detail figcaption')).toHaveText(['春','夏','秋','冬','梅','兰','竹','菊'])
    await page.screenshot({ path: testInfo.outputPath(`flowers-eight-${name}.png`) })
    expect(failures).toEqual([])
    expect(errors).toEqual([])
  })
}
