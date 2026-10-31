// Real APK/WebView smoke test. Use a disposable Android emulator, never a
// personal device: this test reinstalls the debug APK and clears its app data.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const serial = process.env.ANDROID_SERIAL
if (!serial?.startsWith('emulator-')) throw new Error('Set ANDROID_SERIAL to a disposable emulator (e.g. emulator-5554)')
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
if (!sdk) throw new Error('Set ANDROID_HOME')
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const appId = 'io.github.mahjong253506088.app.debug'
const apkPath = 'android/app/build/outputs/apk/debug/app-debug.apk'
const activity = `${appId}/io.github.mahjong253506088.app.MainActivity`
const output = process.env.ANDROID_EVIDENCE_DIR || 'tmp/android-smoke'
await fs.mkdir(output, { recursive: true })
const shell = (...args) => execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8' }).trim()
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, description, timeout = 45000) {
  const started = Date.now()
  while (Date.now() - started < timeout) { const value = await check(); if (value) return value; await wait(250) }
  throw new Error(`Timed out: ${description}`)
}
shell('install', '-r', apkPath)
shell('shell', 'pm', 'clear', appId)
// Dismiss the emulator's first-use system tutorial, which otherwise intercepts
// game taps and the first Back key outside the WebView.
shell('shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed')
const wifi = shell('shell', 'settings', 'get', 'global', 'wifi_on')
const data = shell('shell', 'settings', 'get', 'global', 'mobile_data')
let ws
try {
  shell('shell', 'svc', 'wifi', 'disable')
  shell('shell', 'svc', 'data', 'disable')
  shell('shell', 'am', 'start', '-n', activity)
  const pid = await until(() => { try { return shell('shell', 'pidof', appId) } catch { return null } }, 'app process')
  shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`)
  const target = await until(async () => { try {
    return (await (await fetch('http://127.0.0.1:9223/json/list')).json()).find(t => t.type === 'page')
  } catch { return null } }, 'WebView debugging socket')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  let id = 0
  const pending = new Map()
  const errors = []
  ws.addEventListener('close', () => {
    for (const callback of pending.values()) callback.reject(new Error('WebView connection closed'))
    pending.clear()
  })
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    const callback = pending.get(message.id)
    if (callback) { pending.delete(message.id); clearTimeout(callback.timeout); message.error ? callback.reject(new Error(JSON.stringify(message.error))) : callback.resolve(message.result) }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id
    const timeout = setTimeout(() => { pending.delete(callId); reject(new Error(`CDP timeout: ${method}`)) }, 90000)
    pending.set(callId, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id: callId, method, params }))
  })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const tap = async expression => {
    await evaluate(`(${expression})?.scrollIntoView({block:'nearest', inline:'nearest', behavior:'instant'})`)
    await wait(600)
    const point = await until(() => evaluate(`(() => { const el = ${expression}; if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null })()`), 'touch target')
    const ratio = await evaluate('devicePixelRatio')
    shell('shell', 'input', 'touchscreen', 'tap', String(Math.round(point.x * ratio)), String(Math.round(point.y * ratio)))
    await wait(450)
  }
  const button = text => `[...document.querySelectorAll('button')].find(b => b.innerText.includes(${JSON.stringify(text)}))`
  const screenshot = async name => {
    // Old WebViews omit composited WebGL layers from CDP screenshots.
    // DOM assertions can finish before Android presents the new frame. Wait
    // for paint and the native compositor so evidence shows the asserted UI.
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await wait(1000)
    const png = execFileSync(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 16 * 1024 * 1024 })
    await fs.writeFile(path.join(output, `${name}.png`), png)
  }
  await send('Runtime.enable')
  await until(() => evaluate("document.querySelector('.start-button') !== null"), 'offline lobby')
  if (!await evaluate("innerWidth > innerHeight && document.body.innerText.includes('离线单机版') && ![...document.querySelectorAll('button')].some(b => b.innerText.includes('联机对战'))")) throw new Error('Offline mode or landscape contract failed')
  await screenshot('lobby')
  console.log('Offline landscape lobby loaded')
  await tap(button('玩法'))
  await tap(button('山东麻将'))
  await until(() => evaluate("document.querySelector('.rule-picker-options .active')?.innerText.includes('山东麻将')"), 'Shandong rule selection')
  await tap(button('确定'))
  await until(() => evaluate("!document.querySelector('.rule-picker-options') && document.querySelector('.start-button')?.innerText.includes('山东麻将')"), 'saved rule selection')
  await tap(button('开始东风场'))
  await until(() => evaluate("document.querySelectorAll('.hand-tile-slot').length === 14 && document.querySelector('.game-table-hud')?.dataset.tableReady === 'true' && document.querySelector('.game-table-hud')?.dataset.openingStage === ''"), 'Shandong opening with offline assets', 90000)
  await until(() => evaluate("!document.querySelector('.table-loading, .opening-overlay')"), 'opening transitions finished')
  await screenshot('shandong-table')
  console.log('Shandong table and all assets loaded')
  const handBefore = await evaluate("document.querySelectorAll('.hand-tile-slot').length")
  const swipe = await evaluate("(() => {const r=document.querySelector('.hand-tile-slot .mahjong-tile').getBoundingClientRect();return {x:Math.round((r.x+r.width/2)*devicePixelRatio),y:Math.round((r.y+r.height/2)*devicePixelRatio),endY:Math.round((r.y-70)*devicePixelRatio)}})()")
  shell('shell', 'input', 'touchscreen', 'swipe', String(swipe.x), String(swipe.y), String(swipe.x), String(swipe.endY), '220')
  await until(() => evaluate("document.querySelectorAll('.hand-tile-slot').length !== " + handBefore), 'touch discard')
  console.log('Touch swipe discarded a tile')
  const flower = await evaluate("document.querySelector('.flower-badge') !== null")
  if (flower) {
    await tap("document.querySelector('.flower-badge')")
    await until(() => evaluate("document.querySelector('.flower-detail') !== null"), 'flower detail')
    await screenshot('flowers')
    console.log('Flower detail opened; testing native back')
    shell('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    await until(() => evaluate("document.querySelector('.flower-detail') === null"), 'native back closes the flower detail')
  }
  await evaluate('window.__nativeSmokeToken = 253506088')
  console.log('Testing background/resume')
  shell('shell', 'input', 'keyevent', 'KEYCODE_HOME')
  await wait(500)
  shell('shell', 'am', 'start', '-n', activity)
  await wait(500)
  if (!await evaluate('window.__nativeSmokeToken === 253506088')) throw new Error('Background/resume recreated the game')
  if (errors.length) throw new Error(errors.join('\n'))
  const report = { capturedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()),
    apkSha256: createHash('sha256').update(await fs.readFile(apkPath)).digest('hex'),
    android: shell('shell','getprop','ro.build.version.release'), api: shell('shell','getprop','ro.build.version.sdk'),
    webview: shell('shell','dumpsys','webviewupdate').split('\n').find(line => line.includes('Current WebView package'))?.trim(),
    offline: true, landscape: true, shandongOpening: true, touchDiscard: true, flowerDetail: flower, backgroundResume: true, errors }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  ws?.close()
  shell('forward', '--remove', 'tcp:9223')
  if (wifi === '1') shell('shell', 'svc', 'wifi', 'enable')
  if (data === '1') shell('shell', 'svc', 'data', 'enable')
}
