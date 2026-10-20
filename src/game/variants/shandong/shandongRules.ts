// 山东麻将核心规则：258将、144张牌（含花牌）、花分计算、番型倍数、明搂、过圈、点炮自摸、单响截胡
import type { GamePlayer, Meld, TileType } from '../../core/contracts/types'
import { FLOWER_TILES, HONORS, TILE_TYPES, tileName } from '../../core/rules/tiles'
import { consumeTile, countTiles, firstRemainingTile } from '../../shared/rules/tileTools'
import type { RuleSet } from '../../core/rules/ruleset'

export const SHANDONG_BASE_SCORE = 10

export interface ChiMeld {
  tiles: TileType[]
  kind: 'sequence'
}

export interface WinFlags {
  selfDraw: boolean
  kongBloom?: boolean
  robbedKong?: boolean
  tianhu?: boolean
  dihu?: boolean
  haidi?: boolean
  isMingLou?: boolean
  isBaoTing?: boolean
  luanJiang?: boolean
}

export interface WinCheckOptions {
  luanJiang?: boolean
}

export function parseLuanJiang(options?: WinCheckOptions | boolean): boolean {
  return typeof options === 'boolean' ? options : Boolean(options?.luanJiang)
}

export interface PatternScore {
  name: string
  multiplier: number
}

export interface HuaDetail {
  label: string
  points: number
}

export interface HuaScoreResult {
  totalHua: number
  details: HuaDetail[]
}

export interface HandEvaluation {
  pattern: string
  baseMultiplier: number
  patterns: PatternScore[]
  totalMultiplier: number
  huaPoints: number
  huaDetails: HuaDetail[]
  totalPoints: number
  pairTile?: TileType
  winType: 'self-draw' | 'discard' | 'robbed-kong' | 'tianhu' | 'dihu'
}

export const TERMINAL_AND_HONOR_TILES: readonly TileType[] = [
  'm1', 'm9', 'p1', 'p9', 's1', 's9',
  'east', 'south', 'west', 'north', 'red', 'green', 'white',
]

export const ALL_258_TILES: readonly TileType[] = [
  'm2', 'm5', 'm8',
  'p2', 'p5', 'p8',
  's2', 's5', 's8',
]

/**
 * 判断是否为 258 牌（二万、五万、八万、二筒、五筒、八筒、二条、五条、八条）
 */
export function is258Tile(tile: TileType): boolean {
  const match = /^([mps])([258])$/.exec(tile)
  return Boolean(match)
}

/** 判断是否为花牌（春、夏、秋、冬、梅、兰、竹、菊） */
export function isFlowerTile(tile: TileType): boolean {
  return tile.startsWith('f')
}

/** 创建 144 张山东麻将牌墙（含 8 张花牌） */
export function createShandongWall(): TileType[] {
  return [
    ...TILE_TYPES.flatMap((tile) => Array(4).fill(tile)),
    ...FLOWER_TILES,
  ]
}

/** 确保牌墙牌尾的杠头不是花牌；若为花牌，则与牌墙内靠前的非花牌对调 */
export function ensureTailNotFlower(wall: TileType[]) {
  if (wall.length === 0) return
  const lastIdx = wall.length - 1
  if (!isFlowerTile(wall[lastIdx])) return
  for (let i = 0; i < lastIdx; i += 1) {
    if (!isFlowerTile(wall[i])) {
      const temp = wall[i]
      wall[i] = wall[lastIdx]
      wall[lastIdx] = temp
      return
    }
  }
}

/** 拆解剩余手牌为 needed 组面子（刻子或数牌顺子），纯牌无癞子 */
export function canMakeMelds(
  counts: Map<TileType, number>,
  needed: number,
  memo = new Map<string, boolean>(),
): boolean {
  if (needed <= 0) {
    for (const count of counts.values()) {
      if (count > 0) return false
    }
    return true
  }

  const tile = firstRemainingTile(counts, TILE_TYPES)
  if (!tile) return needed === 0

  const signature = `${needed}|${TILE_TYPES.map((t) => counts.get(t) || 0).join('')}`
  if (memo.has(signature)) return memo.get(signature)!

  const amount = counts.get(tile) || 0

  // 候选 1：刻子（3 张相同）
  if (amount >= 3) {
    if (canMakeMelds(consumeTile(counts, tile, 3), needed - 1, memo)) {
      memo.set(signature, true)
      return true
    }
  }

  // 候选 2：数牌顺子（仅万、筒、条连续 3 张，字牌不可成顺）
  const match = /^([mps])([1-9])$/.exec(tile)
  if (match) {
    const suit = match[1]
    const rank = Number(match[2])
    if (rank <= 7) {
      const t2 = `${suit}${rank + 1}` as TileType
      const t3 = `${suit}${rank + 2}` as TileType
      if ((counts.get(t2) || 0) > 0 && (counts.get(t3) || 0) > 0) {
        let next = consumeTile(counts, tile, 1)
        next = consumeTile(next, t2, 1)
        next = consumeTile(next, t3, 1)
        if (canMakeMelds(next, needed - 1, memo)) {
          memo.set(signature, true)
          return true
        }
      }
    }
  }

  memo.set(signature, false)
  return false
}

