<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import GameTableHud from '../table/GameTableHud.vue'
import SettlementOverlay from '../settlement/SettlementOverlay.vue'
import { nativeNearby } from '../../platform/nearbyBridge'
import { createNearbyRoom, readNearbySave } from '../../game/nearby/room'
import { DEFAULT_NEARBY_SETTINGS, encodeInvitation, parseInvitation, roundLabel, type Choice } from '../../game/nearby/protocol'
import { nearbyTableView } from '../../game/nearby/tableView'
import { RULE_VARIANTS, BLOOD_FLOW_RULE, getRuleVariant } from '../../game/core/rules/ruleVariants'
import { useBloodFlowGame } from '../../game/variants/lotus/bloodFlow/useBloodFlowGame'
import { useEffectPlayer } from '../../game/core/presentation/useAudio'
import { playDiscardName } from '../../game/shared/runtime/discardAudio'
import type { TableThemeName } from '../table/three/tableTheme'
import type { TileType } from '../../game/core/contracts/types'
import { themePresentationByName, themePresentationCssVariables } from '../../theme/themePresentation'
const RulesPanel = defineAsyncComponent(() => import('../RulesPanel.vue'))
const props = defineProps<{ themeName: TableThemeName }>()
const themeStyle = computed(() => themePresentationCssVariables(themePresentationByName(props.themeName)))
const emit = defineEmits<{ close: [] }>()
const transport = nativeNearby()
const client = createNearbyRoom(transport)
const { room, table, status, error, mySeat, host, decision, invite } = client
const name = ref(localStorage.getItem('mahjong.nearby.name') || '牌友')
const settings = ref({ ...DEFAULT_NEARBY_SETTINGS })
const busy = ref(false), panel = ref(false), qrOpen = ref(false), joining = ref(false), rulesOpen = ref(false), confirming = ref(false)
const invitationText = ref(''), qr = ref(''), resultVisible = ref(true), selection = ref(-1)
const declaration = ref<'none' | 'ming' | 'ting'>('none')
const savedAvailable = ref(!!readNearbySave())
const playSound = useEffectPlayer() ?? (() => {})
const bloodGame = useBloodFlowGame({ countdownEnabled: false, infiniteRounds: true, lockedAutoPlayMs: 0,
  playSound, getThemeName: () => props.themeName,
  externalAuthority: { send: () => {}, nextRound: () => nextRound(), leave: () => {}, openingDone: () => {} } })
watch(client.blood, value => {
  if (value) void bloodGame.acceptRemoteView(value.view, { round: value.round, dealer: value.dealer, mode: 'east', continuation: value.continuation })
})
const display = computed(() => {
  let value = table.value
  if (client.blood.value && room.value) {
    const base = nearbyTableView(bloodGame, 0, null, room.value.settings)
    value = { ...base, phase: bloodGame.phase.value, isUserTurn: bloodGame.isUserTurn.value,
      userCanHu: bloodGame.userCanHu.value, userKongs: bloodGame.userKongs.value,
      actionPrompt: bloodGame.actionPrompt.value, userHasWindKong: !!bloodGame.capabilities.value.windKong?.available,
      userCurrentWaits: bloodGame.userCurrentWaits.value, userTingOptions: bloodGame.userTingOptions.value,
      bloodFlow: bloodGame.capabilities.value.bloodFlow } as typeof base
  }
  if (!value) return null
  return { ...value, themeName: props.themeName, selectedIndex: selection.value,
    userDiscardWaits: value.userTingOptions.find(w => w.discard === value!.user?.hand[selection.value]) ?? null,
    isUserTurn: status.value === 'online' && value.isUserTurn,
    actionPrompt: status.value === 'online' ? value.actionPrompt : null,
    userCanHu: status.value === 'online' && value.userCanHu,
  }
})
const isBlood = computed(() => room.value?.settings.rule === 'lotus-blood-flow')
const standings = computed(() => (display.value?.players ?? []).map((p, i) => ({ ...p, playerIndex: i, rank: 0 }))
  .sort((a, b) => b.score - a.score || a.seat - b.seat).map((p, i) => ({ ...p, rank: i + 1 })))
