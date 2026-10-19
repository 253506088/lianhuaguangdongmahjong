// 山东麻将回合编排：单响截胡、明搂判定、过圈限制、胡>杠/碰>吃
import type { EndGameOptions, TableActionType, TileType } from '../../core/contracts/types'
import { PACE_MS } from '../../core/local/localGameConfig'
import { sortTiles } from '../../core/rules/tiles'
import type { ShandongGameState } from './shandongState'
import type {
  ShandongClaimAction,
  ShandongController,
  ShandongHuAction,
  ShandongTurnAction,
} from './shandongControllers'
import {
  canAddedGang,
  canChi,
  canConcealedGang,
  canGangFromDiscard,
  canPeng,
  canRobKong,
  canWinOnDiscard,
  canWinOnSelfDraw,
  type ChiMeld,
} from './shandongRules'

interface ShandongTurnOrchestratorOptions {
  state: ShandongGameState
  controllers: ShandongController[]
  drawFor(playerIndex: number, fromTail?: boolean): Promise<boolean>
  discardTile(playerIndex: number, handIndex: number): void
  endDraw(): unknown
  endGame(winnerIndex: number, options?: EndGameOptions): unknown
  announce(text: string, tone?: string): void
  showTableAction(type: TableActionType, actorIndex: number, sourceIndex: number | null, tile: TileType, meldIndex: number): void
  playSound(name: string, volume?: number): unknown
  playSoundAndWait(name: string, volume?: number): Promise<void>
  wait(ms: number): Promise<void>
  later(callback: () => void, delay: number): number
}