/** 过滤副露中的有效面子（排除花牌） */
export function activeMelds(melds: Meld[]): Meld[] {
  return melds.filter((m) => m.type !== 'flower')
}

/** 收集所有 14 张手牌与副露牌（不含花牌） */
export function collectHandAndMeldTiles(hand: TileType[], melds: Meld[]): TileType[] {
  const all = [...hand]
  for (const meld of activeMelds(melds)) {
    all.push(...meld.tiles)
  }
  return all
}

/** 平胡判定：4 面子 + 1 雀头（258 玩法中雀头必须是 2、5、8；乱将玩法中可为任意牌） */
export function canMakePinghu(
  hand: TileType[],
  melds: Meld[],
  options?: WinCheckOptions | boolean,
): { valid: boolean; pair?: TileType } {
  const isLuanJiang = parseLuanJiang(options)
  const effectiveMelds = activeMelds(melds)
  const neededMelds = 4 - effectiveMelds.length
  if (hand.length !== neededMelds * 3 + 2) return { valid: false }

  const counts = countTiles(hand)
  const candidatePairs: TileType[] = []
  for (const [tile, count] of counts.entries()) {
    if (count >= 2 && (isLuanJiang || is258Tile(tile))) {
      candidatePairs.push(tile)
    }
  }

  for (const pair of candidatePairs) {
    const remainingCounts = consumeTile(counts, pair, 2)
    if (canMakeMelds(remainingCounts, neededMelds)) {
      return { valid: true, pair }
    }
  }

  return { valid: false }
}

/** 碰碰胡判定：所有面子均为刻子（或杠），加 1 对将牌（258 玩法中将牌必须为 258；乱将玩法中可为任意牌） */
export function isAllTriplets(
  hand: TileType[],
  melds: Meld[],
  options?: WinCheckOptions | boolean,
): { valid: boolean; pair?: TileType } {
  const isLuanJiang = parseLuanJiang(options)
  const effectiveMelds = activeMelds(melds)
  if (effectiveMelds.some((m) => m.type === 'chi')) return { valid: false }

  const neededMelds = 4 - effectiveMelds.length
  if (hand.length !== neededMelds * 3 + 2) return { valid: false }

  const counts = countTiles(hand)
  for (const [pair, count] of counts.entries()) {
    if (count >= 2 && (isLuanJiang || is258Tile(pair))) {
      const rest = consumeTile(counts, pair, 2)
      let ok = true
      let triplets = 0
      for (const c of rest.values()) {
        if (c > 0) {
          if (c % 3 !== 0) {
            ok = false
            break
          }
          triplets += c / 3
        }
      }
      if (ok && triplets === neededMelds) {
        return { valid: true, pair }
      }
    }
  }

  return { valid: false }
}

/** 七对判定：门清 14 张，恰好 7 个对子（258 玩法中至少有一对是 258 将对；乱将玩法中任意 7 对均可） */
export function isSevenPairs(
  hand: TileType[],
  melds: Meld[],
  options?: WinCheckOptions | boolean,
): { valid: boolean; luxuryCount: number } {
  const isLuanJiang = parseLuanJiang(options)
  if (activeMelds(melds).length > 0 || hand.length !== 14) return { valid: false, luxuryCount: 0 }

  const counts = countTiles(hand)
  let pairs = 0
  let luxuryCount = 0
  let has258Pair = false

  for (const [tile, count] of counts.entries()) {
    if (count === 2) {
      pairs += 1
      if (is258Tile(tile)) has258Pair = true
    } else if (count === 4) {
      pairs += 2
      luxuryCount += 1
      if (is258Tile(tile)) has258Pair = true
    } else {
      return { valid: false, luxuryCount: 0 }
    }
  }

  return { valid: pairs === 7 && (isLuanJiang || has258Pair), luxuryCount }
}