const readyToStart = computed(() => {
  const humans = room.value?.seats.filter(s => !s.bot) ?? []
  return humans.length >= 2 && humans.every(s => s.online && s.ready)
})
const disconnected = computed(() => room.value?.seats.filter(s => !s.bot && !s.online).map(s => s.name).join('、'))
const waiting = computed(() => !!room.value?.seats[mySeat.value]?.continued)
const notice = computed(() => status.value === 'reconnecting' || status.value === 'connecting' ? '正在连接房主，座位已保留…'
  : disconnected.value ? `${disconnected.value} 暂时离线 · ${room.value?.settings.takeover ? 'AI 托管中，回来即可接手' : '保留座位，轮到本人时等待重连'}` : '不限出牌时间 · 自动补齐空位 · 东南西北循环')

async function run(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { localStorage.setItem('mahjong.nearby.name', name.value); await action() }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function create() { await run(() => client.create(name.value, settings.value)); if (room.value) await showQr() }
async function scan() {
  await run(async () => {
    const text = await transport.request<string>('scan')
    if (!text) return
    // Present the invitation first; joining is an explicit action after scanning.
    parseInvitation(text); invitationText.value = text; joining.value = true
  })
}
async function join() { await run(async () => { await client.join(parseInvitation(invitationText.value.trim()), name.value); joining.value = false }) }
async function showQr() {
  if (!invite.value) return
  qrOpen.value = true
  await run(async () => { await client.refreshInvitation(); qr.value = await transport.request('qr', { text: encodeInvitation(invite.value!) }) })
}
function pick(kind: string, value?: number | TileType) {
  const d = decision.value
  if (!d || status.value !== 'online') return
  const candidates = d.choices.filter(c => c.kind === kind || kind === 'kong' && ['added-kong', 'concealed-kong'].includes(c.kind))
  let choice: Choice | undefined
  if (kind === 'discard') choice = candidates.find(c => c.handIndex === value && !!c.declareMingLou === (declaration.value === 'ming') && !!c.declareBaoTing === (declaration.value === 'ting'))
  else if (kind === 'chi') choice = candidates[value as number]
  else if (kind === 'kong') choice = candidates.find(c => c.tile === value)
  else choice = candidates[0]
  if (!choice) { error.value = declaration.value !== 'none' ? '请选择打出后能听牌的一张，或取消报听 / 明搂' : '局面已更新，请重新操作'; return }
  client.act('action', { decision: d.id, choice: choice.id })
  selection.value = -1; declaration.value = 'none'
}
function nextRound() { client.act('continue', { round: room.value?.round }) }
function configureTakeover(event: Event) {
  if (!room.value) return
  client.configure({ ...room.value.settings, takeover: (event.target as HTMLInputElement).checked })
}
async function exitRoom() {
  await run(() => client.leave(host.value))
  savedAvailable.value = !!readNearbySave(); confirming.value = false; panel.value = false; qrOpen.value = false
}
watch(() => decision.value?.id, () => { selection.value = -1; declaration.value = 'none' })
watch(() => room.value?.round, () => { resultVisible.value = true })
watch(() => table.value?.lastDiscard?.id, () => {
  const d = table.value?.lastDiscard
  if (d) void playDiscardName(d.tile, { playSound })
})
watch(() => table.value?.tableActionEvent?.id, () => {
  const e = table.value?.tableActionEvent
  if (e) playSound(e.type.includes('gang') ? 'gang.mp3' : e.type === 'peng' ? 'peng.mp3' : e.type === 'chi' ? 'chi.mp3' : 'hu.mp3')
})
onBeforeUnmount(() => { client.dispose(); bloodGame.dispose() })
</script>

<template>
  <main class="nearby" :class="{ 'at-table': !!display?.players.length, 'game-app': !!display?.players.length, 'has-three-scene': !!display?.players.length }" :data-table-theme="themeName" :style="display?.players.length ? themeStyle : undefined">
    <header class="nearby-header">
      <button v-if="!room" class="nearby-back" @click="emit('close')">‹ 返回大厅</button>
      <button v-else class="nearby-back" @click="panel = !panel">☷ 房间</button>
      <div><strong>附近同桌</strong><span>{{ room ? getRuleVariant(room.settings.rule).name : '扫码相聚，随时开局' }}</span></div>
      <b v-if="room?.started" class="round-chip">{{ roundLabel(room.round) }}</b>
      <span v-else class="nearby-badge">手机直连</span>
      <button v-if="room" class="nearby-back" @click="rulesOpen = true">玩法</button>
    </header>

    <p v-if="error" class="nearby-error" role="alert">{{ error }}<button @click="error = ''" aria-label="关闭提示">×</button></p>
    <p v-if="room && (!room.started || disconnected) || status === 'connecting' || status === 'reconnecting'" class="nearby-status" :class="{ waiting: disconnected || status !== 'online' }" role="status">{{ notice }}</p>

    <section v-if="!room" class="nearby-entry">
      <div class="nearby-intro">
        <p class="eyebrow">面对面，一起打</p>
        <h1>两个人，<br>也能凑一桌。</h1>
        <p>空位交给 AI，时间留给朋友。<br>连上同一 Wi-Fi 或手机热点，出示二维码就能开局。</p>
        <div class="nearby-features"><span>2–4 位真人</span><span>无需账号</span><span>断线可回来</span></div>
      </div>
      <div class="nearby-card setup-card">
        <label>你的称呼<input v-model="name" maxlength="16" placeholder="让朋友认出你" autocomplete="off"></label>
        <label>房主选择玩法<select v-model="settings.rule"><option v-for="rule in [...RULE_VARIANTS, BLOOD_FLOW_RULE]" :key="rule.id" :value="rule.id">{{ rule.name }}</option></select></label>
        <div v-if="settings.rule === 'shandong'" class="nearby-inline"><select v-model="settings.jiang" aria-label="山东将牌规则"><option value="258">258 掌将</option><option value="luan">乱将</option></select><label class="switch-row"><input v-model="settings.chi" type="checkbox">允许吃牌</label></div>
        <label class="switch-row"><input v-model="settings.takeover" type="checkbox"><span>掉线后 AI 托管<small>默认关闭，等朋友回来继续打</small></span></label>
        <div class="nearby-buttons"><button class="primary" :disabled="busy || !name.trim()" @click="create">创建房间 · 出示二维码</button><button class="secondary" :disabled="busy || !name.trim()" @click="scan">扫码加入</button></div>
        <div class="nearby-links"><button @click="joining = true">输入邀请内容</button><button v-if="savedAvailable" :disabled="busy" @click="run(client.resume)">恢复上次房间 →</button></div>
        <small>使用手机热点时，让其他人先连接房主热点；不需要互联网。</small>
      </div>
    </section>

    <section v-if="room && !room.started" class="nearby-waiting-room">
      <div class="nearby-card room-summary"><p class="eyebrow">{{ host ? '你是房主' : '已加入好友房间' }}</p><h1>{{ getRuleVariant(room.settings.rule).name }}</h1><p>无限轮庄 · 不限时出牌</p><p>缺少的座位自动由普通 AI 补齐。<br>真人准备后，房主即可开始。</p><button v-if="host" class="primary" @click="showQr">出示房间二维码</button><label v-if="host" class="switch-row"><input type="checkbox" :checked="room.settings.takeover" @change="configureTakeover"><span>掉线后 AI 托管<small>可在牌局中随时调整</small></span></label><p v-else>掉线托管：{{ room.settings.takeover ? '开启' : '关闭，等待重连' }}</p></div>
      <div class="nearby-card seats-card">
        <div v-for="seat in room.seats" :key="seat.seat" class="nearby-seat"><span class="seat-wind">{{ ['东', '南', '西', '北'][seat.seat] }}</span><div><b>{{ seat.name }}{{ seat.seat === mySeat ? '（你）' : '' }}</b><small>{{ seat.bot ? '空位 · 开局时由 AI 补齐' : seat.seat === 0 ? '房主' : '真人玩家' }}</small></div><span class="seat-state" :class="{ ready: seat.ready }">{{ seat.bot ? 'AI 补位' : !seat.online ? '离线' : seat.ready ? '已准备' : '未准备' }}</span></div>
        <button v-if="host" class="primary" :disabled="busy || !readyToStart" @click="run(client.start)">{{ busy ? '正在开局…' : readyToStart ? '开始无限场' : '等待至少两位真人准备' }}</button>
        <button v-else class="primary" :disabled="status !== 'online'" @click="client.act('ready', { ready: !room.seats[mySeat]?.ready })">{{ room.seats[mySeat]?.ready ? '取消准备' : '准备好了' }}</button>
        <button class="nearby-link" @click="confirming = true">{{ host ? '解散房间' : '离开房间' }}</button>
      </div>
    </section>

    <GameTableHud v-if="display?.players.length && display.user" v-bind="display"
      @select-tile="selection = $event" @clear-selection="selection = -1" @discard="pick('discard', $event)"
      @pass="pick('pass')" @peng="pick('peng')" @chi="pick('chi', $event)" @gang-from-discard="pick('gang')"
      @gang="pick('kong', $event)" @hu="pick('win')" @wind-kong="pick('wind-kong')"
      @ming-lou="declaration = declaration === 'ming' ? 'none' : 'ming'" @bao-ting="declaration = declaration === 'ting' ? 'none' : 'ting'"
      @next-round="nextRound" @return-to-lobby="panel = true" @leave-match="confirming = true" />
    <div v-if="declaration !== 'none'" class="declaration-note" role="status">已选择{{ declaration === 'ming' ? '明搂' : '报听' }}，请打出一张可听牌<button @click="declaration = 'none'">取消</button></div>
    <SettlementOverlay v-if="display && !isBlood" v-model:result-visible="resultVisible" :result="display.result" :match-finished="false" :dealer="display.dealer" :waiting-next-round="waiting" game-mode="remote" :continue-countdown="0" match-name="好友无限场" :standings="standings" player-id="" :human-seats="[]" :theme-name="themeName" :joker-tiles="display.jokerTiles" :wildcard-tiles="display.wildcardTiles" @next-round="nextRound" @return-to-lobby="panel = true" />

    <div v-if="panel && room" class="nearby-shade" @click.self="panel = false"><section class="nearby-dialog" role="dialog" aria-modal="true" aria-label="房间管理"><button class="dialog-close" aria-label="关闭房间管理" @click="panel = false">×</button><p class="eyebrow">房间管理</p><h2>{{ getRuleVariant(room.settings.rule).name }}</h2><p>{{ notice }}</p><div v-for="seat in room.seats" :key="seat.seat" class="nearby-seat"><b>{{ ['东', '南', '西', '北'][seat.seat] }} · {{ seat.name }}</b><span>{{ seat.bot ? 'AI' : seat.online ? '在线' : '等待重连' }}</span></div><label v-if="host" class="switch-row"><input type="checkbox" :checked="room.settings.takeover" @change="configureTakeover"><span>掉线后 AI 托管<small>关闭时，轮到离线玩家会等待本人回来</small></span></label><p v-else>掉线托管由房主配置：{{ room.settings.takeover ? '已开启' : '已关闭' }}</p><button v-if="host" class="secondary" @click="showQr">房间二维码</button><button class="danger" @click="confirming = true">{{ host ? '解散房间' : '暂时离开，保留座位' }}</button></section></div>
    <div v-if="qrOpen && invite" class="nearby-shade" @click.self="qrOpen = false"><section class="nearby-dialog qr-dialog" role="dialog" aria-modal="true" aria-label="房间二维码"><button class="dialog-close" aria-label="关闭二维码" @click="qrOpen = false">×</button><div><p class="eyebrow">让朋友打开 App 扫一扫</p><h2>来，坐一桌。</h2><p>先连同一个 Wi-Fi，<br>或让朋友连接你的手机热点。</p><p>{{ room?.started ? '牌局进行中，仅原玩家可重连' : '2–4 人，缺人自动补 AI' }}</p><small>房主：{{ room?.seats[0]?.name }}</small></div><div><img v-if="qr" :src="qr" alt="加入当前麻将房间的二维码"><p v-else>正在生成二维码…</p><details><summary>备用邀请内容</summary><textarea readonly :value="encodeInvitation(invite)" aria-label="房间邀请内容" /></details></div></section></div>
    <div v-if="joining" class="nearby-shade" @click.self="joining = false"><section class="nearby-dialog" role="dialog" aria-modal="true" aria-label="加入附近房间"><button class="dialog-close" aria-label="关闭加入房间" @click="joining = false">×</button><h2>加入朋友的房间</h2><p>请确认已连接房主所在的 Wi-Fi 或热点。</p><textarea v-model="invitationText" placeholder="扫描二维码后自动填入，也可以粘贴房主提供的邀请内容" aria-label="邀请内容" /><button class="primary" :disabled="busy || !invitationText.trim()" @click="join">确认加入</button></section></div>
    <div v-if="confirming" class="nearby-shade"><section class="nearby-dialog" role="dialog" aria-modal="true" aria-label="确认离开"><h2>{{ host ? '解散这张牌桌？' : room?.started ? '暂时离开牌桌？' : '离开房间？' }}</h2><p>{{ host ? '解散后所有玩家回到大厅，本次房间不能恢复。' : room?.started ? '保留你的座位，再次打开附近同桌可恢复牌局。' : '离开后将释放你的座位。' }}</p><div class="nearby-buttons"><button class="secondary" aria-label="关闭离开确认" @click="confirming = false">继续玩</button><button class="danger" :disabled="busy" @click="exitRoom">{{ host ? '确认解散' : '确认离开' }}</button></div></section></div>
    <RulesPanel :open="rulesOpen" :variant="room?.settings.rule ?? settings.rule" @close="rulesOpen = false" />
  </main>
</template>

<style scoped>
.nearby{--n-ink:#163c32;--n-muted:#64776c;--n-line:#dbe4db;--n-green:#246c50;min-height:100dvh;background:radial-gradient(ellipse at 12% 70%,#e0e9dc,transparent 60%),#f6f5ee;color:var(--n-ink);padding:0 4vw 24px;font-family:system-ui,sans-serif}.nearby.at-table{padding:0;background:transparent}.nearby-header{height:68px;display:flex;align-items:center;gap:20px;border-bottom:1px solid var(--n-line)}.nearby-header>div{display:flex;align-items:baseline;gap:12px;flex:1}.nearby-header strong{font-size:23px;letter-spacing:2px}.nearby-header span{font-size:12px;color:var(--n-muted)}button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}.nearby-back,.nearby-link,.nearby-links button{border:0;background:transparent;color:var(--n-green);padding:10px;font-size:13px}.nearby-badge,.round-chip{border:1px solid #b9cdbc;border-radius:24px;padding:6px 13px;font-size:12px}.nearby-entry,.nearby-waiting-room{display:grid;grid-template-columns:1fr 1fr;gap:5vw;max-width:1120px;margin:4vh auto 0;align-items:center}.eyebrow{font-size:11px;letter-spacing:3px;color:var(--n-green);margin:0 0 16px}.nearby h1{font-size:clamp(30px,4.6vw,62px);line-height:1.2;letter-spacing:1px;margin:0 0 20px;font-weight:600}.nearby-intro>p:not(.eyebrow),.room-summary p{line-height:1.8;color:var(--n-muted);font-size:14px}.nearby-features{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.nearby-features span{border-left:2px solid #b5cab5;padding-left:10px;font-size:12px}.nearby-card{background:#fffffff0;border:1px solid var(--n-line);padding:26px;border-radius:20px;box-shadow:0 16px 50px #3659400a}.setup-card{display:grid;gap:15px}.nearby label:not(.switch-row){display:grid;gap:7px;font-size:12px;font-weight:600}.nearby input:not([type=checkbox]),.nearby select,.nearby textarea{width:100%;box-sizing:border-box;border:1px solid var(--n-line);border-radius:10px;padding:10px 12px;background:#f9faf6;color:var(--n-ink);min-height:42px}.nearby textarea{min-height:100px;resize:vertical;font-size:11px}.nearby input:focus,.nearby select:focus,.nearby textarea:focus{outline:2px solid #5a9a78;outline-offset:2px}.switch-row{display:flex;align-items:center;gap:10px;font-size:13px;line-height:1.5}.switch-row input{accent-color:var(--n-green);width:19px;height:19px;flex-shrink:0}.nearby small{display:block;color:var(--n-muted);font-size:11px;font-weight:400;line-height:1.5}.nearby-buttons{display:flex;gap:10px}.nearby .primary,.nearby .secondary,.nearby .danger{border-radius:10px;padding:12px 16px;font-size:13px;font-weight:600;min-height:44px;border:1px solid transparent}.nearby .primary{background:var(--n-green);color:white;flex:1}.nearby .secondary{background:#eaf0e7;color:var(--n-green);border-color:#d3e0d3}.nearby .danger{background:#f5e7e1;color:#913e34}.nearby-links{display:flex;justify-content:space-between}.nearby-links button{padding:0;font-size:11px}.nearby-inline{display:flex;gap:12px;align-items:center}.nearby-inline>*{flex:1}.nearby-seat{display:flex;align-items:center;gap:14px;min-height:68px;border-bottom:1px solid var(--n-line)}.nearby-seat>div{flex:1}.nearby-seat b{font-size:14px}.seat-wind{display:grid;place-items:center;width:38px;height:44px;border-radius:8px;background:#eef2e8;font-size:23px;color:#6c826d;border-bottom:3px solid #cad7c5}.seat-state{font-size:11px;color:var(--n-muted)}.seat-state.ready{color:var(--n-green)}.seats-card>.primary{width:100%;margin-top:20px}.seats-card>.nearby-link{display:block;margin:8px auto 0}.room-summary h1{font-size:32px}.room-summary .switch-row{margin-top:16px}.nearby-status{font-size:11px;line-height:1.5;margin:8px 0;color:var(--n-muted);text-align:center}.nearby-status.waiting{color:#926533;background:#fff2d8;border-radius:6px;padding:6px}.nearby-error{position:fixed;z-index:400;left:10%;right:10%;top:10px;background:#fff0e9;color:#983d25;border:1px solid #dfb6a0;border-radius:10px;padding:12px 38px 12px 16px;font-size:13px}.nearby-error button{position:absolute;right:8px;top:8px;border:0;background:transparent;color:inherit;font-size:20px}.nearby-shade{position:fixed;inset:0;z-index:350;background:#081f19a6;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)}.nearby-dialog{position:relative;background:#fffef8;border-radius:20px;padding:30px;width:min(500px,90vw);max-height:85dvh;overflow:auto;box-shadow:0 25px 100px #0003}.nearby-dialog h2{font-size:25px;margin:8px 0 14px}.nearby-dialog p{font-size:13px;line-height:1.7;color:var(--n-muted)}.nearby-dialog>.primary,.nearby-dialog>.secondary,.nearby-dialog>.danger{margin-top:16px;width:100%}.nearby-dialog>.switch-row{margin-top:16px}.nearby-dialog .nearby-seat{justify-content:space-between;font-size:12px}.dialog-close{position:absolute;right:13px;top:8px;width:36px;height:36px;border:0;background:transparent;color:var(--n-muted);font-size:26px}.qr-dialog{display:grid;grid-template-columns:1fr 1fr;gap:24px;width:min(670px,90vw);align-items:center}.qr-dialog h2{font-size:34px}.qr-dialog img{width:100%;max-height:55dvh;object-fit:contain;background:white;border:1px solid var(--n-line);border-radius:12px}.qr-dialog summary{font-size:11px;color:var(--n-muted);margin-top:8px;cursor:pointer}.declaration-note{position:fixed;z-index:90;bottom:125px;left:50%;transform:translateX(-50%);padding:8px 16px;background:#f8f3dd;border-radius:10px;color:var(--n-ink);font-size:12px;white-space:nowrap}.declaration-note button{margin-left:12px;background:none;border:0;color:#a74f36}.at-table .nearby-header{height:40px;padding:0 16px;background:#f8f8f0f0;position:relative;z-index:70}.at-table .nearby-header strong{font-size:17px}.at-table .nearby-header span{font-size:10px}.at-table>.nearby-status{position:absolute;top:42px;left:25%;right:25%;z-index:65;padding:4px;background:#fff9e9e8;pointer-events:none;border-radius:8px}.at-table .nearby-back{padding:6px 10px}
@media(max-height:550px){.nearby{padding:0 3vw 12px}.nearby-header{height:48px}.nearby-entry,.nearby-waiting-room{margin-top:12px;gap:3vw}.nearby-card{padding:17px;border-radius:14px}.setup-card{gap:9px}.nearby input:not([type=checkbox]),.nearby select{min-height:36px;padding:7px 10px}.nearby h1{font-size:36px;margin-bottom:12px}.nearby-intro>p:not(.eyebrow){font-size:12px}.nearby-features{margin-top:18px}.nearby-seat{min-height:52px}.nearby-dialog{padding:22px;max-height:80dvh}.qr-dialog img{max-height:65dvh}.room-summary h1{font-size:26px}}
@media(max-width:600px) and (min-height:551px){.nearby-entry,.nearby-waiting-room{grid-template-columns:1fr;margin-top:24px;gap:24px}.nearby-intro h1 br{display:none}.nearby-header>div{display:block}.nearby-header strong{display:block}.qr-dialog{grid-template-columns:1fr}.qr-dialog img{max-height:40dvh}.nearby-intro p br{display:none}}
.nearby.at-table{background:var(--theme-page-background);color:var(--theme-text)}
.nearby:not(.at-table){height:100vh;height:100dvh;overflow-y:auto}
.nearby-dialog{max-height:85vh;max-height:85dvh}
.qr-dialog img{max-height:65vh;max-height:65dvh}
.nearby-dialog,.at-table .nearby-header{color:var(--n-ink)}
.at-table .nearby-header{position:absolute;top:0;left:0;right:0;gap:8px;height:36px;background:none;border:0;pointer-events:none}
.at-table .nearby-header>div{display:none}
.at-table .nearby-header .nearby-back{pointer-events:auto;color:var(--theme-text);background:#0a211bdb;border:1px solid #e3d8a22b;border-radius:8px;font-size:12px}
.at-table .round-chip{margin-right:auto;background:#0a211bdb;color:var(--theme-text);border-color:#e3d8a22b;font-size:12px}
</style>
