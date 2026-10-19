// 山东麻将开局时间线：掷骰 → 144张发牌 → 起手补花 → 天胡判定
import type { MatchType, TileType } from '../../core/contracts/types'
import { MATCH_HANDS, PACE_MS } from '../../core/local/localGameConfig'
import { resetLocalPlayers, type PlayerSeed } from '../../shared/runtime/localOpening'
import type { ShandongGameState } from './shandongState'
import { createShandongWall, isFlowerTile, isWinningHand } from './shandongRules'
import { shuffle, sortTiles } from '../../core/rules/tiles'

interface ShandongOpeningOptions {
  state: ShandongGameState
  clearTimers(): void
  wait(ms: number): Promise<void>
  later(callback: () => void, delay: number): number
  playSound(name: string, volume?: number): unknown
  playSoundAndWait(name: string, volume?: number): Promise<void>
  announce(text: string, tone?: string): void
  beginTurn(playerIndex: number, options?: { skipDraw?: boolean; preDrawn?: boolean }): unknown
  endGame(winnerIndex: number, options?: { selfDraw?: boolean; tianhu?: boolean; winTile?: TileType }): unknown
  playerSeeds?: Array<PlayerSeed | undefined>
  humanPlayerSeed?: PlayerSeed
}

export function createShandongOpening(options: ShandongOpeningOptions) {
  const { state } = options
  let sequence = 0

  function cancel() {
    sequence += 1
    state.openingStage.value = null
  }

  function resetPlayers() {
    resetLocalPlayers(state, 2000, options.playerSeeds, options.humanPlayerSeed)
  }

  async function start(mode?: MatchType, startOptions: {
    waitForTableReady?: () => Promise<void>
  } = {}) {
    options.clearTimers()
    if (mode && MATCH_HANDS[mode]) {
      state.matchType.value = mode
      state.round.value = 1
      state.dealer.value = 0
      state.honba.value = 0
      state.matchFinished.value = false
    }

    const currentSequence = ++sequence

    state.phase.value = 'opening'
    state.openingStage.value = 'start'
    state.announcement.value = null
    state.tableActionEvent.value = null
    options.playSound('game_start.mp3')
    state.revealHands.value = false
    state.winningPlayerIndex.value = -1
    state.result.value = null
    state.winEffect.value = null
    state.winPresentation.value = null
    state.mingLouPlayers.value.clear()
    state.passedHuPlayers.value.clear()
    state.passedPengTiles.value.clear()
    state.players.forEach((p) => { p.isMingLou = false })

    resetPlayers()

    // 洗牌（144张牌）
    const wall = shuffle(createShandongWall())
    state.wall.value = wall
    state.wallHeadDrawn.value = 0

    // 等待 3D 牌桌准备完毕
    if (startOptions.waitForTableReady) {
      await startOptions.waitForTableReady()
      if (sequence !== currentSequence) return
    }

    // 掷骰子
    state.openingStage.value = 'dice'
    const d1 = Math.floor(Math.random() * 6) + 1
    const d2 = Math.floor(Math.random() * 6) + 1
    state.diceValues.value = [d1, d2]
    state.diceThrowerIndex.value = state.dealer.value
    options.playSound('dice.mp3')
    await options.wait(600)
    if (sequence !== currentSequence) return

    // 发初始手牌：庄家 14 张，闲家各 13 张
    state.openingStage.value = 'deal'
    options.playSound('deal.mp3', 0.72)
    for (let i = 0; i < state.players.length; i += 1) {
      const isDealer = i === state.dealer.value
      const count = isDealer ? 14 : 13
      state.players[i].hand = state.wall.value.splice(0, count)
      state.players[i].melds = []
      state.players[i].discards = []
    }

    // 起手补花：把玩家手里的花牌亮出，并从牌尾补足手牌
    for (let i = 0; i < state.players.length; i += 1) {
      const player = state.players[i]
      let hasFlower = true
      while (hasFlower && state.wall.value.length > 0) {
        const flowerIdx = player.hand.findIndex(isFlowerTile)
        if (flowerIdx >= 0) {
          const [flower] = player.hand.splice(flowerIdx, 1)
          player.melds.push({ type: 'flower', tile: flower, tiles: [flower] })
          // 从牌尾补一张
          const rep = state.wall.value.pop()
          if (rep) player.hand.push(rep)
        } else {
          hasFlower = false
        }
      }
      player.hand = sortTiles(player.hand)
    }

    await options.wait(600)
    if (sequence !== currentSequence) return

    state.openingStage.value = null
    state.phase.value = 'playing'

    // 庄家天胡判定
    const dealerPlayer = state.players[state.dealer.value]
    if (isWinningHand(dealerPlayer.hand, dealerPlayer.melds, { luanJiang: state.luanJiang.value })) {
      options.announce(`${dealerPlayer.name} 天胡！`, 'gold')
      options.endGame(state.dealer.value, {
        selfDraw: true,
        tianhu: true,
        winTile: dealerPlayer.hand[dealerPlayer.hand.length - 1],
      })
      return
    }

    // 庄家开始出牌（起手已有 14 张牌，跳过摸牌）
    dealerPlayer.drawnTileIndex = dealerPlayer.hand.length - 1
    state.roundFirstDiscard.value = true
    void options.beginTurn(state.dealer.value, { skipDraw: true, preDrawn: true })
  }

  function nextRound(startOptions: { waitForTableReady?: () => Promise<void> } = {}) {
    state.round.value += 1
    // 轮庄
    state.dealer.value = (state.dealer.value + 1) % 4
    void start(undefined, startOptions)
  }

  return {
    start,
    nextRound,
    cancel,
    resetPlayers,
  }
}
