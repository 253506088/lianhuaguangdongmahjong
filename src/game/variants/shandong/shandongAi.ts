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
import { TILE_TYPES } from '../../core/rules/tiles'
import { shandongShanten } from './shandongEfficiency'

export type ShandongTurnDecision =
  | { kind: 'win' }
  | { kind: 'added-kong'; meldIndex: number }
  | { kind: 'concealed-kong'; tile: TileType }
  | { kind: 'discard'; handIndex: number; declareMingLou?: boolean; declareBaoTing?: boolean }

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
  isBaoTing?: boolean
  wallCount?: number
  luanJiang?: boolean
  /** 自己手牌、全桌牌河/副露、明搂公开手牌、公开杠头；不含他家暗手或牌墙。 */
  visibleTiles?: readonly TileType[]
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
  isBaoTing?: boolean
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
export function chooseBestDiscardIndex(hand: TileType[], melds: Meld[] = [], luanJiang?: boolean, visibleTiles?: readonly TileType[]): { index: number; reachesTing: boolean } {
  const best = rankDiscardOptions(hand, melds, luanJiang, visibleTiles)[0]
  // 已知所有听牌均耗尽时不主动锁手，仍可继续改良。
  return { index: best?.index ?? -1, reachesTing: Boolean(best?.waits.length && best.remaining > 0) }
}

export interface ShandongDiscardEvaluation {
  index: number
  tile: TileType
  waits: TileType[]
  remaining: number
  shanten: number
  ukeire: number
  utility: number
}

/** 排序结果用于可复现的牌例/基准检查；重复牌只评价一次。 */
export function rankDiscardOptions(hand: TileType[], melds: Meld[] = [], luanJiang = false, visibleTiles?: readonly TileType[]): ShandongDiscardEvaluation[] {
  const visible = countTiles([...(visibleTiles ?? [...hand, ...melds.flatMap(meld => meld.tiles)])])
  const own = countTiles(hand)
  const remaining = (tile: TileType) => Math.max(0, 4 - Math.max(visible.get(tile) ?? 0, own.get(tile) ?? 0))
  const seen = new Set<TileType>()
  const candidates: ShandongDiscardEvaluation[] = []
  for (let index = 0; index < hand.length; index++) {
    const tile = hand[index]
    if (seen.has(tile)) continue
    seen.add(tile)
    const after = hand.filter((_, i) => i !== index)
    const distance = shandongShanten(after, melds, luanJiang)
    // 先用无癞子结构筛掉不可能听的散手，避免每次弃牌都枚举34种和牌。
    // 风一色豁免258将，始终交给正式规则确认。
    const mayWait = distance <= 0 || after.every(tile => !/^[mps]/.test(tile))
    const waits = mayWait ? waitingTiles(after, melds, { luanJiang }) : []
    const live = waits.reduce((n, wait) => n + remaining(wait), 0)
    candidates.push({
      index, tile, waits, remaining: live,
      shanten: waits.length ? 0 : Math.max(1, distance),
      ukeire: live, utility: evaluateTileUtility(tile, hand, luanJiang),
    })
  }
  // 有活听即比较可得张数；无活听时，把死听当作需要改良的一向听。
  const liveReady = candidates.filter(candidate => candidate.remaining > 0)
  const pool = liveReady.length ? liveReady : candidates
  if (!liveReady.length) {
    const bestDistance = Math.min(...pool.map(candidate => Math.max(1, candidate.shanten)))
    for (const candidate of pool) {
      candidate.shanten = Math.max(1, candidate.shanten)
      if (candidate.shanten !== bestDistance) continue
      const after = hand.filter((_, index) => index !== candidate.index)
      for (const tile of TILE_TYPES) {
        const live = remaining(tile)
        if (live && shandongShanten([...after, tile], melds, luanJiang) < candidate.shanten) candidate.ukeire += live
      }
    }
  }
  return pool.sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire
    || b.waits.length - a.waits.length || a.utility - b.utility || a.index - b.index)
}

/** AI 自家回合出牌决策 */
export function decideTurn(ctx: ShandongTurnContext): ShandongTurnDecision {
  // 1. 优先自摸胡：只有已明楼或已报听才可自摸胡
  if ((ctx.isMingLou || ctx.isBaoTing) && canWinOnSelfDraw(ctx.hand, ctx.melds, { luanJiang: ctx.luanJiang })) {
    return { kind: 'win' }
  }

  // 2. 若已明搂或已报听，不能换手牌，必须摸打（打出最后摸到的牌）
  if (ctx.isMingLou || ctx.isBaoTing) {
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
  const { index, reachesTing } = chooseBestDiscardIndex(ctx.hand, ctx.melds, ctx.luanJiang, ctx.visibleTiles)

  // 报听与明楼决策：在山东麻将中，必须报听才能胡牌；AI 听牌时必须报听（或偶尔明楼博加倍）
  let declareMingLou = false
  let declareBaoTing = false
  if (reachesTing) {
    if ((ctx.wallCount ?? 40) > 30 && Math.random() < 0.15) {
      declareMingLou = true
    } else {
      declareBaoTing = true
    }
  }

  return { kind: 'discard', handIndex: index, declareMingLou, declareBaoTing }
}

/** AI 响应他人弃牌决策 */
export function decideClaim(ctx: ShandongClaimContext): ShandongClaimAction {
  // 1. 优先点炮胡牌：必须报听后才可点炮胡（明搂者不能点炮胡，未报听者不能胡）
  if (ctx.canHu && ctx.isBaoTing && !ctx.isMingLou) {
    return { kind: 'hu' }
  }

  // 明搂或报听后锁手，不碰、不杠、不吃
  if (ctx.isMingLou || ctx.isBaoTing) {
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
