// Two disposable emulator APKs, real pinned TLS sockets, actual Vue UI.
// Emulator NATs cannot reach each other: adb forwards only TCP, never game messages.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk')
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
const ids = (process.env.NEARBY_EMULATORS || 'emulator-5554,emulator-5556').split(',')
if (ids.length !== 2 || ids.some(s => !/^emulator-\d+$/.test(s))) throw new Error('Only two disposable emulators are allowed')
const appId = 'io.github.mahjong253506088.app.debug'
const activity = `${appId}/io.github.mahjong253506088.app.MainActivity`
const output = process.env.NEARBY_EVIDENCE_DIR || 'tmp/nearby-native-evidence'
await fs.mkdir(output, { recursive: true })
const shell = (device, ...args) => execFileSync(adb, ['-s', device, ...args], { encoding: 'utf8', timeout: 60000 }).trim()
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, label, timeout = 60000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await fn(); if (value) return value; await wait(250) }
  throw new Error(`Timeout: ${label}`)
}
async function connect(device, port) {
  const pid = await until(() => { try { return shell(device, 'shell', 'pidof', appId) } catch { return null } }, 'process')
  shell(device, 'forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`)
  const target = await until(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page') } catch { return null } }, 'WebView')
  const ws = new WebSocket(target.webSocketDebuggerUrl), pending = new Map(), errors = []
  let serial = 0
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
    const p = pending.get(m.id)
    if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
  }
  ws.onclose = () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP closed')) } pending.clear() }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 90000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  await send('Runtime.enable')
  const button = text => evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()===${JSON.stringify(text)});if(b){b.click();return true}return false})()`)
  const click = selector => evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return false;e.click();return true})()`)
  const fill = (selector, value) => evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  const screenshot = async label => fs.writeFile(path.join(output, `${label}.png`), execFileSync(adb, ['-s', device, 'exec-out', 'screencap', '-p']))
  const journal = () => evaluate(`JSON.parse(localStorage.getItem('mahjong.nearby.v1')||'null')`)
  const enter = async () => {
    await until(() => evaluate(`!!document.querySelector('[data-testid="open-nearby"]')`), 'lobby')
    await button('同意并继续'); await click('[data-testid="open-nearby"]')
    await until(() => evaluate(`!!document.querySelector('.nearby')`), 'nearby entry')
  }
  const observe = () => evaluate(`(() => {const original=window.MahjongNearby.onmessage; window.__nearbyFrames=[];window.MahjongNearby.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.event==='message'){const p=JSON.parse(m.data);if(p.kind==='snapshot')window.__nearbyFrames=[p]}}catch{}original(e)};const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timeout(fn,[500,550,650,850].includes(ms)?10:ms,...args);})()`)
  return { device, send, evaluate, button, click, fill, screenshot, journal, errors, enter, observe, close: () => ws.close() }
}
let host, guest
const report = { rules: [], checks: [], errors: [] }
try {
  for (const id of ids) {
    await until(() => { try { return shell(id, 'shell', 'getprop', 'sys.boot_completed') === '1' } catch { return false } }, 'boot')
    shell(id, 'install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk')
    shell(id, 'shell', 'pm', 'clear', appId)
    shell(id, 'shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed')
    shell(id, 'shell', 'svc', 'wifi', 'enable')
    shell(id, 'shell', 'svc', 'data', 'enable')
    shell(id, 'shell', 'cmd', 'wifi', 'connect-network', 'AndroidWifi', 'open')
    shell(id, 'shell', 'am', 'start', '-n', activity)
  }
  host = await connect(ids[0], 9234); guest = await connect(ids[1], 9235)
  await host.enter(); await guest.enter()
  await host.observe(); await guest.observe()
  await host.screenshot('01-entry')
  const rules = process.env.NEARBY_RULES?.split(',') || ['lotus-classic', 'lotus-legacy', 'shandong', 'lotus-blood-flow']
  for (const rule of rules) {
    await host.fill('.setup-card input:not([type=checkbox])', '房主小东')
    await host.fill('.setup-card select', rule)
    await host.button('创建房间 · 出示二维码')
    const save = await until(async () => (await host.journal())?.role === 'host' && await host.journal(), 'host room')
    await until(() => host.evaluate(`!!document.querySelector('.qr-dialog img')`), 'QR image')
    await host.screenshot(`02-qr-${rule}`)
    const qr = await host.evaluate(`document.querySelector('.qr-dialog img').src`)
    assert(qr.startsWith('data:image/png;base64,'))
    shell(ids[0], 'forward', `tcp:${save.invite.port}`, `tcp:${save.invite.port}`)
    const invite = { ...save.invite, hosts: ['10.0.2.2'] }
    await host.click('[aria-label="关闭二维码"]')
    await guest.button('输入邀请内容')
    await guest.fill('[aria-label="邀请内容"]', 'mahjong-nearby:' + JSON.stringify(invite))
    await guest.button('确认加入')
    await until(() => guest.button('准备好了'), 'guest ready')
    await until(() => host.button('开始无限场'), 'host start')
    await until(() => host.evaluate(`document.querySelectorAll('.hand-tile-slot').length>0`), 'host hand')
    await until(() => guest.evaluate(`document.querySelectorAll('.hand-tile-slot').length>0`), 'guest hand')
    await until(() => host.evaluate('document.querySelector(".game-table-hud")?.dataset.tableReady === "true"'), 'host 3D ready', 90000)
    await until(() => guest.evaluate('document.querySelector(".game-table-hud")?.dataset.tableReady === "true"'), 'guest 3D ready', 90000)
    await wait(1200) // Allow the native compositor to finish the loading fade.
    const guestFrame = await guest.evaluate(`window.__nearbyFrames[0]`)
    const privatePlayers = guestFrame.table?.players ?? guestFrame.blood.view.players
    assert(privatePlayers.filter(p => p.hand.length > 0).length === 1, 'Only the viewer hand is sent')
    await host.screenshot(`03-host-${rule}`); await guest.screenshot(`04-guest-${rule}`)
    report.checks.push(`${rule}: QR, TLS join, ready, private hands, real rendered APK`)
    console.log('STARTED', rule)
    // Drive only UI actions. This shortcut chooses pass/discard, never touches engine state.
    const step = `(() => {const visible=e=>e&&e.getClientRects().length&&!e.disabled;for(const cls of ['.action.hu','.action.pass']){const b=document.querySelector(cls);if(visible(b)){b.click();return true}}const rack=document.querySelector('.hand-rack.playable');if(rack){const tiles=[...rack.querySelectorAll('.hand-tile-slot .mahjong-tile')].filter(visible);const tile=tiles[tiles.length-1];if(tile){tile.click();tile.click();return true}}const next=[...document.querySelectorAll('button')].find(b=>visible(b)&&/下一局|准备下一局|确认继续|^继续$/.test(b.textContent));if(next){next.click();return true}return false})()`
    if (process.env.NEARBY_RECOVERY === '1') {
      await host.evaluate(step)
      await until(() => guest.evaluate('!!window.__nearbyFrames?.[0]?.decision'), 'guest decision before disconnect')
      guest.close(); shell(ids[1], 'shell', 'am', 'force-stop', appId)
      await until(() => host.evaluate('document.body.innerText.includes("暂时离线")'), 'offline roster')
      const actionsBefore = (await host.journal()).journal.actions.length
      await wait(2500)
      assert.equal((await host.journal()).journal.actions.length, actionsBefore, 'Default-off takeover waits for absent human')
      await host.button('☷ 房间')
      await host.click('.nearby-dialog .switch-row input')
      await until(async () => (await host.journal()).journal.actions.length > actionsBefore, 'host-enabled AI takeover')
      await host.click('.nearby-dialog .switch-row input')
      await host.click('[aria-label="关闭房间管理"]')
      shell(ids[1], 'shell', 'am', 'start', '-n', activity)
      guest = await connect(ids[1], 9235); await guest.enter(); await guest.observe()
      await guest.button('恢复上次房间 →')
      await until(() => guest.evaluate('window.__nearbyFrames?.[0]?.seat === 1'), 'guest reclaimed seat')
      assert.equal((await guest.journal()).token.length, 48)
      report.checks.push(`${rule}: guest process death, default waiting, host toggle takes over, guest returns to original seat`)
      console.log('GUEST RECOVERED', rule)
      await guest.screenshot(`06-reconnected-${rule}`)
      const checkpoint = await host.journal()
      host.close(); shell(ids[0], 'shell', 'am', 'force-stop', appId)
      shell(ids[0], 'shell', 'am', 'start', '-n', activity)
      host = await connect(ids[0], 9234); await host.enter(); await host.observe()
      await host.button('恢复上次房间 →')
      await until(() => host.evaluate('document.querySelector(".game-table-hud")?.dataset.tableReady === "true"'), 'restored authority', 90000)
      await until(() => guest.evaluate('window.__nearbyFrames?.[0]?.room?.started && !document.body.innerText.includes("正在连接房主")'), 'guest follows restored host', 90000)
      const restored = await host.journal()
      assert.equal(restored.invite.fingerprint, checkpoint.invite.fingerprint)
      assert.equal(restored.invite.port, checkpoint.invite.port)
      assert.deepEqual(restored.journal.opening, checkpoint.journal.opening)
      assert(restored.journal.actions.length >= checkpoint.journal.actions.length)
      report.checks.push(`${rule}: host process death restores pinned identity, port, round checkpoint and journal`)
      console.log('HOST RECOVERED', rule)
      await host.screenshot(`07-host-restored-${rule}`)
    }
    for (const player of [host, guest]) await player.evaluate(`window.__nearbyAuto = setInterval(() => { ${step} }, 180)`)
    const goal = Number(process.env.NEARBY_ROUNDS || (rule === 'lotus-classic' ? 5 : 2))
    let loops = 0, lastProgress = Date.now(), actions = 0
    while (true) {
      const state = await host.journal()
      if (state.room.round >= goal) break
      const count = state.journal?.actions.length ?? 0
      if (count !== actions) { lastProgress = Date.now(); actions = count }
      if (Date.now() - lastProgress > 45000) throw new Error(`No gameplay progress ${rule}: ${JSON.stringify(await host.evaluate("document.body.innerText.slice(-2500)"))}`)
      await wait(1000)
      if (++loops > 7000) throw new Error(`Too many steps: ${rule}`)
    }
    for (const player of [host, guest]) await player.evaluate('clearInterval(window.__nearbyAuto)')
    const state = await host.journal()
    assert.equal(state.journal.opening.dealer, (goal - 1) % 4)
    assert.equal(state.journal.opening.scores.reduce((a,b)=>a+b,0), 8000)
    report.rules.push({ rule, reachedRound: state.room.round, scores: state.journal.opening.scores, loops })
    await host.screenshot(`05-continued-${rule}`)
    await until(() => host.button('☷ 房间'), 'room menu'); await until(() => host.button('解散房间'), 'dissolve action'); await until(() => host.button('确认解散'), 'dissolve confirmation')
    await until(() => guest.evaluate(`document.body.innerText.includes('房主已解散房间')`), 'dissolve reaches peer')
    await until(() => host.evaluate('!!document.querySelector(".setup-card")'), 'host exits after delivery acknowledgements')
    await guest.click('[aria-label="关闭提示"]')
    console.log('COMPLETED', rule, state.room.round)
  }
  report.errors = [...host.errors, ...guest.errors]
  assert.deepEqual(report.errors, [])
  report.success = true
} catch (e) {
  report.failure = e.stack
  console.error(e)
  if (host) { await host.screenshot('failure-host').catch(()=>{}); report.hostText = await host.evaluate('document.body.innerText').catch(()=>null); report.errors.push(...host.errors) }
  if (guest) { await guest.screenshot('failure-guest').catch(()=>{}); report.guestText = await guest.evaluate('document.body.innerText').catch(()=>null); report.errors.push(...guest.errors) }
  process.exitCode = 1
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  host?.close(); guest?.close()
}
