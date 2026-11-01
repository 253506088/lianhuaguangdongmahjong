import { expect, test } from '@playwright/test'

// 同一用例可对 Vite H5 或 dist-android 静态服务执行，不依赖后端。
for (const screen of [{name:'desktop',width:1280,height:720},{name:'phone',width:915,height:412}]) {
  test.describe(screen.name, () => {
  test.use({ hasTouch: screen.name === 'phone', isMobile: screen.name === 'phone' })
  test(`山东默认入口、结算与真实录制回放：${screen.name}`, async ({page},testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize(screen)
    await page.addInitScript(() => {
      localStorage.setItem('lianhua-guangma:selected-rule:v1','lotus-classic')
      // 恒定洗牌使庄家起手豪华七对，快速走完真实开局与天胡结算。
      Math.random=()=>0.999999
    })
    const errors:string[]=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto('/')
    await expect(page.locator('.start-button')).toContainText('山东麻将')
    await page.locator('.start-button').click()
    await expect(page.locator('.round-settlement')).toBeVisible({timeout:30000})
    await expect(page.locator('.base-score-badge')).toContainText('10')
    await expect(page.locator('.round-settlement')).toContainText('天胡')
    await page.getByRole('button',{name:'查看牌桌',exact:true}).click()
    await page.getByRole('button',{name:'退出对局',exact:true}).click()
    await page.getByTestId('open-replay').click()
    await expect(page.getByTestId('replay-list-rows')).toContainText('山东麻将')
    await page.getByTestId('replay-list-rows').getByRole('button',{name:'查看',exact:true}).first().click()
    await expect(page.getByTestId('replay-viewer')).toBeVisible()
    await expect(page.locator('.replay-title')).toContainText('258掌将')
    await expect(page.locator('canvas.mahjong-scene')).toBeVisible()
    await expect(page.locator('.replay-viewer .table-loading')).toHaveCount(0,{timeout:30000})
    await page.keyboard.press('End')
    await expect(page.getByTestId('replay-result')).toContainText('天胡')
    await page.screenshot({path:testInfo.outputPath('shandong-replay.png')})
    expect(errors).toEqual([])
  })
  })
}