/** 十三幺判定：门清 14 张，13 种幺九字牌各至少 1 张，且其中 1 种成对（豁免 258 将） */
export function isThirteenOrphans(hand: TileType[], melds: Meld[]): boolean {
  if (activeMelds(melds).length > 0 || hand.length !== 14) return false

  const counts = countTiles(hand)
  let hasPair = false

  for (const tile of TERMINAL_AND_HONOR_TILES) {
    const c = counts.get(tile) || 0
    if (c === 0) return false
    if (c === 2) {
      if (hasPair) return false
      hasPair = true
    } else if (c > 2) {
      return false
    }
  }

  return hasPair
}

/**
 * 十三不靠判定（豁免 258 将）：
 * 门清 14 张牌，无对子、无顺子、无刻子。
 * 字牌最多各 1 张；万、筒、条三门数牌，各门间隔至少 3（即分别属于 147、258、369 不同系），全手牌无重复。
 */
export function isShiSanBuKao(hand: TileType[], melds: Meld[]): boolean {
  if (activeMelds(melds).length > 0 || hand.length !== 14) return false
  if (new Set(hand).size !== 14) return false

  const patternSets = [
    new Set([1, 4, 7]),
    new Set([2, 5, 8]),
    new Set([3, 6, 9]),
  ]

  const suitRanks: Record<string, number[]> = { m: [], p: [], s: [] }
  for (const tile of hand) {
    const match = /^([mps])([1-9])$/.exec(tile)
    if (match) {
      suitRanks[match[1]].push(Number(match[2]))
    } else if (!HONORS.includes(tile as typeof HONORS[number])) {
      return false
    }
  }

  // 为万、筒、条分配不同的 pattern
  const suits = ['m', 'p', 's']
  const suitPatternMap: Record<string, number> = {}

  for (const suit of suits) {
    const ranks = suitRanks[suit]
    if (ranks.length === 0) continue
    let foundPattern = -1
    for (let pIdx = 0; pIdx < patternSets.length; pIdx += 1) {
      if (ranks.every((r) => patternSets[pIdx].has(r))) {
        foundPattern = pIdx
        break
      }
    }
    if (foundPattern === -1) return false
    suitPatternMap[suit] = foundPattern
  }

  // 保证非空的门数牌占用的 pattern 不重复
  const usedPatterns = Object.values(suitPatternMap)
  return new Set(usedPatterns).size === usedPatterns.length
}

/** 风一色判定（豁免 258 将）：全由风牌与箭牌组成，且成牌（碰碰胡或七对） */
export function isFengYiSe(hand: TileType[], melds: Meld[]): boolean {
  const all = collectHandAndMeldTiles(hand, melds)
  if (all.length !== 14) return false
  if (!all.every((tile) => HONORS.includes(tile as typeof HONORS[number]))) return false

  // 检查是否能成碰碰胡或七对
  const counts = countTiles(hand)
  const neededMelds = 4 - activeMelds(melds).length
  for (const [pair, count] of counts.entries()) {
    if (count >= 2) {
      const rest = consumeTile(counts, pair, 2)
      let ok = true
      let triplets = 0
      for (const c of rest.values()) {
        if (c > 0) {
          if (c % 3 !== 0) { ok = false; break }
          triplets += c / 3
        }
      }
      if (ok && triplets === neededMelds) return true
    }
  }

  // 字牌七对
  if (activeMelds(melds).length === 0 && hand.length === 14) {
    let pairs = 0
    for (const c of counts.values()) {
      if (c === 2) pairs += 1
      else if (c === 4) pairs += 2
      else return false
    }
    if (pairs === 7) return true
  }

  return false
}

/** 将一色判定（豁免 258 将，天然全由 258 组成）：全部 14 张牌均为 2、5、8 */
export function isJiangYiSe(hand: TileType[], melds: Meld[]): boolean {
  const all = collectHandAndMeldTiles(hand, melds)
  if (all.length !== 14) return false
  if (!all.every((tile) => is258Tile(tile))) return false

  // 检查是否成碰碰胡或七对
  const counts = countTiles(hand)
  const neededMelds = 4 - activeMelds(melds).length
  for (const [pair, count] of counts.entries()) {
    if (count >= 2) {
      const rest = consumeTile(counts, pair, 2)
      let ok = true
      let triplets = 0
      for (const c of rest.values()) {
        if (c > 0) {
          if (c % 3 !== 0) { ok = false; break }
          triplets += c / 3
        }
      }
      if (ok && triplets === neededMelds) return true
    }
  }

  // 全 258 七对
  if (activeMelds(melds).length === 0 && hand.length === 14) {
    let pairs = 0
    for (const c of counts.values()) {
      if (c === 2) pairs += 1
      else if (c === 4) pairs += 2
      else return false
    }
    if (pairs === 7) return true
  }

  return false
}

