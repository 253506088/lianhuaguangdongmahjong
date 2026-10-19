// 山东麻将结算时间线：花分 × 番型倍数 × 底分、明搂翻倍、点炮包赔、自摸分摊
import type { GamePlayer, ScoreFlowEvent, TableActionType, TileType, WinPresentation } from '../../core/contracts/types'
import type { RoundResult, RoundScoreChange, RoundScoreDetail } from '../../core/contracts/gamePort'
import { evaluateShandongHand, type WinFlags } from './shandongRules'
import type { ShandongGameState, ShandongEndGameOptions } from './shandongState'

interface ShandongSettlementOptions {
  state: ShandongGameState
  playSound(name: string, volume?: number): unknown
  playSoundAndWait(name: string, volume?: number): Promise<void>
  getRoundLabel(): string
  onRoundSettled?(): void
  showTableAction?(
    type: TableActionType,
    actorIndex: number,
    sourceIndex: number | null,
    tile: TileType,
    meldIndex: number,
  ): void
  wait?(ms: number): Promise<void>
  announce?(text: string, tone?: string): void
}

export function createShandongSettlement(options: ShandongSettlementOptions) {
  const { state } = options

  async function settleWin(winnerIndex: number, endOptions: ShandongEndGameOptions = {}) {
    const winner = state.players[winnerIndex]
    const isSelfDraw = Boolean(endOptions.selfDraw || endOptions.tianhu || endOptions.dihu)
    const isRobbedKong = Boolean(endOptions.robbedKong)
    const sourceFrom = endOptions.sourceFrom ?? endOptions.robbedKongPlayerIndex ?? -1
    const winTile = endOptions.winTile ?? winner.hand[winner.hand.length - 1]

    const actionType: TableActionType = isRobbedKong
      ? 'robbed-kong-win'
      : (isSelfDraw ? 'self-draw' : 'discard-win')

    // 1. 特写阶段：激活 win-effect 状态，展示中央大字公告、头像胡牌/自摸动画与 3D 高光聚焦
    state.phase.value = 'win-effect'
    state.winningPlayerIndex.value = winnerIndex

    const winTitle = isRobbedKong ? '抢杠胡' : (isSelfDraw ? '自摸' : '点炮胡')
    options.announce?.(`${winner.name} ${winTitle}！`, 'gold')
    options.showTableAction?.(actionType, winnerIndex, sourceFrom >= 0 ? sourceFrom : null, winTile, -1)

    const presentation: WinPresentation = {
      winnerIndex,
      tile: winTile,
      sourceIndex: winner.drawnTileIndex,
      robbedKong: isRobbedKong,
      discardWin: !isSelfDraw && !isRobbedKong,
      robbedKongPlayerIndex: endOptions.robbedKongPlayerIndex ?? -1,
      robbedKongMeldIndex: -1,
    }
    state.winPresentation.value = presentation
    state.winEffect.value = {
      ...presentation,
      duration: 1500,
      reducedMotion: false,
      id: Date.now(),
    }

    // 播放胡牌音效与结算音
    options.playSound(isSelfDraw ? 'zimo.mp3' : 'hu.mp3')
    options.playSound('hu_effect_sound.mp3')

    const flags: WinFlags = {
      selfDraw: isSelfDraw,
      kongBloom: Boolean(endOptions.kongBloom),
      robbedKong: isRobbedKong,
      tianhu: Boolean(endOptions.tianhu),
      dihu: Boolean(endOptions.dihu),
      haidi: state.wall.value.length === 0 && isSelfDraw,
      isMingLou: state.mingLouPlayers.value.has(winnerIndex),
      luanJiang: state.luanJiang.value,
    }

    const evalResult = evaluateShandongHand(winner, winner.hand, winner.melds, flags)

    const baseUnitPoints = evalResult?.totalPoints ?? 10
    const details: RoundScoreDetail[] = []

    // 展示花分明细
    if (evalResult?.huaDetails) {
      for (const item of evalResult.huaDetails) {
        details.push({ label: item.label, points: item.points })
      }
    }

    // 展示番型倍数明细
    if (evalResult?.patterns) {
      for (const p of evalResult.patterns) {
        details.push({ label: `${p.name} ×${p.multiplier}`, multiplier: p.multiplier })
      }
    }

    // 分数转移计算
    const scoreDeltas = [0, 0, 0, 0]
    let totalWon = 0

    if (isRobbedKong && sourceFrom >= 0) {
      // 抢杠胡：被抢杠者包赔 3 家
      let amount = baseUnitPoints * 3
      if (state.mingLouPlayers.value.has(sourceFrom)) amount *= 2
      scoreDeltas[sourceFrom] -= amount
      scoreDeltas[winnerIndex] += amount
      totalWon = amount
    } else if (isSelfDraw) {
      // 自摸：其余三家各付一份
      for (let i = 0; i < state.players.length; i += 1) {
        if (i === winnerIndex) continue
        let payerAmount = baseUnitPoints
        // 明搂者输分翻倍
        if (state.mingLouPlayers.value.has(i)) payerAmount *= 2
        scoreDeltas[i] -= payerAmount
        scoreDeltas[winnerIndex] += payerAmount
        totalWon += payerAmount
      }
    } else if (sourceFrom >= 0) {
      // 点炮：点炮者一人全包
      let amount = baseUnitPoints
      // 点炮明搂者输分翻倍
      if (state.mingLouPlayers.value.has(sourceFrom)) amount *= 2
      scoreDeltas[sourceFrom] -= amount
      scoreDeltas[winnerIndex] += amount
      totalWon = amount
    }

    // 更新各玩家实际积分
    const scoreChanges: RoundScoreChange[] = state.players.map((player, idx) => {
      player.score += scoreDeltas[idx]
      return {
        playerIndex: idx,
        name: player.name,
        avatar: player.avatar,
        characterId: player.characterId,
        playerKind: player.playerKind,
        score: player.score,
        delta: scoreDeltas[idx],
      }
    })

    const result: RoundResult = {
      draw: false,
      winnerIndex,
      winner: winner.name,
      roundLabel: options.getRoundLabel(),
      winType: evalResult?.winType ?? (isSelfDraw ? 'self-draw' : 'discard'),
      winTile,
      multiplier: evalResult?.totalMultiplier ?? 1,
      totalMultiplier: evalResult?.totalMultiplier ?? 1,
      points: baseUnitPoints,
      totalWon,
      details,
      scoreChanges,
      robbedKong: isRobbedKong,
      robbedKongPlayerIndex: endOptions.robbedKongPlayerIndex,
    }

    // 保持胡牌特写 1.5 秒
    if (options.wait) {
      await options.wait(1500)
    }

    // 2. 亮牌阶段：所有玩家手牌平摊开，供玩家看清各家手牌与赢家牌型（1.2 秒）
    state.announcement.value = null
    state.tableActionEvent.value = null
    state.winEffect.value = null
    state.revealHands.value = true
    state.phase.value = 'revealing'

    if (options.wait) {
      await options.wait(1200)
    }

    // 3. 结算阶段：弹窗显示结算面板与计分明细
    state.result.value = result
    state.phase.value = 'settled'
    options.onRoundSettled?.()
  }

  async function settleDraw() {
    state.revealHands.value = true
    state.phase.value = 'revealing'
    options.announce?.('荒庄流局', 'red')

    if (options.wait) {
      await options.wait(1000)
    }
    state.announcement.value = null

    const scoreChanges: RoundScoreChange[] = state.players.map((player, idx) => ({
      playerIndex: idx,
      name: player.name,
      avatar: player.avatar,
      characterId: player.characterId,
      playerKind: player.playerKind,
      score: player.score,
      delta: 0,
    }))

    const result: RoundResult = {
      draw: true,
      roundLabel: options.getRoundLabel(),
      details: [{ label: '荒庄流局', points: 0 }],
      scoreChanges,
    }

    state.result.value = result
    state.phase.value = 'settled'
    options.onRoundSettled?.()
  }

  return {
    settleWin,
    settleDraw,
  }
}
