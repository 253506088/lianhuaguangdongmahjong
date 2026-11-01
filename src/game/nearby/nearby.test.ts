import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NEARBY_SETTINGS, encodeInvitation, parseInvitation, randomId, roundLabel, type RoomSeat, type NearbySettings } from './protocol'
import { DecisionBroker, type JournalAction } from './decisions'
import { legalChoices } from './controllers'
import { createNearbyEngine, newRound } from './roomEngine'
import { createNearbyBloodRuntime } from './bloodRuntime'
import { createShandongTurnOrchestrator } from '../variants/shandong/shandongTurnOrchestrator'
import { createShandongGameState } from '../variants/shandong/shandongState'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const seats = (): RoomSeat[] => [0, 1, 2, 3].map(seat => ({ seat, name: `Player ${seat}`, bot: false, online: true, ready: true, continued: false }))
const settings = (rule: NearbySettings['rule']): NearbySettings => ({ ...DEFAULT_NEARBY_SETTINGS, rule })
const pause = () => vi.advanceTimersByTimeAsync(10)
async function startWithTimers(engine: ReturnType<typeof createNearbyEngine>, journal: ReturnType<typeof newRound>) {
  let complete = false
  const started = engine.start(journal).then(() => { complete = true })
  for (let i = 0; i < 1000 && !complete; i++) await pause()
  await started
}

describe('nearby invitation and infinite rounds', () => {
  it('round-trips a pinned LAN invitation and rejects public addresses, bad versions and malformed keys', () => {
    const invite = { v: 1 as const, room: randomId(), key: randomId(), hosts: ['192.168.43.1'], port: 35000, fingerprint: 'a'.repeat(64) }
    expect(parseInvitation(encodeInvitation(invite))).toEqual(invite)
    for (const patch of [{ hosts: ['example.com'] }, { hosts: ['8.8.8.8'] }, { hosts: ['192.168.0.999'] }, { port: -1 }, { key: '' }, { v: 2 }, { fingerprint: 'xyz' }]) {
      expect(() => parseInvitation(encodeInvitation({ ...invite, ...patch } as any))).toThrow()
    }
    expect(() => parseInvitation('https://example.com')).toThrow()
  })
  it('rotates East South West North forever with no four/eight-hand ceiling', () => {
    expect([1, 5, 9, 13, 17].map(roundLabel)).toEqual(['东1局 · 第1轮', '南1局 · 第1轮', '西1局 · 第1轮', '北1局 · 第1轮', '东1局 · 第2轮'])
    for (let i = 1; i <= 100; i++) expect(newRound(i, settings('shandong')).opening.dealer).toBe((i - 1) % 4)
  })
})

describe('single-use authority decisions', () => {
  it('never times out a human, rejects forged/stale/duplicate commands, and persists before applying', async () => {
    const b = new DecisionBroker(10), applied = vi.fn(), saved = vi.fn()
    b.onAction = saved
    void b.request<{ kind: string; handIndex?: number }>(2, 'requestTurn', [{ choice: { kind: 'discard', handIndex: 0 }, value: { kind: 'discard', handIndex: 0 } }], async () => ({ kind: 'win' })).then(applied)
    const d = b.decisions[2]!
    await vi.advanceTimersByTimeAsync(600_000)
    expect(applied).not.toHaveBeenCalled()
    expect(b.submit(1, d.id, '0')).toBe(false)
    expect(b.submit(2, d.id, '999')).toBe(false)
    expect(b.submit(2, 'old', '0')).toBe(false)
    expect(b.submit(2, d.id, '0')).toBe(true)
    expect(saved).toHaveBeenCalledOnce()
    expect(b.submit(2, d.id, '0')).toBe(false)
    await pause(); expect(applied).toHaveBeenCalledOnce()
  })
  it('takes over a pending claim only when enabled and cancels an in-flight bot when the player reconnects', async () => {
    const b = new DecisionBroker(10), applied = vi.fn()
    let auto = false, resolve!: (v: { kind: string }) => void
    b.automated = () => auto
    void b.request(1, 'requestClaim', [{ choice: { kind: 'pass' }, value: { kind: 'pass' } }], () => new Promise(r => { resolve = r })).then(applied)
    await vi.advanceTimersByTimeAsync(50_000); expect(applied).not.toHaveBeenCalled()
    auto = true; b.refresh(); await pause()
    auto = false; resolve({ kind: 'peng' }); await pause()
    expect(applied).not.toHaveBeenCalled()
    expect(b.submit(1, b.decisions[1]!.id, '0')).toBe(true)
    await pause(); expect(applied).toHaveBeenCalledWith({ kind: 'pass' })
  })
  it('rejects commands from the previous round even when their choice index is reused', async () => {
    const b = new DecisionBroker()
    void b.request(0, 'requestTurn', [{ choice: { kind: 'win' }, value: 'win' }], async () => 'win')
    const old = b.decisions[0]!.id; b.reset()
    void b.request(0, 'requestTurn', [{ choice: { kind: 'win' }, value: 'win' }], async () => 'win')
    expect(b.submit(0, old, '0')).toBe(false)
  })
})

