// 山东麻将摸打与花牌补摸流程
import type { GamePlayer, TableActionType, TileType } from '../../core/contracts/types'
import { isFlowerTile } from './shandongRules'
import { PACE_MS } from '../../core/local/localGameConfig'
import type { ShandongGameState } from './shandongState'
import { playDiscardName } from '../../shared/runtime/discardAudio'
import { sortTiles } from '../../core/rules/tiles'

export type ShandongDrawReason = 'normal' | 'flower' | 'kong'

interface ShandongTileFlowOptions {
  state: ShandongGameState
  drawFromWall(reason?: ShandongDrawReason | boolean): TileType | null
  endDraw(): unknown
  endGame(winnerIndex: number, options?: { winTile?: TileType; selfDraw?: boolean }): unknown
  showTableAction(type: TableActionType, actorIndex: number, sourceIndex: number | null, tile: TileType, meldIndex: number): void
  playSound(name: string, volume?: number): unknown
  playSoundAndWait(name: string, volume?: number): Promise<void>
  shouldAnnounceDiscard?: (playerIndex: number, player: GamePlayer) => boolean
  wait(ms: number): Promise<void>
  routeDiscard(from: number, tile: TileType): void
  onDraw?(seat: number, tile: TileType, reason: ShandongDrawReason): void
  onDiscard?(seat: number, tile: TileType, id: number): void
}

export function createShandongTileFlow(options: ShandongTileFlowOptions) {
  const { state } = options

  /**
   * 摸牌并处理花牌补花：
   * 抓到花牌立即亮出（加入 melds of type flower），并在杠头前补摸一张（绝不摸走或改变公开的杠头），直到手里没有花牌为止。
   */
  async function drawFor(playerIndex: number, reason: ShandongDrawReason | boolean = 'normal', normalDraw = reason === 'normal' || reason === false): Promise<boolean> {
    state.lastNormalDrawPlayer.value = null
    if (state.wall.value.length === 0) {
      options.endDraw()
      return false
    }

    const tile = options.drawFromWall(reason === 'normal' ? false : reason)
    if (!tile) {
      options.endDraw()
      return false
    }

    const player = state.players[playerIndex]
    if (!player) return false

    // 检查是否为花牌
    if (isFlowerTile(tile)) {
      player.melds.push({ type: 'flower', tile, tiles: [tile] })
      options.onDraw?.(playerIndex, tile, reason === true ? 'kong' : reason === false ? 'normal' : reason)
      options.playSound('give.mp3', 0.7)
      await options.wait(200)

      // 检查八仙过海（8张花牌全齐立即花胡）
      const flowers = player.melds.filter((m) => m.type === 'flower').length
      if (flowers >= 8) {
        options.endGame(playerIndex, { selfDraw: true, winTile: tile })
        return false
      }

      if (state.phase.value === 'settled') return false
      // 补花摸牌：从杠头前补摸一张（绝不摸走或改变公开的杠头）
      return drawFor(playerIndex, 'flower', normalDraw)
    }

    // 摸到正常数牌/字牌：过胡解圈、过碰解圈
    state.passedHuPlayers.value.delete(playerIndex)
    state.passedPengTiles.value.get(playerIndex)?.clear()

    player.hand.push(tile)
    player.drawnTileIndex = player.hand.length - 1
    state.lastNormalDrawPlayer.value = normalDraw && state.wall.value.length <= 1 ? playerIndex : null
    options.playSound('give.mp3', 0.7)
    if (playerIndex === 0) {
      state.userDrewThisTurn.value = true
    }
    options.onDraw?.(playerIndex, tile, reason === true ? 'kong' : reason === false ? 'normal' : reason)
    return true
  }

  function discardTile(playerIndex: number, handIndex: number) {
    const player = state.players[playerIndex]
    if (!player || handIndex < 0 || handIndex >= player.hand.length) return

    const [tile] = player.hand.splice(handIndex, 1)
    player.drawnTileIndex = -1
    player.hand = sortTiles(player.hand)
    player.discards.push(tile)
    if (playerIndex === 0) {
      state.userDrewThisTurn.value = false
    }

    state.lastDiscard.value = {
      tile,
      from: playerIndex,
      id: Date.now(),
    }
    options.onDiscard?.(playerIndex, tile, state.lastDiscard.value.id)

    // 播放实体打牌声（啪）与牌名语音播报
    options.playSound('dapai.mp3', 0.8)
    if (options.shouldAnnounceDiscard?.(playerIndex, player) !== false) {
      state.lastDiscardSound.value = playDiscardName(tile, options)
    }

    options.routeDiscard(playerIndex, tile)
  }

  return {
    drawFor,
    discardTile,
  }
}
