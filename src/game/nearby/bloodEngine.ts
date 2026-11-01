import type { NearbySettings, RoomSeat, Choice } from './protocol'
import { DecisionBroker } from './decisions'
import type { NearbyEngine, RoundJournal } from './roomEngine'
import type { BloodFlowSeatView } from '../variants/lotus/bloodFlow/seatView'
import { defaultAvatarForSeat } from '../core/presentation/avatar'

export function createNearbyBloodEngine(settings: NearbySettings, seats: RoomSeat[], broker: DecisionBroker, changed: () => void): NearbyEngine {
  const worker = new Worker(new URL('./bloodWorker.ts', import.meta.url), { type: 'module' })
  let serial = 0, closed = false, generation = 0, ticking = false
  let journal: RoundJournal
  let views: BloodFlowSeatView[] = []
  const windows = ['', '', '', '']
  const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>()
  const call = (op: string, args: object = {}) => new Promise<any>((resolve, reject) => {
    if (closed) { reject(new Error('Room closed')); return }
    const id = ++serial; pending.set(id, { resolve, reject }); worker.postMessage({ id, op, ...args })
  })
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id); if (!request) return
    pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result)
  }
  worker.onerror = () => { pending.forEach(p => p.reject(new Error('血流引擎不可用'))); pending.clear(); broker.onError(new Error('血流引擎不可用，请重开 App 恢复房间')) }
  function update(next: BloodFlowSeatView[]) {
    if (closed) return
    views = next
    for (let seat = 0; seat < 4; seat++) {
      const view = views[seat]
      view.players.forEach((p, i) => { p.name = seats[i].name; p.avatar = defaultAvatarForSeat(i); p.playerKind = seats[i].bot ? 'bot' : 'human' })
      const key = view.ownActions.length ? `${view.window!.id}/${view.ownActions.map(a => JSON.stringify(a)).join(',')}` : ''
      if (windows[seat] === key) continue
      windows[seat] = key; broker.resetSeat(seat)
      if (!key) continue
      const choices = view.ownActions.map(action => {
        const choice: Omit<Choice, 'id'> = { ...action } as any
        if (action.kind === 'discard') { choice.handIndex = action.index; choice.tile = view.players[seat].hand[action.index] }
        if (action.kind === 'added-kong') choice.tile = view.players[seat].melds[action.meldIndex].tile
        if (action.kind === 'chi') choice.meld = { tiles: action.tiles, kind: 'sequence' }
        return { choice, value: action }
      })
      const method = `blood:${view.window!.id}`, epoch = generation
      void broker.request(seat, method, choices, () => call('choose', { seat }), { tile: view.window!.source.tile, from: view.window!.source.seat })
        .then(action => {
          if (closed || epoch !== generation) return
          return call('action', { seat, method, action }).then(update)
        }).catch(e => { if (!closed) broker.onError(e) })
    }
    changed()
  }
  const timer = setInterval(async () => {
    if (closed || ticking || !views.length) return
    // Publish again when a win animation's window becomes actionable.
    if (views.every(v => !v.window || v.ownActions.length || v.window.opensAt <= Date.now() - 500)) return
    ticking = true
    try { update(await call('view')) } catch (e) { if (!closed) broker.onError(e as Error) }
    finally { ticking = false }
  }, 200)
  return {
    settled: () => !!views[0]?.public.roundResult,
    scores: () => views[0]?.players.map(p => p.score) ?? [2000, 2000, 2000, 2000],
    view: seat => ({ blood: views[seat] ? { view: views[seat], round: journal.number, dealer: journal.opening.dealer,
      continuation: { readySeats: seats.filter(s => s.continued).map(s => s.seat), requiredSeats: seats.filter(s => !s.bot && (s.online || !settings.takeover)).map(s => s.seat) } } : null,
      decision: broker.decisions[seat] }),
    start: async next => {
      journal = next; generation++; broker.reset(); broker.replay = []; broker.replayIndex = 0; windows.fill('')
      update(await call('start', { journal }))
    },
    close: () => { closed = true; generation++; clearInterval(timer); worker.terminate(); pending.forEach(p => p.reject(new Error('Room closed'))); pending.clear(); broker.reset() },
  }
}
