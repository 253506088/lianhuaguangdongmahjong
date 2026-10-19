import { computed } from 'vue'
import { TILE_TYPES } from '../../core/rules/tiles'
import { MATCH_NAMES } from '../../core/local/localGameConfig'
import { createCommonGameSelectors, createRulePlayerSelectors, structuralMeldCount } from '../../shared/selectors/gameSelectors'
import { canConcealedGang, isWinningHand, waitingTiles, SHANDONG_RULESET } from './shandongRules'
import type { RuleSet } from '../../core/rules/ruleset'
import type { ShandongGameState } from './shandongState'

export { structuralMeldCount }

export function createShandongSelectors(state: ShandongGameState, ruleset: RuleSet = SHANDONG_RULESET) {
  const common = createCommonGameSelectors(state, MATCH_NAMES)
  const playerSelectors = createRulePlayerSelectors({
    players: state.players,
    user: common.user,
    phase: state.phase,
    isUserTurn: common.isUserTurn,
    userDrewThisTurn: state.userDrewThisTurn,
    selectedIndex: state.selectedIndex,
    availableWaitTiles: () => [...TILE_TYPES],
    isWinningHand: (hand) => {
      const melds = common.user.value?.melds ?? []
      return isWinningHand(hand, melds, { luanJiang: state.luanJiang.value })
    },
    concealedKongs: (hand) => canConcealedGang(hand),
    waitingTiles: (hand) => {
      const melds = common.user.value?.melds ?? []
      return waitingTiles(hand, melds, { luanJiang: state.luanJiang.value })
    },
    matchingCount: (hand, tile) => hand.filter((t) => t === tile).length,
  })

  // 检查本家是否可以明搂（处于自家出牌阶段、打牌可听或已听牌、且尚未明搂）
  const userCanMingLou = computed(() => {
    const user = common.user.value
    if (!user) return false
    if (!common.isUserTurn.value) return false
    if (state.mingLouPlayers.value.has(user.seat)) return false
    return (playerSelectors.userTingOptions.value?.length ?? 0) > 0 || playerSelectors.userCurrentWaits.value !== null
  })

  return {
    ...common,
    ...playerSelectors,
    userCanMingLou,
  }
}
