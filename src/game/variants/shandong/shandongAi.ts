// 山东麻将 AI 决策层（纯函数）
import type { Meld, TileType } from '../../core/contracts/types'
import {
  canAddedGang,
  canConcealedGang,
  canGangFromDiscard,
  canPeng,
  canRobKong,
  canWinOnDiscard,
  canWinOnSelfDraw,
  is258Tile,
  isFlowerTile,
  waitingTiles,
  type ChiMeld,
} from './shandongRules'
import { countTiles } from '../../shared/rules/tileTools'

export type ShandongTurnDecision =
  | { kind: 'win' }
  | { kind: 'added-kong'; meldIndex: number }
  | { kind: 'concealed-kong'; tile: TileType }
  | { kind: 'discard'; handIndex: number; declareMingLou?: boolean }

export type ShandongClaimAction =
  | { kind: 'hu' }
  | { kind: 'gang' }
  | { kind: 'peng' }
  | { kind: 'chi'; meld: ChiMeld }
  | { kind: 'pass' }

export interface ShandongTurnContext {
  hand: TileType[]
  melds: Meld[]
  isMingLou?: boolean
  wallCount?: number
  luanJiang?: boolean
}

export interface ShandongClaimContext {
  hand: TileType[]
  melds: Meld[]
  tile: TileType
  from: number
  canHu: boolean
  canPeng: boolean
  canGang: boolean
  chiOptions: ChiMeld[]
  isMingLou?: boolean
}

function evaluateTileUtility(tile: TileType, hand: TileType[], luanJiang?: boolean): number {
  if (!tile) return -100
  if (isFlowerTile(tile)) return -100

  const counts = countTiles(hand)
  const count = counts.get(tile) || 0
  if (count >= 3) return 80
  if (count === 2) {
    // 乱将时任意对子都可作为雀头（75分）；258规则下只有258对子具备雀头极高价值
    return (luanJiang || is258Tile(tile)) ? 75 : 55
  }

  // 单张字牌价值最低，优先切掉
  const match = /^([mps])([1-9])$/.exec(tile)
  if (!match) return 10

  const suit = match[1]
  const rank = Number(match[2])

  let neighbors = 0
  if (hand.includes(`${suit}${rank - 1}` as TileType)) neighbors += 20
  if (hand.includes(`${suit}${rank + 1}` as TileType)) neighbors += 20
  if (hand.includes(`${suit}${rank - 2}` as TileType)) neighbors += 10
  if (hand.includes(`${suit}${rank + 2}` as TileType)) neighbors += 10

  // 258 数牌在非乱将时作为潜在雀头也有额外加分
  const eyeBonus = (!luanJiang && is258Tile(tile)) ? 8 : 0

  return 20 + neighbors + eyeBonus
}

/** 智能选择切牌索引 */
export function chooseBestDiscardIndex(hand: TileType[], melds: Meld[] = [], luanJiang?: boolean): { index: number; reachesTing: boolean } {
  // 1. 优先检查打出哪张牌能进入听牌，且听牌张数最多
  let bestTingIndex = -1
  let maxWaitCount = -1

  for (let i = 0; i < hand.length; i += 1) {
    const remainingHand = [...hand.slice(0, i), ...hand.slice(i + 1)]
    const waits = waitingTiles(remainingHand, melds, { luanJiang })
    if (waits.length > maxWaitCount) {
      maxWaitCount = waits.length
      bestTingIndex = i
    }
  }

  if (bestTingIndex !== -1 && maxWaitCount > 0) {
    return { index: bestTingIndex, reachesTing: true }
  }

  // 2. 未听牌时，打出效用最低的孤张牌（优先切孤风箭、偏张幺九）
  let lowestUtility = Infinity
  let worstIndex = hand.length - 1

  for (let i = 0; i < hand.length; i += 1) {
    const tile = hand[i]
    const u = evaluateTileUtility(tile, hand, luanJiang)
    if (u < lowestUtility) {
      lowestUtility = u
      worstIndex = i
    }
  }

  return { index: worstIndex, reachesTing: false }
}

/** AI 自家回合出牌决策 */
export function decideTurn(ctx: ShandongTurnContext): ShandongTurnDecision {
  // 1. 优先自摸胡
  if (canWinOnSelfDraw(ctx.hand, ctx.melds, { luanJiang: ctx.luanJiang })) {
    return { kind: 'win' }
  }

  // 2. 若已明搂，不能换手牌，必须摸打（打出最后摸到的牌）
  if (ctx.isMingLou) {
    return { kind: 'discard', handIndex: ctx.hand.length - 1 }
  }

  // 3. 检查是否能开杠
  const kongs = canConcealedGang(ctx.hand)
  if (kongs.length > 0) {
    return { kind: 'concealed-kong', tile: kongs[0] }
  }

  const added = canAddedGang(ctx.hand, ctx.melds)
  if (added.length > 0) {
    return { kind: 'added-kong', meldIndex: added[0].meldIndex }
  }

  // 4. 选择最佳切牌
  const { index, reachesTing } = chooseBestDiscardIndex(ctx.hand, ctx.melds, ctx.luanJiang)

  // 若 AI 听牌且剩余牌墙充足，AI 也有一定几率明搂博加倍
  const declareMingLou = reachesTing && (ctx.wallCount ?? 40) > 20

  return { kind: 'discard', handIndex: index, declareMingLou }
}

/** AI 响应他人弃牌决策 */
export function decideClaim(ctx: ShandongClaimContext): ShandongClaimAction {
  // 1. 优先点炮胡牌（明搂者不能点炮胡，只能自摸）
  if (ctx.canHu && !ctx.isMingLou) {
    return { kind: 'hu' }
  }

  // 明搂后锁手，不碰、不杠、不吃
  if (ctx.isMingLou) {
    return { kind: 'pass' }
  }

  // 2. 杠牌
  if (ctx.canGang) {
    return { kind: 'gang' }
  }

  // 3. 碰牌
  if (ctx.canPeng) {
    // 评估碰牌后手牌是否更优
    return { kind: 'peng' }
  }

  // 4. 吃牌
  if (ctx.chiOptions && ctx.chiOptions.length > 0) {
    return { kind: 'chi', meld: ctx.chiOptions[0] }
  }

  return { kind: 'pass' }
}

/** AI 抢杠胡决策 */
export function decideRobKong(hand: TileType[], kongTile: TileType, melds: Meld[] = [], options?: { luanJiang?: boolean }): 'win' | 'pass' {
  if (canRobKong(hand, kongTile, melds, options)) {
    return 'win'
  }
  return 'pass'
}