/** 清一色判定：14 张牌全为同一门数牌，且必须有将牌成胡 */
export function isPureOneSuit(hand: TileType[], melds: Meld[], options?: WinCheckOptions | boolean): boolean {
  const all = collectHandAndMeldTiles(hand, melds)
  if (all.length !== 14) return false

  const firstSuit = /^([mps])/.exec(all[0])?.[1]
  if (!firstSuit) return false

  const isOneSuit = all.every((tile) => {
    const m = /^([mps])/.exec(tile)
    return m && m[1] === firstSuit
  })
  if (!isOneSuit) return false

  const pinghu = canMakePinghu(hand, melds, options)
  if (pinghu.valid) return true
  const seven = isSevenPairs(hand, melds, options)
  if (seven.valid) return true
  const triplets = isAllTriplets(hand, melds, options)
  if (triplets.valid) return true

  return false
}

/** 混一色判定：1 门数牌 + 字牌，且必须有将牌成胡 */
export function isMixedOneSuit(hand: TileType[], melds: Meld[], options?: WinCheckOptions | boolean): boolean {
  const all = collectHandAndMeldTiles(hand, melds)
  if (all.length !== 14) return false

  let suit: string | null = null
  let hasHonors = false
  let hasSuited = false

  for (const tile of all) {
    const m = /^([mps])/.exec(tile)
    if (m) {
      hasSuited = true
      if (suit === null) suit = m[1]
      else if (suit !== m[1]) return false
    } else {
      hasHonors = true
    }
  }

  if (!hasSuited || !hasHonors) return false

  const pinghu = canMakePinghu(hand, melds, options)
  if (pinghu.valid) return true
  const seven = isSevenPairs(hand, melds, options)
  if (seven.valid) return true
  const triplets = isAllTriplets(hand, melds, options)
  if (triplets.valid) return true

  return false
}

/** 一条龙判定：同一门数牌包含 123, 456, 789 顺子，且全手牌成和 */
export function isYiTiaoLong(hand: TileType[], melds: Meld[], options?: WinCheckOptions | boolean): boolean {
  if (!canMakePinghu(hand, melds, options).valid) return false

  const all = collectHandAndMeldTiles(hand, melds)
  for (const suit of ['m', 'p', 's']) {
    const dragonTiles = Array.from({ length: 9 }, (_, i) => `${suit}${i + 1}` as TileType)
    const counts = countTiles(all)
    if (dragonTiles.every((t) => (counts.get(t) || 0) >= 1)) {
      return true
    }
  }
  return false
}

/** 大吊车判定：副露了 4 组（暗手牌只剩 1 张单钓成和） */
export function isDaDiaoChe(hand: TileType[], melds: Meld[], options?: WinCheckOptions | boolean): boolean {
  const isLuanJiang = parseLuanJiang(options)
  return activeMelds(melds).length === 4 && hand.length === 2 && (isLuanJiang || is258Tile(hand[0])) && hand[0] === hand[1]
}

/** 门清判定：没有任何吃、碰、明杠（暗杠不破门清） */
export function isMenQing(melds: Meld[]): boolean {
  return activeMelds(melds).every((m) => m.type === 'angang')
}

/** 花胡判定：摸齐 8 张花牌（八仙过海）或持花胡牌 */
export function isHuaHu(player: GamePlayer): boolean {
  const flowerCount = player.melds.filter((m) => m.type === 'flower').length
  return flowerCount >= 8
}

/** 是否能和牌 */
export function isWinningHand(hand: TileType[], melds: Meld[] = [], options?: WinCheckOptions | boolean): boolean {
  // 特殊豁免 258 将的牌型
  if (isThirteenOrphans(hand, melds)) return true
  if (isShiSanBuKao(hand, melds)) return true
  if (isFengYiSe(hand, melds)) return true
  if (isJiangYiSe(hand, melds)) return true

  // 其他所有牌型根据 options 判定（258 或 乱将）
  if (isSevenPairs(hand, melds, options).valid) return true
  if (isAllTriplets(hand, melds, options).valid) return true
  if (isPureOneSuit(hand, melds, options)) return true
  if (isMixedOneSuit(hand, melds, options)) return true

  return canMakePinghu(hand, melds, options).valid
}

