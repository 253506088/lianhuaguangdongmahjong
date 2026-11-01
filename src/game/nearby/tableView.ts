import type { GamePort, ActionPrompt } from '../core/contracts/gamePort'
import type { GamePlayer, TileType } from '../core/contracts/types'
import type { Decision, NearbySettings } from './protocol'
import { roundLabel } from './protocol'
import { createRulePlayerSelectors } from '../shared/selectors/gameSelectors'
import { DEFAULT_RULESET } from '../core/rules/ruleset'
import { LOTUS_RULESET } from '../variants/lotus/lotusRules'
import { waitingTiles as shandongWaits } from '../variants/shandong/shandongRules'
import { TILE_TYPES } from '../core/rules/tiles'

export function nearbyTableView(game: GamePort, seat: number, decision: Decision | null, settings: NearbySettings, cache = new Map<string, TileType[]>()) {
  const rotate = (n: number) => n == null || n < 0 ? n : (n - seat + 4) % 4
  const players: GamePlayer[] = Array.from({ length: game.players.length }, (_, i) => {
    const p = game.players[(i + seat) % 4]
    return {
      ...p,
      // Preserve absolute wind; array order and event indices are viewer-relative.
      hand: i === 0 || game.revealHands.value || p.isMingLou ? [...p.hand] : [],
      concealedTileCount: p.hand.length,
      melds: p.melds.map(m => ({ ...m, from: m.from == null ? undefined : rotate(m.from) })),
    }
  })
  const turn = decision?.method === 'requestTurn'
  const choices = decision?.choices ?? []
  const has = (kind: string) => choices.some(c => c.kind === kind)
  const prompt: ActionPrompt | null = decision && !turn ? {
    type: decision.method === 'requestRobKong' ? 'rob' : decision.method === 'requestChi' ? 'chi' : 'claim',
    tile: decision.tile!, from: rotate(decision.from!), canHu: has('win'), canPeng: has('peng'), canGang: has('gang'),
    chiOptions: choices.filter(c => c.kind === 'chi').map(c => c.meld!),
  } : null
  const cap = game.capabilities.value
  const phase = decision ? turn ? 'discard' : 'prompt' : game.phase.value
  const jokers = cap.lotusTable?.jokerTiles ?? (settings.rule === 'shandong' ? [] : ['white']) as TileType[]
  const rule = settings.rule === 'lotus-legacy' ? LOTUS_RULESET : DEFAULT_RULESET
  const selectors = createRulePlayerSelectors({
    players, user: { value: players[0] }, phase: { value: phase }, isUserTurn: { value: !!turn },
    userDrewThisTurn: { value: !!turn }, selectedIndex: { value: -1 },
    availableWaitTiles: () => [...TILE_TYPES], isWinningHand: () => false, concealedKongs: () => [],
    waitingTiles: (hand, count) => {
      const key = JSON.stringify([settings.rule, settings.jiang, hand, players[0]?.melds, jokers])
      const previous = cache.get(key)
      if (previous) return previous
      const waits = settings.rule === 'shandong'
        ? shandongWaits(hand, players[0]?.melds ?? [], { luanJiang: settings.jiang === 'luan' })
        : rule.win.waitingTiles(hand, count, { jokers, jokerSubstitutes: cap.lotusTable?.wildcardTiles ?? ['white'] })
      if (cache.size > 512) cache.clear()
      cache.set(key, waits)
      return waits
    },
    matchingCount: (hand, tile) => hand.filter(t => t === tile).length,
    getGangHeadTile: () => cap.gangHeadTile,
  })
  const event = game.tableActionEvent.value
  const win = game.winEffect.value
  const rawResult = game.result.value
  const result = rawResult && { ...rawResult,
    winnerIndex: rotate(rawResult.winnerIndex), robbedKongPlayerIndex: rotate(rawResult.robbedKongPlayerIndex),
    tenpai: rawResult.tenpai?.map(rotate), scoreChanges: rawResult.scoreChanges?.map(c => ({ ...c, playerIndex: rotate(c.playerIndex) })),
  }
  if (result) result.roundLabel = roundLabel(game.round.value)
  return {
    players, user: players[0], phase, wall: [] as TileType[], wallHeadDrawn: game.wallHeadDrawn.value, wallCount: game.wallCount.value,
    currentPlayer: rotate(game.currentPlayer.value), selectedIndex: -1, turnSeconds: 0,
    lastDiscard: game.lastDiscard.value && { ...game.lastDiscard.value, from: rotate(game.lastDiscard.value.from) },
    actionPrompt: prompt, announcement: game.announcement.value,
    tableActionEvent: event && { ...event, actorIndex: rotate(event.actorIndex), sourceIndex: rotate(event.sourceIndex) },
    scoreFlowEvent: game.scoreFlowEvent.value && { ...game.scoreFlowEvent.value, deltas: game.scoreFlowEvent.value.deltas.map(d => ({ ...d, playerIndex: rotate(d.playerIndex) })) },
    result, winEffect: win && { ...win, winnerIndex: rotate(win.winnerIndex), robbedKongPlayerIndex: rotate(win.robbedKongPlayerIndex) },
    winPresentation: game.winPresentation.value && { ...game.winPresentation.value,
      winnerIndex: rotate(game.winPresentation.value.winnerIndex), robbedKongPlayerIndex: rotate(game.winPresentation.value.robbedKongPlayerIndex) }, revealHands: game.revealHands.value,
    winningPlayerIndex: rotate(game.winningPlayerIndex.value), matchFinished: false, dealer: rotate(game.dealer.value),
    isUserTurn: !!turn, userCanHu: !!turn && has('win'), matchName: '好友无限场', roundLabel: roundLabel(game.round.value),
    dealAnimation: { ...game.dealAnimation.value, playerIndex: rotate(game.dealAnimation.value.playerIndex) },
    openingStage: game.openingStage.value, diceValues: game.diceValues.value, diceThrowerIndex: rotate(game.diceThrowerIndex.value),
    userCurrentWaits: settings.rule === 'lotus-blood-flow' ? game.userCurrentWaits.value : selectors.userCurrentWaits.value,
    userTingOptions: settings.rule === 'lotus-blood-flow' ? game.userTingOptions.value : selectors.userTingOptions.value, userDiscardWaits: null,
    userKongs: choices.filter(c => c.kind === 'concealed-kong' || c.kind === 'added-kong').map(c => c.tile!),
    userHasWindKong: has('wind-kong'), userCanMingLou: choices.some(c => c.declareMingLou), userCanBaoTing: choices.some(c => c.declareBaoTing),
    gangHeadTile: cap.gangHeadTile, shandongJiang: settings.jiang, rulesetId: settings.rule, online: true,
    jokerTiles: jokers, wildcardTiles: cap.lotusTable?.wildcardTiles ?? [] as TileType[],
    flipTile: cap.lotusTable?.flipTile, flipStack: cap.lotusTable?.flipStack,
    wallBreakIndex: cap.lotusTable?.wallBreakIndex,
  }
}
export type NearbyTableView = ReturnType<typeof nearbyTableView>