export function createShandongTurnOrchestrator(options: ShandongTurnOrchestratorOptions) {
  const { state, controllers } = options

  function seatDistance(from: number, to: number) {
    return (to - from + state.players.length) % state.players.length
  }

  async function beginTurn(playerIndex: number, turnOptions: { skipDraw?: boolean; fromTail?: boolean; preDrawn?: boolean } = {}) {
    if (state.phase.value === 'settled') return
    state.currentPlayer.value = playerIndex
    state.phase.value = 'discard'

    const player = state.players[playerIndex]
    if (!player) return

    // 摸牌（若未跳过）
    if (!turnOptions.skipDraw) {
      const drawn = await options.drawFor(playerIndex, turnOptions.fromTail)
      if (!drawn || (state.phase.value as string) === 'settled') return
    } else if (turnOptions.preDrawn && playerIndex === 0) {
      state.userDrewThisTurn.value = true
    }

    const isMingLou = state.mingLouPlayers.value.has(playerIndex)

    // 若明搂：只能自摸胡牌；不胡则必须摸打（打出最后一张摸到的牌）
    if (isMingLou) {
      if (canWinOnSelfDraw(player.hand, player.melds, { luanJiang: state.luanJiang.value })) {
        options.announce(`${player.name} 自摸！`, 'gold')
        options.endGame(playerIndex, { selfDraw: true, winTile: player.hand[player.hand.length - 1] })
        return
      }

      await options.wait(800)
      if ((state.phase.value as string) === 'settled') return
      options.discardTile(playerIndex, player.hand.length - 1)
      return
    }

    // 正常回合：请求玩家控制器决策
    const decision: ShandongTurnAction = await controllers[playerIndex].requestTurn({
      hand: player.hand,
      melds: player.melds,
      isMingLou: false,
      wallCount: state.wall.value.length,
      skipDraw: Boolean(turnOptions.skipDraw) && !Boolean(turnOptions.preDrawn),
      luanJiang: state.luanJiang.value,
    })

    if ((state.phase.value as string) === 'settled') return

    if (decision.kind === 'win') {
      const winTile = player.drawnTileIndex >= 0 ? player.hand[player.drawnTileIndex] : player.hand[player.hand.length - 1]
      options.announce(`${player.name} 自摸！`, 'gold')
      options.endGame(playerIndex, { selfDraw: true, winTile })
      return
    }

    if (decision.kind === 'concealed-kong') {
      await performConcealedKong(playerIndex, decision.tile)
      return
    }

    if (decision.kind === 'added-kong') {
      await declareAddedKong(playerIndex, decision.meldIndex)
      return
    }

    if (decision.kind === 'discard') {
      if (decision.declareMingLou) {
        state.mingLouPlayers.value.add(playerIndex)
        state.players[playerIndex].isMingLou = true
        options.announce(`${player.name} 明搂！`, 'gold')
        options.playSound('chihushandian.ogg')
        await options.wait(1000)
      }
      options.discardTile(playerIndex, decision.handIndex)
    }
  }

  async function performConcealedKong(playerIndex: number, tile: TileType) {
    const player = state.players[playerIndex]
    let removed = 0
    for (let i = player.hand.length - 1; i >= 0 && removed < 4; i -= 1) {
      if (player.hand[i] === tile) {
        player.hand.splice(i, 1)
        removed += 1
      }
    }
    player.drawnTileIndex = -1
    player.hand = sortTiles(player.hand)
    player.melds.push({
      type: 'angang',
      tile,
      tiles: [tile, tile, tile, tile],
    })
    options.showTableAction('concealed-gang', playerIndex, null, tile, player.melds.length - 1)
    await options.playSoundAndWait('gang.mp3')
    await beginTurn(playerIndex, { fromTail: true })
  }

  async function declareAddedKong(playerIndex: number, meldIndex: number) {
    const player = state.players[playerIndex]
    const meld = player.melds[meldIndex]
    if (!meld || meld.type !== 'peng') return
    const tile = meld.tile
    const handTileIdx = player.hand.indexOf(tile)
    if (handTileIdx < 0) return

    // 检查抢杠胡（单响截胡）
    const robbers: number[] = []
    for (let i = 0; i < state.players.length; i += 1) {
      if (i !== playerIndex && canRobKong(state.players[i].hand, tile, state.players[i].melds, { luanJiang: state.luanJiang.value })) {
        // 明搂者不可吃胡/抢杠胡，只能自摸
        if (!state.mingLouPlayers.value.has(i)) {
          robbers.push(i)
        }
      }
    }

    if (robbers.length > 0) {
      robbers.sort((a, b) => seatDistance(playerIndex, a) - seatDistance(playerIndex, b))
      const winner = robbers[0]
      const choice = await controllers[winner].requestRobKong({
        hand: state.players[winner].hand,
        melds: state.players[winner].melds,
        tile,
        from: playerIndex,
        luanJiang: state.luanJiang.value,
      })
      if (choice === 'win') {
        options.announce(`${state.players[winner].name} 抢杠胡！`, 'gold')
        options.endGame(winner, {
          winTile: tile,
          robbedKong: true,
          robbedKongPlayerIndex: playerIndex,
          sourceFrom: playerIndex,
        })
        return
      }
    }

    // 抢杠未发生，补杠成功
    const finalHandIdx = player.hand.indexOf(tile)
    if (finalHandIdx < 0) return
    player.hand.splice(finalHandIdx, 1)
    player.drawnTileIndex = -1
    meld.type = 'gang'
    meld.added = true
    meld.tiles.push(tile)

    options.showTableAction('added-gang', playerIndex, null, tile, meldIndex)
    await options.playSoundAndWait('gang.mp3')
    await beginTurn(playerIndex, { fromTail: true })
  }

  function routeDiscard(from: number, tile: TileType) {
    // 1. 点炮胡检查（不能一炮多响，只能截胡：按出牌者逆时针距离最近者优先）
    const candidates: number[] = []
    for (let i = 0; i < state.players.length; i += 1) {
      if (i === from) continue
      // 过胡过圈限制：如果在过胡锁定期内，不可点炮胡
      if (state.passedHuPlayers.value.has(i)) continue
      // 明搂限制：明搂后只能自摸胡，不可点炮胡
      if (state.mingLouPlayers.value.has(i)) continue

      if (canWinOnDiscard(state.players[i].hand, tile, state.players[i].melds, { luanJiang: state.luanJiang.value })) {
        candidates.push(i)
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => seatDistance(from, a) - seatDistance(from, b))
      const target = candidates[0]
      void offerHu(target, from, tile)
      return
    }

    // 2. 无人胡牌，继续进入杠/碰/吃响应
    void continueClaims(from, tile)
  }

  async function offerHu(playerIndex: number, from: number, tile: TileType) {
    const player = state.players[playerIndex]
    const nextPlayer = (from + 1) % state.players.length
    const canPengNow = canPeng(player.hand, tile) && !state.passedPengTiles.value.get(playerIndex)?.has(tile)
    const canGangNow = canGangFromDiscard(player.hand, tile)
    const chiOptions = playerIndex === nextPlayer ? canChi(player.hand, tile) : []

    const action: ShandongHuAction = await controllers[playerIndex].requestHu({
      hand: player.hand,
      melds: player.melds,
      tile,
      from,
      canPeng: canPengNow,
      canGang: canGangNow,
      chiOptions,
      isMingLou: state.mingLouPlayers.value.has(playerIndex),
    })

    if (state.phase.value === 'settled') return

    if (action.kind === 'hu') {
      options.announce(`${player.name} 点炮胡！`, 'gold')
      options.endGame(playerIndex, {
        selfDraw: false,
        winTile: tile,
        sourceFrom: from,
      })
      return
    }

    // 过胡过圈：玩家有胡不胡，进入过胡锁定，直到下次摸牌解圈
    state.passedHuPlayers.value.add(playerIndex)

    if (action.kind === 'gang' && canGangNow) {
      performGang(playerIndex, from, tile)
      return
    }

    if (action.kind === 'peng' && canPengNow) {
      performPengAction(playerIndex, from, tile)
      return
    }

    if (action.kind === 'chi' && chiOptions.length > 0) {
      performChiAction(playerIndex, action.meld, from, tile)
      return
    }

    // 放弃胡牌后，检查其余人是否有杠/碰/吃
    void continueClaims(from, tile)
  }

  async function continueClaims(from: number, tile: TileType) {
    const nextPlayer = (from + 1) % state.players.length

    // 检查其余人是否有杠/碰
    for (let i = 0; i < state.players.length; i += 1) {
      if (i === from) continue
      if (state.mingLouPlayers.value.has(i)) continue // 明搂者不碰不杠

      const player = state.players[i]
      const canGangNow = canGangFromDiscard(player.hand, tile)
      const canPengNow = canPeng(player.hand, tile) && !state.passedPengTiles.value.get(i)?.has(tile)
      const chiOptions = i === nextPlayer ? canChi(player.hand, tile) : []

      if (canGangNow || canPengNow) {
        const action: ShandongClaimAction = await controllers[i].requestClaim({
          hand: player.hand,
          melds: player.melds,
          tile,
          from,
          canPeng: canPengNow,
          canGang: canGangNow,
          chiOptions,
          isMingLou: false,
        })

        if (state.phase.value === 'settled') return

        if (action.kind === 'gang' && canGangNow) {
          performGang(i, from, tile)
          return
        }

        if (action.kind === 'peng' && canPengNow) {
          performPengAction(i, from, tile)
          return
        }

        if (action.kind === 'pass' && canPengNow) {
          // 过碰过圈：在同一圈内放弃碰某张牌，下一次摸牌前不得碰同张牌
          let set = state.passedPengTiles.value.get(i)
          if (!set) {
            set = new Set()
            state.passedPengTiles.value.set(i, set)
          }
          set.add(tile)
        }
      }
    }

    // 检查下家吃牌
    const nextP = state.players[nextPlayer]
    if (!state.mingLouPlayers.value.has(nextPlayer)) {
      const chiOptions = canChi(nextP.hand, tile)
      if (chiOptions.length > 0) {
        const chiAction = await controllers[nextPlayer].requestChi({
          hand: nextP.hand,
          melds: nextP.melds,
          tile,
          from,
          chiOptions,
        })

        if (state.phase.value === 'settled') return

        if (chiAction.kind === 'chi') {
          performChiAction(nextPlayer, chiAction.meld, from, tile)
          return
        }
      }
    }

    // 无人响应，流转至下家开始回合
    options.later(() => {
      void beginTurn(nextPlayer)
    }, 750)
  }

  function performGang(playerIndex: number, from: number, tile: TileType) {
    const player = state.players[playerIndex]
    const source = state.players[from]
    if (source && source.discards.at(-1) === tile) {
      source.discards.pop()
    }
    state.lastDiscard.value = null
    let removed = 0
    for (let i = player.hand.length - 1; i >= 0 && removed < 3; i -= 1) {
      if (player.hand[i] === tile) {
        player.hand.splice(i, 1)
        removed += 1
      }
    }
    player.drawnTileIndex = -1
    player.hand = sortTiles(player.hand)
    player.melds.push({
      type: 'gang',
      tile,
      from,
      tiles: [tile, tile, tile, tile],
    })
    state.currentPlayer.value = playerIndex
    options.showTableAction('discard-gang', playerIndex, from, tile, player.melds.length - 1)
    void options.playSoundAndWait('gang.mp3')
    void beginTurn(playerIndex, { fromTail: true })
  }

  function performPengAction(playerIndex: number, from: number, tile: TileType) {
    const player = state.players[playerIndex]
    const source = state.players[from]
    if (source && source.discards.at(-1) === tile) {
      source.discards.pop()
    }
    state.lastDiscard.value = null
    let removed = 0
    for (let i = player.hand.length - 1; i >= 0 && removed < 2; i -= 1) {
      if (player.hand[i] === tile) {
        player.hand.splice(i, 1)
        removed += 1
      }
    }
    player.drawnTileIndex = -1
    player.hand = sortTiles(player.hand)
    player.melds.push({
      type: 'peng',
      tile,
      from,
      tiles: [tile, tile, tile],
    })
    state.currentPlayer.value = playerIndex
    options.showTableAction('peng', playerIndex, from, tile, player.melds.length - 1)
    void options.playSound('peng.mp3')
    options.later(() => {
      void beginTurn(playerIndex, { skipDraw: true })
    }, PACE_MS.afterClaimPeng)
  }

  function performChiAction(playerIndex: number, meld: ChiMeld, from: number, discardTile: TileType) {
    const player = state.players[playerIndex]
    const source = state.players[from]
    if (source && source.discards.at(-1) === discardTile) {
      source.discards.pop()
    }
    state.lastDiscard.value = null
    // 从手牌中移除除弃牌外的另外 2 张牌
    const otherTiles = meld.tiles.filter((t, i) => i !== meld.tiles.lastIndexOf(discardTile))
    for (const t of otherTiles) {
      const idx = player.hand.indexOf(t)
      if (idx >= 0) player.hand.splice(idx, 1)
    }
    player.drawnTileIndex = -1
    player.hand = sortTiles(player.hand)
    player.melds.push({
      type: 'chi',
      tile: discardTile,
      tiles: meld.tiles,
      from,
    })
    state.currentPlayer.value = playerIndex
    options.showTableAction('chi', playerIndex, from, discardTile, player.melds.length - 1)
    void options.playSound('chi.mp3')
    options.later(() => {
      void beginTurn(playerIndex, { skipDraw: true })
    }, PACE_MS.afterClaimPeng)
  }

  return {
    beginTurn,
    routeDiscard,
    performConcealedKong,
    declareAddedKong,
  }
}