/**
 * 【花分计算】（图二规则）
 * 花牌：1花/个
 * 字明刻：1花/个
 * 字暗刻：1花/个
 * 明杠、补杠（筒条万）：1花/个
 * 暗杠（筒条万）：2花/个
 * 字明杠、补杠：2花/个
 * 字暗杠：3花/个
 * 底分（胡牌玩家固定存在）：1花
 */
export function calculateHuaPoints(
  player: GamePlayer,
  hand: TileType[],
  melds: Meld[] = player.melds,
): HuaScoreResult {
  const details: HuaDetail[] = []

  // 底分（胡牌玩家固定存在）：1花
  details.push({ label: '底分', points: 1 })

  // 花牌：1花/个
  const flowerCount = melds.filter((m) => m.type === 'flower').length
  if (flowerCount > 0) {
    details.push({ label: `花牌(${flowerCount}张)`, points: flowerCount })
  }

  // 副露统计
  for (const meld of activeMelds(melds)) {
    const isHonor = HONORS.includes(meld.tile as typeof HONORS[number])
    if (meld.type === 'peng' && isHonor) {
      details.push({ label: `字明刻(${tileName(meld.tile)})`, points: 1 })
    } else if (meld.type === 'gang') {
      // 明杠 / 补杠
      if (isHonor) {
        details.push({ label: `字明杠(${tileName(meld.tile)})`, points: 2 })
      } else {
        details.push({ label: `明杠(${tileName(meld.tile)})`, points: 1 })
      }
    } else if (meld.type === 'angang') {
      // 暗杠
      if (isHonor) {
        details.push({ label: `字暗杠(${tileName(meld.tile)})`, points: 3 })
      } else {
        details.push({ label: `暗杠(${tileName(meld.tile)})`, points: 2 })
      }
    }
  }

  // 暗手牌中的字暗刻：1花/个
  const handCounts = countTiles(hand)
  for (const honor of HONORS) {
    const c = handCounts.get(honor) || 0
    if (c >= 3) {
      details.push({ label: `字暗刻(${tileName(honor)})`, points: 1 })
    }
  }

  const totalHua = details.reduce((sum, item) => sum + item.points, 0)
  return { totalHua, details }
}

/**
 * 完整算番与算分（图三、四、五规则）
 */
