import { expect, test } from '@playwright/test'

const themes = ['jade', 'happyMahjong', 'rosewood', 'llm', 'llmAnime']
const screens = [
  { name: 'desktop', width: 1920, height: 1080, touch: false },
  { name: 'phone', width: 915, height: 412, touch: true },
  { name: 'small-phone', width: 568, height: 320, touch: true },
]

for (const theme of themes) for (const screen of screens) {
  test(`gang head leaves west minglou visible: ${theme} ${screen.name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: `http://127.0.0.1:${process.env.E2E_PORT || 4173}`,
      viewport: { width: screen.width, height: screen.height },
      hasTouch: screen.touch, isMobile: screen.touch,
    })
    try {
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`/tests/e2e/fixtures/flowers.html?theme=${theme}&ganghead=1&minglou=1&cameraLab=1`)
      const indicator = page.getByRole('region', { name: '公开杠头牌' })
      await expect(indicator).toContainText('五万')
      await expect.poll(() => page.locator('canvas.mahjong-scene').evaluate(canvas =>
        JSON.parse((canvas as HTMLElement).dataset.handFaceRects || '[]').length,
      )).toBe(13)
      const metrics = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON()
        const canvas = document.querySelector<HTMLCanvasElement>('canvas.mahjong-scene')!
        const rect = canvas.getBoundingClientRect()
        const hands = JSON.parse(canvas.dataset.handFaceRects || '[]').filter((p: any) => p.seat === 2)
          .map((p: any) => ({ left: rect.left + p.left * rect.width, right: rect.left + p.right * rect.width,
            top: rect.top + p.top * rect.height, bottom: rect.top + p.bottom * rect.height }))
        return { indicator: box('.gang-head-indicator'), hands,
          obstacles: ['.base-score-badge', '.round-info', '.seat-left .avatar-wrap', '.seat-left .flower-badge', '.seat-top .avatar-wrap', '.top-bar nav']
            .map(selector => ({ selector, box: box(selector) })) }
      })
      const chip = metrics.indicator
      const overlaps = (b: { left: number; right: number; top: number; bottom: number }) =>
        Math.min(chip.right, b.right) > Math.max(chip.left, b.left) + .1 &&
        Math.min(chip.bottom, b.bottom) > Math.max(chip.top, b.top) + .1
      expect(chip.left).toBeGreaterThanOrEqual(0)
      expect(chip.top).toBeGreaterThanOrEqual(0)
      expect(chip.right).toBeLessThan(screen.width / 3)
      expect(metrics.hands).toHaveLength(13)
      for (const face of metrics.hands) expect(overlaps(face), 'gang head covers a revealed west tile').toBe(false)
      for (const obstacle of metrics.obstacles) expect(overlaps(obstacle.box),
        `gang head ${JSON.stringify(chip)} covers ${obstacle.selector} ${JSON.stringify(obstacle.box)}`).toBe(false)
      await page.screenshot({ path: testInfo.outputPath('west-minglou.png') })
      await page.evaluate(() => (window as any).flowerFixture.setGangHead('north'))
      await expect(indicator.locator('.gang-head-name')).toHaveText('北风')
      await page.evaluate(() => (window as any).flowerFixture.setGangHead(null))
      await expect(indicator).toHaveCount(0)
      expect(errors).toEqual([])
    } finally { await context.close() }
  })
}
