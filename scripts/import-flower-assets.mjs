// Rebuild the eight face-only SVGs from Cangjie6's CC BY-SA 4.0 artwork.
// No font, network request, or SVG editor payload is needed by the game itself.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'

const names = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊']
// Wikimedia numbers the botanical flowers 梅兰菊竹; our engine uses 梅兰竹菊.
const sourceNumbers = [1, 2, 3, 4, 5, 6, 8, 7]
const cache = new URL('../tmp/flowers/', import.meta.url)
await fs.mkdir(cache, { recursive: true })
const titles = sourceNumbers.map(n => `File:MJh${n}-.svg`).join('|')
const metadataUrl = 'https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url%7Cextmetadata&format=json&titles=' + encodeURIComponent(titles)
const response = await fetch(metadataUrl)
if (!response.ok) throw new Error(`Metadata: HTTP ${response.status}`)
const metadata = await response.json()
const browser = await chromium.launch({ headless: true, channel: process.env.E2E_CHANNEL || 'chromium' })
const page = await browser.newPage()
const sources = []
try {
  for (const [index, n] of sourceNumbers.entries()) {
    const source = Object.values(metadata.query.pages).find(p => p.title === `File:MJh${n}-.svg`).imageinfo[0]
    if (source.extmetadata.LicenseShortName.value !== 'CC BY-SA 4.0') throw new Error('Review the changed source license')
    const url = new URL(source.url); url.search = ''
    const cached = new URL(`h${n}.svg`, cache)
    let svg = await fs.readFile(cached, 'utf8').catch(() => null)
    if (!svg) {
      const download = await fetch(url, { headers: { 'User-Agent': 'MahjongFlowerImporter/1.0 (open-source asset import)' } })
      if (!download.ok) throw new Error(`${url}: HTTP ${download.status}; rerun later to resume the cache`)
      svg = await download.text()
      if (!svg.includes('<svg')) throw new Error(`Invalid SVG: ${url}`)
      await fs.writeFile(cached, svg)
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    // The original has a separate oblique tile body (st0..st6). Extract only
    // the colored, already-outlined flower, season glyph and rank paths.
    const colors = Object.fromEntries([...svg.matchAll(/\.(st\d+)\{fill:(#[0-9A-Fa-f]+)/g)].map(m => [m[1], m[2]]))
    const bodyEnd = svg.indexOf('id="path3882"')
    if (bodyEnd < 0) throw new Error(`Missing original tile body boundary: ${url}`)
    const artSource = svg.slice(svg.indexOf('/>', bodyEnd) + 2)
    const art = [...artSource.matchAll(/<(?:path|polygon|polyline|circle|ellipse)\b[^>]*\/>/gs)]
      .map(m => m[0])
      .map(shape => shape.replace(/class="(st\d+)"/, (_, name) => `fill="${colors[name]}"`).replace(/\s+id="[^"]*"/g, '').replace(/\s+/g, ' ')).join('\n')
    if (!art || art.includes('undefined')) throw new Error(`Unexpected SVG structure: ${url}`)
    await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg"><g>${art}</g></svg>`)
    const box = await page.locator('g').evaluate(g => { const b = g.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height } })
    const width = Math.max(box.width + 14, (box.height + 14) * .75)
    const height = width / .75
    const viewBox = [box.x + box.width / 2 - width / 2, box.y + box.height / 2 - height / 2, width, height].map(v => v.toFixed(3)).join(' ')
    const face = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="512" viewBox="${viewBox}">\n<title>${names[index]}</title>\n<desc>Adapted from ${source.descriptionurl} by Cangjie6. CC BY-SA 4.0. Tile body removed; face cropped and normalized.</desc>\n${art}\n</svg>\n`
    for (const dir of ['public/tiles', 'public/themes/llm-anime/v1/tiles']) await fs.writeFile(new URL(`../${dir}/f${index + 1}.svg`, import.meta.url), face)
    sources.push({ tile: `f${index + 1}`, name: names[index], author: 'Cangjie6', page: source.descriptionurl, original: url.href,
      originalSha256: createHash('sha256').update(svg).digest('hex'), license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      changes: 'Removed oblique tile body and editor payload; retained outlined face artwork; cropped and normalized to 3:4.' })
    console.log(`f${index + 1} ${names[index]}: ${face.length} bytes`)
  }
  await fs.mkdir(new URL('../assets-src/flowers/', import.meta.url), { recursive: true })
  await fs.writeFile(new URL('../assets-src/flowers/sources.json', import.meta.url), JSON.stringify(sources, null, 2) + '\n')
} finally { await browser.close() }
