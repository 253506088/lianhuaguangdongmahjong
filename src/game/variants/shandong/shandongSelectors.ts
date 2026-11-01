import { computed } from 'vue'
import { TILE_TYPES } from '../../core/rules/tiles'
import { MATCH_NAMES } from '../../core/local/localGameConfig'
import { createCommonGameSelectors, createRulePlayerSelectors, structuralMeldCount } from '../../shared/selectors/gameSelectors'
import { canConcealedGang, evaluateShandongHand, isWinningHand, waitingTiles, SHANDONG_RULESET } from './shandongRules'
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
    estimateFan: (handWithoutWinTile, winTile) => {
      const user = common.user.value
      if (!user) return undefined
      const fullHand = [...handWithoutWinTile, winTile]
      const evalResult = evaluateShandongHand(
        user,
        fullHand,
        user.melds,
        {
          selfDraw: true,
          isMingLou: state.mingLouPlayers.value.has(user.seat),
          isBaoTing: true,
          luanJiang: state.luanJiang.value,
        },
      )
      return evalResult?.totalMultiplier ?? 1
    },
    getGangHeadTile: () => {
      return state.gangHeadTile.value
    },
  })

  // 检查本家是否可以明搂：
  // 1. 已经明楼过的不可重复明楼；
  // 2. 报听牌之后允许明楼（亮开手牌，不能点炮，纯自摸）；
  // 3. 尚未报听时：处于自家出牌阶段，且打牌可听或已听牌。
  const userCanMingLou = computed(() => {
    const user = common.user.value
    if (!user) return false
    if (['lobby', 'opening', 'win-effect', 'revealing', 'settled', 'finished'].includes(state.phase.value)) return false
    if (state.mingLouPlayers.value.has(user.seat)) return false
    // 报听牌之后允许明楼
    if (state.baoTingPlayers.value.has(user.seat)) return true
    if (!common.isUserTurn.value) return false
    return (playerSelectors.userTingOptions.value?.length ?? 0) > 0 || playerSelectors.userCurrentWaits.value !== null
  })

  // 检查本家是否可以报听（处于自家出牌阶段、打牌可听或已听牌、且尚未报听与明搂）
  const userCanBaoTing = computed(() => {
    const user = common.user.value
    if (!user) return false
    if (!common.isUserTurn.value) return false
    if (state.baoTingPlayers.value.has(user.seat) || state.mingLouPlayers.value.has(user.seat)) return false
    return (playerSelectors.userTingOptions.value?.length ?? 0) > 0 || playerSelectors.userCurrentWaits.value !== null
  })

  // 山东麻将核心规则：必须报听或明楼后才允许胡牌；未报听不可自摸胡
  const userCanHu = computed(() => {
    const user = common.user.value
    if (!user) return false
    if (!state.baoTingPlayers.value.has(user.seat) && !state.mingLouPlayers.value.has(user.seat)) return false
    return playerSelectors.userCanHu.value
  })

  return {
    ...common,
    ...playerSelectors,
    userKongs: computed(() => state.baoTingPlayers.value.has(0) || state.mingLouPlayers.value.has(0) ? [] : playerSelectors.userKongs.value),
    userCanHu,
    userCanMingLou,
    userCanBaoTing,
  }
}