export function evaluateShandongHand(
  player: GamePlayer,
  hand: TileType[],
  melds: Meld[] = player.melds,
  flags: WinFlags = { selfDraw: false },
): HandEvaluation | null {
  const winOptions: WinCheckOptions = { luanJiang: Boolean(flags.luanJiang) }
  if (!isWinningHand(hand, melds, winOptions) && !flags.tianhu && !flags.dihu) return null

  const patterns: PatternScore[] = []
  let mainPattern = '平胡'
  let baseMultiplier = 1

  // 1. 特殊固定倍数（天地胡）：天地胡为固定倍数、不加任何花数，必胡
  if (flags.tianhu) {
    return {
      pattern: '天胡',
      baseMultiplier: 30,
      patterns: [{ name: '天胡', multiplier: 30 }],
      totalMultiplier: 30 * (flags.isMingLou ? 2 : 1),
      huaPoints: 1,
      huaDetails: [{ label: '固定倍数不计花', points: 1 }],
      totalPoints: 30 * (flags.isMingLou ? 2 : 1) * SHANDONG_BASE_SCORE,
      winType: 'tianhu',
    }
  }
  if (flags.dihu) {
    return {
      pattern: '地胡',
      baseMultiplier: 25,
      patterns: [{ name: '地胡', multiplier: 25 }],
      totalMultiplier: 25 * (flags.isMingLou ? 2 : 1),
      huaPoints: 1,
      huaDetails: [{ label: '固定倍数不计花', points: 1 }],
      totalPoints: 25 * (flags.isMingLou ? 2 : 1) * SHANDONG_BASE_SCORE,
      winType: 'dihu',
    }
  }

  // 2. 特殊顶番牌型判断
  const orphans = isThirteenOrphans(hand, melds)
  const bukao = isShiSanBuKao(hand, melds)
  const seven = isSevenPairs(hand, melds, winOptions)
  const fengYiSe = isFengYiSe(hand, melds)
  const jiangYiSe = isJiangYiSe(hand, melds)
  const triplets = isAllTriplets(hand, melds, winOptions)
  const pure = isPureOneSuit(hand, melds, winOptions)
  const mixed = isMixedOneSuit(hand, melds, winOptions)
  const dragon = isYiTiaoLong(hand, melds, winOptions)
  const diaoche = isDaDiaoChe(hand, melds, winOptions)
  const menqing = isMenQing(melds)
  const flowerCount = melds.filter((m) => m.type === 'flower').length

  if (orphans) {
    mainPattern = '十三幺'
    baseMultiplier = 16
    patterns.push({ name: '十三幺', multiplier: 16 })
  } else if (seven.valid && seven.luxuryCount === 3) {
    mainPattern = '超豪华七对'
    baseMultiplier = 16
    patterns.push({ name: '超豪华七对', multiplier: 16 })
  } else if (bukao) {
    mainPattern = '十三不靠'
    baseMultiplier = 12
    patterns.push({ name: '十三不靠', multiplier: 12 })
  } else if (seven.valid && seven.luxuryCount === 2) {
    mainPattern = '双豪华七对'
    baseMultiplier = 8
    patterns.push({ name: '双豪华七对', multiplier: 8 })
  } else if (fengYiSe) {
    mainPattern = '风一色'
    baseMultiplier = 6
    patterns.push({ name: '风一色', multiplier: 6 })
  } else if (jiangYiSe) {
    mainPattern = '将一色'
    baseMultiplier = 6
    patterns.push({ name: '将一色', multiplier: 6 })
  } else if (seven.valid && seven.luxuryCount === 1) {
    mainPattern = '豪华七对'
    baseMultiplier = 4
    patterns.push({ name: '豪华七对', multiplier: 4 })
  } else if (seven.valid) {
    mainPattern = '七对'
    baseMultiplier = 2
    patterns.push({ name: '七对', multiplier: 2 })
  } else if (triplets.valid) {
    mainPattern = '碰碰胡'
    baseMultiplier = 2
    patterns.push({ name: '碰碰胡', multiplier: 2 })
  } else {
    mainPattern = '平胡'
    baseMultiplier = 1
    patterns.push({ name: '平胡', multiplier: 1 })
  }

  // 3. 组合附加番型倍数
  let totalMultiplier = baseMultiplier

  if (pure) {
    patterns.push({ name: '清一色', multiplier: 4 })
    totalMultiplier *= 4
  } else if (mixed) {
    patterns.push({ name: '混一色', multiplier: 2 })
    totalMultiplier *= 2
  }

  if (dragon) {
    patterns.push({ name: '一条龙', multiplier: 4 })
    totalMultiplier *= 4
  }

  if (diaoche) {
    patterns.push({ name: '大吊车', multiplier: 2 })
    totalMultiplier *= 2
  }

  if (menqing && !seven.valid && !orphans && !bukao) {
    patterns.push({ name: '门清', multiplier: 2 })
    totalMultiplier *= 2
  }

  if (flowerCount > 0) {
    patterns.push({ name: '花胡', multiplier: 2 })
    totalMultiplier *= 2
  }

  if (flags.haidi) {
    patterns.push({ name: '海底捞月', multiplier: 2 })
    totalMultiplier *= 2
  }

  if (flags.isMingLou) {
    patterns.push({ name: '明搂', multiplier: 2 })
    totalMultiplier *= 2
  } else if (flags.isBaoTing) {
    patterns.push({ name: '报听', multiplier: 1 })
  }

  // 花分计算（图二）
  const huaResult = calculateHuaPoints(player, hand, melds)

  // 输赢分数计算：花分 × 番型倍数 × 底分
  const totalPoints = huaResult.totalHua * totalMultiplier * SHANDONG_BASE_SCORE

  let winType: 'self-draw' | 'discard' | 'robbed-kong' | 'tianhu' | 'dihu' = flags.selfDraw ? 'self-draw' : 'discard'
  if (flags.robbedKong) winType = 'robbed-kong'

  return {
    pattern: mainPattern,
    baseMultiplier,
    patterns,
    totalMultiplier,
    huaPoints: huaResult.totalHua,
    huaDetails: huaResult.details,
    totalPoints,
    winType,
  }
}

