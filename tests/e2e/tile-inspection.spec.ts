import { expect, test, type Page } from '@playwright/test'

async function publicPoint(page: Page, source: string, tile: string, playerIndex: number) {
  return page.locator('canvas.mahjong-scene').evaluate((canvas, target) => {
    const rect = canvas.getBoundingClientRect()
    // A meld can extend behind an opaque avatar; click an exposed copy.
    const point = JSON.parse((canvas as HTMLElement).dataset.inspectionPoints || '[]')
      .filter((p: any) => p.source === target.source && p.tile === target.tile && p.playerIndex === target.playerIndex)
      .map((p: any) => ({ x: rect.left + p.x * rect.width, y: rect.top + p.y * rect.height }))
      .find((p: any) => document.elementFromPoint(p.x, p.y) === canvas)
    if (!point) throw new Error(`Missing exposed public tile: ${JSON.stringify(target)}`)
    return point as { x: number; y: number }
  }, { source, tile, playerIndex })
}

const screens = [
  { name: 'desktop', width: 1280, height: 720, touch: false },
  { name: 'phone', width: 915, height: 412, touch: true },
  { name: 'small-phone', width: 568, height: 320, touch: true },
]
for (const theme of ['jade', 'happyMahjong', 'rosewood', 'llm', 'llmAnime']) for (const screen of screens) {
  test(`unknown tiles: ${theme} ${screen.name}`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: screen, hasTouch: screen.touch, isMobile: screen.touch })
    try {
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${process.env.E2E_PORT || 4173}/tests/e2e/fixtures/flowers.html?theme=${theme}&inspection=1&cameraLab=1`)
      await expect(page.locator('.game-table-hud')).toHaveAttribute('data-table-ready', 'true')
      await page.evaluate(() => (window as any).flowerFixture.setTurn(false))
      const hint = page.locator('.tile-unseen-hint')
      const inspectHand = async (tile: string) => {
        const card = page.locator(`[data-hand-tile="${tile}"]`)
        if (screen.touch) await card.tap()
        else await card.hover()
        await expect(hint).toBeVisible()
        const rect = (await hint.boundingBox())!
        expect(rect.x).toBeGreaterThanOrEqual(7)
        expect(rect.y).toBeGreaterThanOrEqual(7)
        expect(rect.x + rect.width).toBeLessThanOrEqual(screen.width - 7)
        expect(rect.y + rect.height).toBeLessThanOrEqual(screen.height - 7)
      }
      await inspectHand('s7')
      await expect(hint.locator('.tile-hint-name')).toHaveText(['六条', '七条', '八条'])
      await expect(hint.locator('.tile-hint-count')).toHaveText(['0张', '2张', '2张'])
      await expect(hint.locator('.current')).toHaveAttribute('data-tile', 's7')
      await page.screenshot({ path: testInfo.outputPath('hand-neighbours.png') })
      await page.evaluate(() => (window as any).flowerFixture.discard(3, 's8'))
      await expect(hint.locator('[data-tile="s8"]')).toHaveAttribute('data-remaining', '1')
      await inspectHand('m1')
      await expect(hint.locator('.tile-hint-name')).toHaveText(['一万', '二万'])
      await inspectHand('p9')
      await expect(hint.locator('.tile-hint-name')).toHaveText(['八筒', '九筒'])
      await inspectHand('east')
      await expect(hint.locator('.tile-hint-name')).toHaveText(['东风'])
      await inspectHand('white')
      await expect(hint.locator('.tile-hint-name')).toHaveText(['白板'])
      expect(await page.evaluate(() => (window as any).flowerFixture.discarded)).toEqual([])

      for (const [source, tile, seat, count] of [['discard','s8',1,1], ['meld','s6',1,0], ['meld','p3',3,0], ['minglou','s8',2,1]] as const) {
        const point = await publicPoint(page, source, tile, seat)
        expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.className, point), `${source} ${tile} seat ${seat}: ${JSON.stringify(point)}`).toContain('mahjong-scene')
        if (screen.touch) await page.touchscreen.tap(point.x, point.y)
        else await page.mouse.click(point.x, point.y)
        await expect(hint).toBeVisible()
        await expect(hint.locator('.tile-hint-item')).toHaveCount(1)
        await expect(hint.locator('.tile-hint-item')).toHaveAttribute('data-tile', tile)
        await expect(hint.locator('.tile-hint-item')).toHaveAttribute('data-remaining', String(count))
      }
      await page.screenshot({ path: testInfo.outputPath('public-tile.png') })
      await page.keyboard.press('Escape')
      await expect(hint).toHaveCount(0)
      const hiddenPoint = await publicPoint(page, 'minglou', 's8', 2)
      await page.evaluate(() => (window as any).flowerFixture.setMingLou(2, false))
      await page.mouse.click(hiddenPoint.x, hiddenPoint.y)
      await expect(hint).toHaveCount(0)

      await page.evaluate(() => { (window as any).flowerFixture.setTurn(true); (window as any).flowerFixture.setLocked(true) })
      await inspectHand('s7')
      expect(await page.evaluate(() => (window as any).flowerFixture.discarded)).toEqual([])
      await page.evaluate(() => (window as any).flowerFixture.setLocked(false))
      if (screen.touch) {
        await page.locator('[data-hand-tile="m2"]').tap()
        expect(await page.evaluate(() => (window as any).flowerFixture.discarded)).toEqual([])
        await page.locator('[data-hand-tile="m2"]').tap()
      } else await page.locator('[data-hand-tile="m2"] .mahjong-tile').click()
      await expect(page.locator('[data-hand-tile="m2"]')).toHaveCount(0)
      expect(await page.evaluate(() => (window as any).flowerFixture.discarded)).toHaveLength(1)
      expect(errors).toEqual([])
    } finally { await context.close() }
  })
}