describe('real game engines in nearby rooms', () => {
  it.each([0, 1])('Shandong seat %i waits for its controller after declaring ting instead of auto-discarding', async seat => {
    const state = createShandongGameState()
    state.players.push(...[0, 1, 2, 3].map(index => ({ name: `Player ${index}`, avatar: '', score: 2000, seat: index,
      hand: ['m1', 'm2', 'm4', 'p1', 'p2', 'p4', 's1', 's2', 's4', 'east', 'south', 'west', 'north', 'green'] as any,
      discards: [], melds: [], redCount: 0, drawnTileIndex: 13 })))
    state.baoTingPlayers.value.add(seat)
    let resolve!: (action: any) => void
    const requestTurn = vi.fn(() => new Promise<any>(r => { resolve = r })), discardTile = vi.fn()
    const turn = createShandongTurnOrchestrator({ state, controllerDrivenLockedTurns: true,
      controllers: [0, 1, 2, 3].map(() => ({ requestTurn })) as any,
      drawFor: async () => true, discardTile, endDraw: vi.fn(), endGame: vi.fn(), announce: vi.fn(), showTableAction: vi.fn(),
      playSound: vi.fn(), playSoundAndWait: async () => {}, wait: async () => {}, later: () => 0,
    })
    const pending = turn.beginTurn(seat, { skipDraw: true })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(requestTurn).toHaveBeenCalledOnce(); expect(discardTile).not.toHaveBeenCalled()
    resolve({ kind: 'discard', handIndex: 13 }); await pending
    expect(discardTile).toHaveBeenCalledWith(seat, 13)
  })
  for (const rule of ['lotus-classic', 'lotus-legacy', 'shandong'] as const) {
    it(`${rule}: four private views, legal human decisions, deterministic restart, and continued scores after round 16`, async () => {
      const config = settings(rule), b = new DecisionBroker(1), members = seats()
      const journal = newRound(16, config)
      const engine = createNearbyEngine(config, members, b, () => {})
      b.onAction = a => journal.actions.push(structuredClone(a))
      await engine.start(journal); await pause()
      for (let step = 0; step < 20 && !engine.settled(); step++) {
        const seat = b.decisions.findIndex(Boolean)
        if (seat < 0) { await pause(); continue }
        const d = b.decisions[seat]!
        const choice = d.choices.find(c => c.kind === 'win') ?? d.choices.find(c => c.kind === 'pass') ?? d.choices.find(c => c.kind === 'discard' && !c.declareBaoTing && !c.declareMingLou) ?? d.choices[0]
        b.submit(seat, d.id, choice.id); await pause()
      }
      expect(journal.actions.length).toBeGreaterThan(0)
      const before = [0, 1, 2, 3].map(seat => engine.view(seat).table!)
      for (let seat = 0; seat < 4; seat++) {
        expect(before[seat].players[0].seat).toBe(seat)
        expect(before[seat].players[0].hand.length).toBeGreaterThan(0)
        if (!engine.settled()) expect(before[seat].players.slice(1).every(p => !p.hand.length)).toBe(true)
        expect(before[seat].wall).toEqual([])
      }
      const checkpoint = structuredClone(journal)
      engine.close()
      const resumedBroker = new DecisionBroker(1)
      const resumed = createNearbyEngine(config, members, resumedBroker, () => {})
      await startWithTimers(resumed, checkpoint)
      for (let i = 0; i < 100 && resumedBroker.replayIndex < checkpoint.actions.length; i++) await pause()
      await pause()
      expect(resumedBroker.replayIndex).toBe(checkpoint.actions.length)
      for (let seat = 0; seat < 4; seat++) {
        const after = resumed.view(seat).table!
        expect(after.players).toEqual(before[seat].players)
        expect(after.wallCount).toBe(before[seat].wallCount)
        expect(after.currentPlayer).toBe(before[seat].currentPlayer)
      }
      for (let step = 0; step < 800 && !resumed.settled(); step++) {
        for (let seat = 0; seat < 4; seat++) {
          const d = resumedBroker.decisions[seat]; if (!d) continue
          const choice = d.choices.find(c => c.kind === 'win') ?? d.choices.find(c => c.kind === 'pass') ?? d.choices.find(c => c.kind === 'discard' && !c.declareBaoTing && !c.declareMingLou) ?? d.choices[0]
          resumedBroker.submit(seat, d.id, choice.id)
        }
        await pause()
      }
      expect(resumed.settled()).toBe(true)
      expect(resumed.scores().reduce((a, b) => a + b)).toBe(8000)
      const scores = resumed.scores()
      await resumed.start(newRound(17, config, scores)); await pause()
      expect(resumed.scores()).toEqual(scores)
      expect(resumed.view(0).table!.dealer).toBe(0)
      expect(resumed.view(0).table!.matchFinished).toBe(false)
      expect(resumed.view(0).table!.roundLabel).toContain('第2轮')
      resumed.close()
    }, 60_000)
  }
  it('Shandong locked hands can only discard the drawn tile and cannot secretly switch tiles', () => {
    const choices = legalChoices(settings('shandong'), 'requestTurn', { hand: ['m1', 'm2', 'm3', 'p4'], melds: [], isBaoTing: true })
    expect(choices.filter(c => c.choice.kind === 'discard').map(c => c.choice.handIndex)).toEqual([3])
  })
  it('blood flow never expires human windows, hides opponents, replays a mid-round journal, and completes a full round', () => {
    const run = createNearbyBloodRuntime(), config = settings('lotus-blood-flow'), journal = newRound(17, config)
    let views = run({ op: 'start', journal })
    expect(views[0].players.slice(1).every((p: any) => p.hand.length === 0)).toBe(true)
    const initial = views[0].window.id
    vi.advanceTimersByTime(600_000)
    expect(run({ op: 'view' })[0].window.id).toBe(initial)
    for (let i = 0; i < 600 && !views[0].public.roundResult; i++) {
      const view = views.find((v: any) => v.ownActions.length)
      if (!view) { vi.advanceTimersByTime(10_000); views = run({ op: 'view' }); continue }
      const action = view.ownActions.find((a: any) => a.kind === 'win') ?? view.ownActions.find((a: any) => a.kind === 'pass') ?? view.ownActions.find((a: any) => a.kind === 'discard') ?? view.ownActions[0]
      const entry: JournalAction = { seat: view.seat, method: `blood:${view.window.id}`, action }
      journal.actions.push(entry)
      views = run({ op: 'action', ...entry })
      if (i === 20) {
        const restored = createNearbyBloodRuntime()({ op: 'start', journal })
        expect(restored.map((v: any) => v.players)).toEqual(views.map((v: any) => v.players))
        expect(restored[0].wallCount).toBe(views[0].wallCount)
      }
    }
    expect(views[0].public.roundResult).toBeTruthy()
    expect(views[0].players.reduce((sum: number, p: any) => sum + p.score, 0)).toBe(8000)
  }, 60_000)
  it('new blood-flow rooms never reuse presentation/action identities from an earlier room', () => {
    const run = createNearbyBloodRuntime()
    const first = run({ op: 'start', journal: newRound(1, settings('lotus-blood-flow')) })[0]
    const second = run({ op: 'start', journal: newRound(1, settings('lotus-blood-flow')) })[0]
    expect(second.roundId).not.toBe(first.roundId)
    expect(second.authorityEpoch).not.toBe(first.authorityEpoch)
  })
})