/** 计算当前手牌的听牌集合 */
export function waitingTiles(hand: TileType[], melds: Meld[] = [], options?: WinCheckOptions | boolean): TileType[] {
  const waits: TileType[] = []
  for (const candidate of TILE_TYPES) {
    if (isWinningHand([...hand, candidate], melds, options)) {
      waits.push(candidate)
    }
  }
  return waits
}

export interface MingLouWaitItem {
  tile: TileType
  remaining: number
  fan?: number
}

/**
 * 计算某张牌场面上未出现的剩余张数（玩家已知视角）。
 * 场面上已知的牌包括：
 * 1. 玩家自己的手牌；
 * 2. 所有玩家的弃牌堆；
 * 3. 所有玩家的副露；
 * 4. 其他明楼玩家因亮牌而公开的手牌。
 * 公式：4 - 弃牌堆 - 其他玩家明楼手牌 - 所有玩家副露 - 我的手牌
 */
export function computeUnseenTileCount(
  tile: TileType,
  userHand: TileType[],
  allPlayers: Array<{ hand: TileType[]; melds: Meld[]; discards: TileType[]; isMingLou?: boolean; seat: number }>,
  userSeat: number,
  gangHeadTile?: TileType | null,
): number {
  let seen = 0
  // 1. 本家手牌
  for (const t of userHand) {
    if (t === tile) seen++
  }
  // 2. 所有玩家弃牌与副露（含本家与他家）
  for (const p of allPlayers) {
    for (const d of p.discards) {
      if (d === tile) seen++
    }
    for (const m of p.melds) {
      for (const t of m.tiles) {
        if (t === tile) seen++
      }
    }
    // 3. 其他明楼玩家公开亮出的手牌
    if (p.isMingLou && p.seat !== userSeat) {
      for (const t of p.hand) {
        if (t === tile) seen++
      }
    }
  }
  // 4. 全局公开的杠头牌
  if (gangHeadTile && gangHeadTile === tile) {
    seen++
  }
  return Math.max(0, 4 - seen)
}

/**
 * 从玩家视角计算明搂玩家胡什么牌，以及每张牌剩余张数。
 * 玩家视角内已知的牌包括：
 * 1. 玩家自己的手牌；
 * 2. 所有玩家的牌河弃牌与副露；
 * 3. 其他明搂玩家因亮牌而公开的手牌；
 * 4. 全局公开的杠头牌。
 */
export function computeMingLouWaits(
  mingLouPlayer: { hand: TileType[]; melds: Meld[]; drawnTileIndex?: number },
  userHand: TileType[],
  allPlayers: Array<{ hand: TileType[]; melds: Meld[]; discards: TileType[]; isMingLou?: boolean; seat: number }>,
  userSeat: number,
  options?: WinCheckOptions | boolean,
  gangHeadTile?: TileType | null,
): MingLouWaitItem[] {
  const hand = mingLouPlayer.hand
  // 如果手牌处于摸牌阶段（length % 3 === 2，如14/11/8/5/2张），需剥离摸到的牌计算基础听口
  const baseHand = hand.length % 3 === 2
    ? (mingLouPlayer.drawnTileIndex !== undefined && mingLouPlayer.drawnTileIndex >= 0 && mingLouPlayer.drawnTileIndex < hand.length
        ? hand.filter((_, i) => i !== mingLouPlayer.drawnTileIndex)
        : hand.slice(0, -1))
    : hand
  const waits = waitingTiles(baseHand, mingLouPlayer.melds, options)
  return waits.map((tile) => {
    const fullHand = [...baseHand, tile]
    const evalRes = evaluateShandongHand(
      mingLouPlayer as any,
      fullHand,
      mingLouPlayer.melds,
      {
        selfDraw: true,
        isMingLou: true,
        luanJiang: Boolean(options && (typeof options === 'object' ? options.luanJiang : options)),
      },
    )
    return {
      tile,
      remaining: computeUnseenTileCount(tile, userHand, allPlayers, userSeat, gangHeadTile),
      fan: evalRes?.totalMultiplier ?? 2,
    }
  })
}

