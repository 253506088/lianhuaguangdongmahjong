import { ref } from 'vue'
import type { TileType } from '../../core/contracts/types'
import { createLocalGameState } from '../../core/local/localGameState'

export interface ShandongEndGameOptions {
  winTile?: TileType
  winHand?: TileType[]
  selfDraw?: boolean
  kongBloom?: boolean
  robbedKong?: boolean
  robbedKongPlayerIndex?: number
  tianhu?: boolean
  dihu?: boolean
  sourceFrom?: number
}

export function createShandongGameState() {
  const base = createLocalGameState()
  return {
    ...base,
    /** 明搂状态的玩家座位集合 */
    mingLouPlayers: ref<Set<number>>(new Set()),
    /** 报听状态的玩家座位集合 */
    baoTingPlayers: ref<Set<number>>(new Set()),
    /** 过胡锁定的玩家座位（自己摸牌前不能点炮胡） */
    passedHuPlayers: ref<Set<number>>(new Set()),
    /** 过碰锁定的牌（自己摸牌前不能碰这些牌） Map<playerIndex, Set<TileType>> */
    passedPengTiles: ref<Map<number, Set<TileType>>>(new Map()),
    /** 本局是否尚未打出第一张牌（地胡判定窗口） */
    roundFirstDiscard: ref(false),
    /** 正常摸牌（包括其补花）取尽可摸牌时的赢家座位；杠头独立保留。 */
    lastNormalDrawPlayer: ref<number | null>(null),
    /** 是否为乱将（任意将）规则 */
    luanJiang: ref(false),
    /** 是否允许吃牌 */
    allowChi: ref(true),
    /** 山东麻将公开杠头牌（开杠即摸，有人杠走后翻开下一张） */
    gangHeadTile: ref<TileType | null>(null),
  }
}

export type ShandongGameState = ReturnType<typeof createShandongGameState>
