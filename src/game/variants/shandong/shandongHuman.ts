// 山东麻将用户操作控制器：UI 点击与 HumanController 交互桥梁
import type { GamePlayer, TileType } from '../../core/contracts/types'
import type { ShandongHumanController } from './shandongControllers'
import type { ShandongGameState, ShandongEndGameOptions } from './shandongState'
import type { createShandongTurnOrchestrator } from './shandongTurnOrchestrator'

interface ShandongHumanOptions {
  state: ShandongGameState
  humanController: ShandongHumanController
  turnOrchestrator: ReturnType<typeof createShandongTurnOrchestrator>
  getUser(): GamePlayer | undefined
  isUserTurn(): boolean
  canUserHu(): boolean
  getUserKongs(): TileType[]
  userCanMingLou(): boolean
  userCanBaoTing?(): boolean
  stopCountdown(): void
  startTurnCountdown(): void
  discardTile(playerIndex: number, handIndex: number): unknown
  beginTurn(playerIndex: number, options: { fromTail: true }): unknown
  endGame(winnerIndex: number, options?: ShandongEndGameOptions): unknown
  announce(text: string, tone?: string): void
  playSound(name: string, volume?: number): unknown
  later(callback: () => void, delay: number): number
}

export function createShandongHuman(options: ShandongHumanOptions) {
  const { state, humanController } = options

  let isDiscarding = false
  let pendingDeclareBaoTing = false
  let pendingDeclareMingLou = false

  function selectTile(index: number) {
    if (!options.isUserTurn()) return
    const user = options.getUser()
    if (!user) return
    const isLocked = state.mingLouPlayers.value.has(0) || state.baoTingPlayers.value.has(0)
    if (isLocked) {
      const drawnIndex = user.drawnTileIndex !== undefined && user.drawnTileIndex >= 0 ? user.drawnTileIndex : user.hand.length - 1
      if (index !== drawnIndex) return
    }
    state.selectedIndex.value = index
    options.playSound('click.mp3', 0.65)
  }

  function clearUserSelection() {
    state.selectedIndex.value = -1
  }

  function userDiscard(index = state.selectedIndex.value) {
    if (isDiscarding) return
    if (!humanController.hasPendingTurn()) return
    const user = options.getUser()
    if (!user || index < 0 || index >= user.hand.length) return
    const isLocked = state.mingLouPlayers.value.has(0) || state.baoTingPlayers.value.has(0)
    if (isLocked) {
      const drawnIndex = user.drawnTileIndex !== undefined && user.drawnTileIndex >= 0 ? user.drawnTileIndex : user.hand.length - 1
      if (index !== drawnIndex) return
    }
    isDiscarding = true
    const declareMingLou = pendingDeclareMingLou
    const declareBaoTing = pendingDeclareBaoTing
    pendingDeclareMingLou = false
    pendingDeclareBaoTing = false
    clearUserSelection()
    try {
      humanController.resolveDiscard(index, declareMingLou, declareBaoTing)
    } finally {
      setTimeout(() => { isDiscarding = false }, 250)
    }
  }

  function userMingLou() {
    if (!options.userCanMingLou()) return
    pendingDeclareMingLou = true
    pendingDeclareBaoTing = false
    // 如果已有选中手牌，则顺势切牌并打出报明楼
    if (state.selectedIndex.value >= 0) {
      userDiscard(state.selectedIndex.value)
    } else {
      options.announce('请选择一张牌打出明搂', 'gold')
      options.playSound('click.mp3', 0.65)
    }
  }

  function userBaoTing() {
    if (options.userCanBaoTing && !options.userCanBaoTing()) return
    pendingDeclareBaoTing = true
    pendingDeclareMingLou = false
    // 如果已有选中手牌，则顺势切牌并打出报听
    if (state.selectedIndex.value >= 0) {
      userDiscard(state.selectedIndex.value)
    } else {
      options.announce('请选择一张牌打出报听', 'emerald')
      options.playSound('click.mp3', 0.65)
    }
  }

  function userPass() {
    const prompt = state.actionPrompt.value
    options.stopCountdown()
    state.actionPrompt.value = null
    if (!prompt) return
    options.playSound('click.mp3', 0.65)
    if (humanController.hasPendingRobKong()) return humanController.resolveRobKongAction('pass')
    if (humanController.hasPendingHu()) return humanController.resolveHu({ kind: 'pass' })
    if (humanController.hasPendingChi()) return humanController.resolveChiPass()
    if (humanController.hasPendingClaim()) return humanController.resolveClaimPass()
  }

  function userPeng() {
    if (humanController.hasPendingHu()) return humanController.resolveHu({ kind: 'peng' })
    if (humanController.hasPendingClaim()) return humanController.resolveClaimPeng()
  }

  function userGangFromDiscard() {
    if (humanController.hasPendingHu()) return humanController.resolveHu({ kind: 'gang' })
    if (humanController.hasPendingClaim()) return humanController.resolveClaimGang()
  }

  function userGang(tile = options.getUserKongs()[0]) {
    const user = options.getUser()
    if (!tile || !user) return
    if (humanController.hasPendingTurn()) {
      const meldIndex = user.melds.findIndex((meld) => meld.type === 'peng' && meld.tile === tile)
      return meldIndex >= 0
        ? humanController.resolveAddedKong(meldIndex)
        : humanController.resolveConcealedKong(tile)
    }
  }

  function userHu() {
    if (humanController.hasPendingRobKong()) {
      if (!state.baoTingPlayers.value.has(0)) return
      options.stopCountdown()
      return humanController.resolveRobKongAction('win')
    }
    if (humanController.hasPendingHu()) {
      if (!state.baoTingPlayers.value.has(0)) return
      options.stopCountdown()
      return humanController.resolveHu({ kind: 'hu' })
    }
    if (humanController.hasPendingTurn()) {
      if (!state.baoTingPlayers.value.has(0) && !state.mingLouPlayers.value.has(0)) return
      options.stopCountdown()
      return humanController.resolveWin()
    }
    if (options.canUserHu()) {
      if (!state.baoTingPlayers.value.has(0) && !state.mingLouPlayers.value.has(0)) return
      options.stopCountdown()
      const user = options.getUser()
      const winTile = user?.drawnTileIndex !== undefined && user.drawnTileIndex >= 0
        ? user.hand[user.drawnTileIndex]
        : user?.hand[user.hand.length - 1]
      options.endGame(0, { selfDraw: true, winTile })
    }
  }

  function chooseChi(optionIndex: number) {
    const prompt = state.actionPrompt.value
    const option = prompt?.chiOptions?.[optionIndex]
    if (!option) return
    options.stopCountdown()
    state.actionPrompt.value = null
    if (humanController.hasPendingHu()) {
      return humanController.resolveHu({ kind: 'chi', meld: { tiles: option.tiles, kind: 'sequence' } })
    }
    if (humanController.hasPendingClaim()) {
      return humanController.resolveClaimChi({ tiles: option.tiles, kind: 'sequence' })
    }
    if (humanController.hasPendingChi()) {
      return humanController.resolveChi({ tiles: option.tiles, kind: 'sequence' })
    }
  }

  return {
    selectTile,
    clearUserSelection,
    userDiscard,
    userMingLou,
    userBaoTing,
    userPass,
    userPeng,
    userGangFromDiscard,
    userGang,
    userHu,
    chooseChi,
  }
}
