import { AiController } from '../core/controllers/playerController'
import { DEFAULT_RULESET } from '../core/rules/ruleset'
import { LotusAiController } from '../variants/lotus/lotusControllers'
import { LOTUS_RULESET, windKong } from '../variants/lotus/lotusRules'
import { ShandongAiController } from '../variants/shandong/shandongControllers'
import { canConcealedGang, canWinOnSelfDraw, waitingTiles } from '../variants/shandong/shandongRules'
import type { NearbySettings, Choice } from './protocol'
import { DecisionBroker } from './decisions'

type Candidate = Omit<Choice, 'id'>
/** Only called with contexts produced by our rule engines, never network input. */
export function legalChoices(settings: NearbySettings, method: string, ctx: any): Array<{ choice: Candidate; value: any }> {
  const choices: Array<{ choice: Candidate; value: any }> = []
  const add = (choice: Candidate, value: any = choice) => choices.push({ choice, value })
  const shandong = settings.rule === 'shandong'
  if (method === 'requestTurn') {
    const locked = shandong && (ctx.isBaoTing || ctx.isMingLou)
    ctx.hand.forEach((tile: any, handIndex: number) => {
      if (locked && handIndex !== ctx.hand.length - 1) return
      add({ kind: 'discard', handIndex, tile }, { kind: 'discard', handIndex })
      if (shandong && !locked && waitingTiles(ctx.hand.filter((_: any, i: number) => i !== handIndex), ctx.melds, { luanJiang: settings.jiang === 'luan' }).length) {
        add({ kind: 'discard', handIndex, tile, declareBaoTing: true }, { kind: 'discard', handIndex, declareBaoTing: true })
        add({ kind: 'discard', handIndex, tile, declareMingLou: true }, { kind: 'discard', handIndex, declareMingLou: true })
      }
    })
    const rules = settings.rule === 'lotus-legacy' ? LOTUS_RULESET : DEFAULT_RULESET
    const options = { jokers: ctx.jokers ?? ['white'], jokerSubstitutes: ['white'] as any }
    const hu = shandong
      ? locked && canWinOnSelfDraw(ctx.hand, ctx.melds, { luanJiang: settings.jiang === 'luan' })
      : !ctx.skipDraw && rules.win.isWinningHand(ctx.hand, ctx.exposedMelds, options)
    if (hu) add({ kind: 'win' })
    if (!locked) {
      const kongs = shandong ? canConcealedGang(ctx.hand) : rules.win.concealedKongs(ctx.hand, options)
      kongs.forEach(tile => add({ kind: 'concealed-kong', tile }))
      ctx.melds.forEach((meld: any, meldIndex: number) => {
        if (meld.type === 'peng' && ctx.hand.includes(meld.tile)) add({ kind: 'added-kong', meldIndex, tile: meld.tile }, { kind: 'added-kong', meldIndex })
      })
      if (settings.rule === 'lotus-legacy' && windKong(ctx.hand, ctx.jokers)) add({ kind: 'wind-kong' })
    }
  } else if (method === 'requestRobKong') {
    add({ kind: 'win' }, 'win'); add({ kind: 'pass' }, 'pass')
  } else {
    if (method === 'requestHu' || method === 'requestDiscardHu') add({ kind: 'win' }, { kind: shandong ? 'hu' : 'win' })
    if (ctx.canPeng) add({ kind: 'peng' })
    if (ctx.canGang) add({ kind: 'gang' })
    for (const meld of ctx.chiOptions ?? []) add({ kind: 'chi', meld })
    add({ kind: 'pass' })
  }
  return choices
}

export function nearbyControllers(settings: NearbySettings, broker: DecisionBroker, decide?: (method: string, context: any) => Promise<any>) {
  return Array.from({ length: 4 }, (_, seat) => {
    const ai: any = settings.rule === 'shandong' ? new ShandongAiController(0)
      : settings.rule === 'lotus-legacy' ? new LotusAiController({ turn: 0, afterKong: 0, claim: 0 })
        : new AiController({ turn: 0, afterKong: 0, claim: 0 })
    const controller: any = { reset: () => broker.resetSeat(seat), onDiscarded: () => {} }
    for (const method of ['requestTurn', 'requestClaim', 'requestChi', 'requestHu', 'requestDiscardHu', 'requestRobKong']) {
      controller[method] = (ctx: any) => broker.request(seat, method,
        broker.replayIndex < broker.replay.length ? [] : legalChoices(settings, method, ctx),
        () => decide ? decide(method, ctx) : ai[method](ctx), ctx)
    }
    return controller
  })
}