/** 吃牌判定 */
export function canChi(hand: TileType[], discardTile: TileType): ChiMeld[] {
  const match = /^([mps])([1-9])$/.exec(discardTile)
  if (!match) return []

  const suit = match[1]
  const rank = Number(match[2])
  const counts = countTiles(hand)
  const options: ChiMeld[] = []

  // 1: [rank-2, rank-1, rank]
  if (rank >= 3) {
    const t1 = `${suit}${rank - 2}` as TileType
    const t2 = `${suit}${rank - 1}` as TileType
    if ((counts.get(t1) || 0) > 0 && (counts.get(t2) || 0) > 0) {
      options.push({ tiles: [t1, t2, discardTile], kind: 'sequence' })
    }
  }

  // 2: [rank-1, rank, rank+1]
  if (rank >= 2 && rank <= 8) {
    const t1 = `${suit}${rank - 1}` as TileType
    const t2 = `${suit}${rank + 1}` as TileType
    if ((counts.get(t1) || 0) > 0 && (counts.get(t2) || 0) > 0) {
      options.push({ tiles: [t1, discardTile, t2], kind: 'sequence' })
    }
  }

  // 3: [rank, rank+1, rank+2]
  if (rank <= 7) {
    const t1 = `${suit}${rank + 1}` as TileType
    const t2 = `${suit}${rank + 2}` as TileType
    if ((counts.get(t1) || 0) > 0 && (counts.get(t2) || 0) > 0) {
      options.push({ tiles: [discardTile, t1, t2], kind: 'sequence' })
    }
  }

  return options
}

/** 碰牌判定 */
export function canPeng(hand: TileType[], discardTile: TileType): boolean {
  if (isFlowerTile(discardTile)) return false
  return hand.filter((t) => t === discardTile).length >= 2
}

/** 明杠判定 */
export function canGangFromDiscard(hand: TileType[], discardTile: TileType): boolean {
  if (isFlowerTile(discardTile)) return false
  return hand.filter((t) => t === discardTile).length >= 3
}

/** 暗杠判定 */
export function canConcealedGang(hand: TileType[]): TileType[] {
  const counts = countTiles(hand)
  const kongs: TileType[] = []
  for (const [tile, count] of counts.entries()) {
    if (count === 4 && !isFlowerTile(tile)) {
      kongs.push(tile)
    }
  }
  return kongs
}

/** 补杠判定 */
export function canAddedGang(hand: TileType[], melds: Meld[]): Array<{ meldIndex: number; tile: TileType }> {
  const handSet = new Set(hand)
  const candidates: Array<{ meldIndex: number; tile: TileType }> = []
  melds.forEach((meld, index) => {
    if (meld.type === 'peng' && handSet.has(meld.tile)) {
      candidates.push({ meldIndex: index, tile: meld.tile })
    }
  })
  return candidates
}

/** 抢杠胡判定 */
export function canRobKong(hand: TileType[], kongTile: TileType, melds: Meld[] = [], options?: WinCheckOptions | boolean): boolean {
  return isWinningHand([...hand, kongTile], melds, options)
}

/** 点炮胡判定 */
export function canWinOnDiscard(hand: TileType[], discardTile: TileType, melds: Meld[] = [], options?: WinCheckOptions | boolean): boolean {
  return isWinningHand([...hand, discardTile], melds, options)
}

/** 自摸胡判定 */
export function canWinOnSelfDraw(hand: TileType[], melds: Meld[] = [], options?: WinCheckOptions | boolean): boolean {
  return isWinningHand(hand, melds, options)
}

export function createShandongRuleset(options?: WinCheckOptions): RuleSet {
  return {
    id: 'shandong',
    baseScore: SHANDONG_BASE_SCORE,
    flow: {
      mode: 'single-win',
      continueAfterWin: false,
      allowMultipleWinners: false,
    },
    win: {
      isWinningHand: (tiles) => isWinningHand(tiles, [], options),
      waitingTiles: (tiles) => waitingTiles(tiles, [], options),
      canRobKong: (tiles, kongTile) => canRobKong(tiles, kongTile, [], options),
      concealedKongs: (tiles) => canConcealedGang(tiles),
    },
    score: {
      scoreHand: () => ({
        multiplier: 1,
        totalMultiplier: 1,
        horsePoints: 0,
        points: SHANDONG_BASE_SCORE,
        details: [{ label: '平胡', multiplier: 1, points: SHANDONG_BASE_SCORE }],
      }),
      applyKongScore: () => [],
      applyWinScore: (players, winnerIndex, points, payerIndex = null) => {
        const payers = Number.isInteger(payerIndex)
          ? [payerIndex]
          : players.map((_, i) => i).filter((i) => i !== winnerIndex)
        let totalWon = 0
        payers.forEach((i) => {
          players[i].score -= points
          players[winnerIndex].score += points
          totalWon += points
        })
        return totalWon
      },
    },
  }
}

export const SHANDONG_RULESET: RuleSet = createShandongRuleset()
