import { reactive, shallowRef, ref } from 'vue'
import type { NearbyTransport, NativeNearbyEvent } from '../../platform/nearbyBridge'
import { DecisionBroker } from './decisions'
import { createNearbyEngine, newRound, type NearbyEngine, type RoundJournal } from './roomEngine'
import { DEFAULT_NEARBY_SETTINGS, NEARBY_VERSION, randomId, validSettings, type Invitation, type NearbySettings, type RoomView, type RoomSeat, type Decision } from './protocol'
import type { NearbyTableView } from './tableView'

const SAVE_KEY = 'mahjong.nearby.v1'
interface HostSave { role: 'host'; invite: Invitation; room: RoomView; tokens: string[]; journal: RoundJournal | null }
interface GuestSave { role: 'guest'; invite: Invitation; token: string; name: string }
type SavedRoom = HostSave | GuestSave
export interface RoomStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function readNearbySave(storage: RoomStorage = localStorage): SavedRoom | null {
  try {
    const value = JSON.parse(storage.getItem(SAVE_KEY) ?? 'null')
    return value && ['host', 'guest'].includes(value.role) && value.invite?.v === NEARBY_VERSION ? value : null
  } catch { return null }
}

export function createNearbyRoom(transport: NearbyTransport, storage: RoomStorage = localStorage) {
  const room = shallowRef<RoomView | null>(null)
  const table = shallowRef<NearbyTableView | null>(null)
  const blood = shallowRef<any>(null)
  const decision = shallowRef<Decision | null>(null)
  const invite = shallowRef<Invitation | null>(null)
  const status = ref<'idle' | 'connecting' | 'online' | 'reconnecting' | 'closed'>('idle')
  const error = ref('')
  const mySeat = ref(-1)
  const host = ref(false)
  const broker = new DecisionBroker()
  let engine: NearbyEngine | null = null
  let saved: SavedRoom | null = null
  let journal: RoundJournal | null = null
  let tokens: string[] = []
  const bindings = new Map<string, number>()
  const helloTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let stopped = false, generation = 0, revision = 0, lastRevision = -1, connectedAt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let publishTimer: ReturnType<typeof setTimeout> | undefined
  let lastHostFrame = Date.now(), hostAddress = 0, advancing = false, suspended = false
  let closing = false
  let closeComplete: (() => void) | null = null
  const closedSeats = new Set<number>()

  const persist = () => {
    if (host.value && room.value && invite.value) saved = { role: 'host', invite: invite.value, room: room.value, tokens, journal }
    if (saved) storage.setItem(SAVE_KEY, JSON.stringify(saved))
  }
  const send = (peer: string, payload: unknown) => transport.request('send', { peer, data: JSON.stringify(payload) }).catch(() => {})
  const disconnect = (peer: string) => { void transport.request('disconnect', { peer }).catch(() => {}) }
  const snapshot = (seat: number) => ({ kind: 'snapshot', room: room.value, seat, revision, ...(engine?.view(seat) ?? { table: null, decision: null }) })
  const apply = (message: any) => {
    if (message.revision <= lastRevision) return
    lastRevision = message.revision; lastHostFrame = Date.now()
    room.value = message.room; mySeat.value = message.seat
    table.value = message.table ?? null; blood.value = message.blood ?? null; decision.value = message.decision
    clearTimeout(reconnectTimer); reconnectTimer = undefined
    status.value = 'online'; error.value = ''
  }
  function publish() {
    if (stopped || closing || !host.value || !room.value || room.value.recovering) return
    revision++
    const mine = snapshot(0)
    // Host state remains the mutable authority object; don't replace it with a clone.
    table.value = mine.table ?? null; blood.value = 'blood' in mine ? mine.blood : null; decision.value = mine.decision
    for (const [peer, seat] of bindings) void send(peer, snapshot(seat))
  }
  function changed() {
    if (publishTimer || stopped) return
    publishTimer = setTimeout(() => { publishTimer = undefined; publish() }, 60)
  }
  broker.automated = seat => !suspended && !!room.value && !room.value.recovering && (room.value.seats[seat].bot || room.value.settings.takeover && !room.value.seats[seat].online)
  broker.onAction = entry => {
    if (!journal) throw new Error('No round')
    journal.actions.push(entry)
    try { persist() } catch (e) { journal.actions.pop(); throw e }
  }
  broker.onError = e => { error.value = e.message; suspended = true }
  async function buildEngine() {
    if (!room.value || !journal) return
    room.value.recovering = journal.actions.length > 0
    engine?.close()
    if (room.value.settings.rule === 'lotus-blood-flow') {
      const { createNearbyBloodEngine } = await import('./bloodEngine')
      engine = createNearbyBloodEngine(room.value.settings, room.value.seats, broker, changed)
    } else engine = createNearbyEngine(room.value.settings, room.value.seats, broker, changed)
    await engine.start(journal)
    room.value.recovering = false; broker.refresh()
    changed()
  }
  async function maybeAdvance() {
    if (advancing || suspended || !room.value?.started || !engine?.settled() || !journal) return
    if (!room.value.seats.every(s => s.bot || s.continued || !s.online && room.value!.settings.takeover)) return
    advancing = true
    try {
      journal = newRound(journal.number + 1, room.value.settings, engine.scores())
      room.value.round = journal.number; room.value.seats.forEach(s => { s.continued = false })
      persist(); await engine.start(journal); publish()
    } catch (e) { error.value = String(e); suspended = true }
    finally { advancing = false }
  }
  function command(seat: number, message: any) {
    const state = room.value
    if (!state || closing || suspended || message.room !== state.id) return
    const member = state.seats[seat]
    if (message.kind === 'action' && state.started) broker.submit(seat, message.decision, message.choice)
    else if (message.kind === 'ready' && !state.started && typeof message.ready === 'boolean') { member.ready = message.ready; persist() }
    else if (message.kind === 'continue' && message.round === state.round && engine?.settled()) { member.continued = true; persist(); void maybeAdvance() }
    else if (message.kind === 'away' && typeof message.away === 'boolean') { member.online = !message.away; broker.refresh(seat); void maybeAdvance() }
    else if (message.kind === 'leave' && !state.started && seat !== 0) {
      state.seats[seat] = emptySeat(seat); tokens[seat] = ''
      for (const [peer, bound] of bindings) if (bound === seat) { bindings.delete(peer); disconnect(peer) }
      persist()
    }
    changed()
  }
  function emptySeat(seat: number): RoomSeat { return { seat, name: '普通 AI', bot: true, online: false, ready: false, continued: false } }
  async function receive(peer: string, raw: string) {
    let message: any
    try { if (raw.length > 600_000) return; message = JSON.parse(raw) } catch { return }
    if (!message || typeof message !== 'object') return
    if (!host.value) {
      if (peer !== 'host') return
      lastHostFrame = Date.now()
      if (message.kind === 'welcome' && saved?.role === 'guest' && typeof message.token === 'string') { saved.token = message.token; persist() }
      else if (message.kind === 'snapshot' && message.room?.id === invite.value?.room && Number.isInteger(message.revision)) apply(message)
      else if (message.kind === 'closed') {
        status.value = 'closed'; error.value = '房主已解散房间'; saved = null; storage.removeItem(SAVE_KEY)
        room.value = null; table.value = null; blood.value = null; decision.value = null
        await send('host', { kind: 'closed-ack', room: invite.value?.room })
        stopNetwork()
      }
      else if (message.kind === 'error') { error.value = String(message.message); stopNetwork(); status.value = 'closed' }
      return
    }
    if (message.kind === 'hello') {
      if (message.v !== NEARBY_VERSION || message.room !== room.value?.id || message.key !== invite.value?.key) {
        await send(peer, { kind: 'error', message: '房间邀请无效或版本不兼容，请重新扫码' }); disconnect(peer); return
      }
      if (closing) {
        const seat = typeof message.token === 'string' ? tokens.indexOf(message.token) : -1
        if (seat > 0) bindings.set(peer, seat)
        await send(peer, { kind: 'closed' }); return
      }
      // Repeating hello on an authenticated socket must never consume another seat.
      let seat = bindings.get(peer) ?? (typeof message.token === 'string' && message.token ? tokens.indexOf(message.token) : -1)
      if (seat === 0) { disconnect(peer); return }
      if (seat < 0) {
        if (room.value!.started) { await send(peer, { kind: 'error', message: '牌局已开始，只允许原玩家重连' }); disconnect(peer); return }
        seat = room.value!.seats.findIndex((s, i) => i > 0 && s.bot)
        if (seat < 0) { await send(peer, { kind: 'error', message: '房间已满' }); disconnect(peer); return }
        const name = typeof message.name === 'string' ? message.name.trim().slice(0, 16) : ''
        room.value!.seats[seat] = { seat, name: name || `朋友${seat}`, bot: false, online: true, ready: false, continued: false }
        tokens[seat] = randomId()
      }
      for (const [oldPeer, oldSeat] of bindings) if (oldSeat === seat && oldPeer !== peer) { bindings.delete(oldPeer); disconnect(oldPeer) }
      bindings.set(peer, seat)
      clearTimeout(helloTimers.get(peer)); helloTimers.delete(peer)
      room.value!.seats[seat].online = true
      persist()
      await send(peer, { kind: 'welcome', token: tokens[seat] })
      broker.refresh(seat); publish(); return
    }
    const seat = bindings.get(peer)
    if (message.kind === 'closed-ack' && seat !== undefined && message.room === room.value?.id) {
      closedSeats.add(seat)
      if (room.value!.seats.every(s => s.seat === 0 || s.bot || !s.online || closedSeats.has(s.seat))) closeComplete?.()
      return
    }
    if (seat !== undefined) command(seat, message)
  }
  function scheduleReconnect() {
    if (stopped || host.value || !saved || status.value === 'closed' || reconnectTimer) return
    status.value = 'reconnecting'
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void connectGuest() }, 2000)
  }
  async function connectGuest() {
    if (stopped || saved?.role !== 'guest' || !invite.value) return
    const current = generation
    connectedAt = Date.now()
    try {
      const hosts = invite.value.hosts
      await transport.request('join', { host: hosts[hostAddress++ % hosts.length], port: invite.value.port, fingerprint: invite.value.fingerprint })
      if (current !== generation) return
      // Native connected is emitted only after TLS has verified the pinned host.
    } catch (e) { if (current === generation) { error.value = (e as Error).message; scheduleReconnect() } }
  }
  const unsubscribe = transport.subscribe((event: NativeNearbyEvent) => {
    if (stopped) return
    if (event.event === 'connectionError') { if (status.value !== 'closed') error.value = event.data; return }
    if (event.event === 'message') { void receive(event.peer, event.data).catch(e => { error.value = String(e) }); return }
    if (event.event === 'connected') {
      if (host.value) {
        helloTimers.set(event.peer, setTimeout(() => { helloTimers.delete(event.peer); disconnect(event.peer) }, 10_000))
      } else if (saved?.role === 'guest') {
        clearTimeout(reconnectTimer); reconnectTimer = undefined
        lastRevision = -1; lastHostFrame = Date.now()
        void send('host', { kind: 'hello', v: NEARBY_VERSION, room: saved.invite.room, key: saved.invite.key, name: saved.name, token: saved.token })
      }
    } else if (event.event === 'disconnected') {
      if (host.value) {
        clearTimeout(helloTimers.get(event.peer)); helloTimers.delete(event.peer)
        const seat = bindings.get(event.peer)
        if (seat !== undefined && room.value) { bindings.delete(event.peer); room.value.seats[seat].online = false; broker.refresh(seat); changed(); void maybeAdvance() }
      } else scheduleReconnect()
    } else if (event.event === 'background' || event.event === 'foreground') {
      const away = event.event === 'background'
      if (room.value) {
        if (host.value) command(0, { kind: 'away', room: room.value.id, away })
        else if (status.value === 'online') void send('host', { kind: 'away', room: room.value.id, away })
        else if (!away) scheduleReconnect()
      }
    }
  })
  const pulse = setInterval(() => {
    if (stopped) return
    if (host.value && !closing) {
      // Liveness is tiny; don't recompute four hands' wait hints while everyone
      // is chatting or deciding. Real state changes publish full private views.
      for (const peer of bindings.keys()) void send(peer, { kind: 'alive' })
      broker.refresh(); void maybeAdvance()
    }
    else if ((status.value === 'online' && Date.now() - lastHostFrame > 12_000) || (status.value === 'connecting' && Date.now() - connectedAt > 12_000)) scheduleReconnect()
  }, 3000)
  function stopNetwork() {
    stopped = true; generation++
    clearTimeout(reconnectTimer); reconnectTimer = undefined
    clearTimeout(publishTimer); publishTimer = undefined
    helloTimers.forEach(clearTimeout); helloTimers.clear()
    void transport.request('stop').catch(() => {})
  }
  async function create(name: string, settings: NearbySettings = DEFAULT_NEARBY_SETTINGS) {
    if (!validSettings(settings)) throw new Error('无效房间设置')
    host.value = true; stopped = false; status.value = 'connecting'; mySeat.value = 0
    closing = false; suspended = false; bindings.clear(); closedSeats.clear()
    let address: any
    try { address = await transport.request('host') }
    catch (e) { stopNetwork(); status.value = 'idle'; host.value = false; throw e }
    invite.value = { v: 1, room: randomId(), key: randomId(), ...address }
    room.value = reactive({ id: invite.value.room, settings: { ...settings }, seats: [0, 1, 2, 3].map(emptySeat), started: false, round: 1, recovering: false })
    room.value.seats[0] = { seat: 0, name: name.trim().slice(0, 16) || '房主', bot: false, online: true, ready: true, continued: false }
    tokens = [randomId(), '', '', '']; journal = null; persist(); status.value = 'online'; publish()
  }
  async function join(invitation: Invitation, name: string) {
    stopped = false; host.value = false; invite.value = invitation; status.value = 'connecting'
    const previous = readNearbySave(storage)
    const token = previous?.role === 'guest' && previous.invite.room === invitation.room && previous.invite.key === invitation.key && previous.invite.fingerprint === invitation.fingerprint ? previous.token : ''
    saved = { role: 'guest', invite: invitation, name: name.trim().slice(0, 16) || '朋友', token }
    persist(); await connectGuest()
  }
  async function resume() {
    saved = readNearbySave(storage)
    if (!saved) throw new Error('没有可恢复的房间')
    stopped = false; invite.value = saved.invite
    if (saved.role === 'guest') { host.value = false; status.value = 'connecting'; await connectGuest(); return }
    host.value = true; mySeat.value = 0; status.value = 'connecting'; tokens = saved.tokens; journal = saved.journal
    room.value = reactive(saved.room)
    room.value.seats.forEach(s => { s.online = s.seat === 0 })
    room.value.recovering = !!journal
    const address = await transport.request('host', { port: invite.value.port })
    invite.value = { ...invite.value, ...address }; persist()
    if (journal) await buildEngine()
    room.value.recovering = false; status.value = 'online'; publish()
  }
  async function start() {
    if (!host.value || !room.value || room.value.started) return
    const humans = room.value.seats.filter(s => !s.bot)
    if (humans.length < 2 || humans.some(s => !s.online || !s.ready)) throw new Error('至少两位真人入座，所有玩家准备后即可开始')
    room.value.started = true; journal = newRound(1, room.value.settings); persist(); await buildEngine(); publish()
  }
  function act(kind: string, extra: Record<string, unknown> = {}) {
    if (status.value !== 'online' || !room.value) return
    const message = { kind, room: room.value.id, ...extra }
    if (host.value) command(0, message)
    else void send('host', message)
  }
  function configure(settings: NearbySettings) {
    if (!host.value || !room.value || !validSettings(settings)) return
    if (room.value.started && (settings.rule !== room.value.settings.rule || settings.jiang !== room.value.settings.jiang || settings.chi !== room.value.settings.chi)) return
    Object.assign(room.value.settings, settings)
    if (!room.value.started) room.value.seats.forEach(s => { if (s.seat !== 0) s.ready = false })
    persist(); broker.refresh(); changed(); void maybeAdvance()
  }
  async function refreshInvitation() {
    if (!host.value || !invite.value) return
    const hosts = await transport.request<string[]>('addresses')
    if (!hosts.length) throw new Error('请重新连接 Wi-Fi 或打开手机热点')
    invite.value = { ...invite.value, hosts }; persist()
  }
  async function leave(dissolve = false) {
    if (host.value && !dissolve) { error.value = '房主退出需要先解散房间'; return }
    if (host.value) {
      closing = true; closedSeats.clear()
      let timer: ReturnType<typeof setTimeout>
      const acknowledged = new Promise<void>(resolve => {
        closeComplete = resolve
        timer = setTimeout(resolve, 5000)
      })
      await Promise.all([...bindings.keys()].map(peer => send(peer, { kind: 'closed' })))
      if (!room.value?.seats.some(s => s.seat > 0 && !s.bot)) closeComplete?.()
      await acknowledged
      clearTimeout(timer!); closeComplete = null
    }
    else if (room.value && !room.value.started) await send('host', { kind: 'leave', room: room.value.id })
    else if (room.value) await send('host', { kind: 'away', room: room.value.id, away: true })
    if (host.value || !room.value?.started) { saved = null; storage.removeItem(SAVE_KEY) }
    stopNetwork(); engine?.close(); engine = null; room.value = null; table.value = null; blood.value = null; decision.value = null; status.value = 'idle'
  }
  function dispose() { stopNetwork(); unsubscribe(); clearInterval(pulse); engine?.close() }
  return { room, table, blood, decision, invite, status, error, mySeat, host, create, join, resume, start, act, configure, refreshInvitation, leave, dispose }
}
