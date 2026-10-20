import { describe, expect, it } from 'vitest'
import type { GamePlayer, Meld, TileType } from '../../core/contracts/types'
import {
  calculateHuaPoints,
  canChi,
  canMakePinghu,
  computeMingLouWaits,
  computeUnseenTileCount,
  createShandongWall,
  evaluateShandongHand,
  is258Tile,
  isAllTriplets,
  isDaDiaoChe,
  isFengYiSe,
  isFlowerTile,
  isJiangYiSe,
  isMixedOneSuit,
  isPureOneSuit,
  isSevenPairs,
  isShiSanBuKao,
  isThirteenOrphans,
  isWinningHand,
  isYiTiaoLong,
  waitingTiles,
} from './shandongRules'

function makeMockPlayer(partial: Partial<GamePlayer> = {}): GamePlayer {
  return {
    name: '玩家',
    avatar: '',
    score: 2000,
    seat: 0,
    hand: [],
    discards: [],
    melds: [],
    redCount: 0,
    drawnTileIndex: -1,
    ...partial,
  }
}

describe('山东麻将规则测试（图文规则精准落地）', () => {
  describe('牌墙与花牌', () => {
    it('牌墙使用 144 张牌（136张数牌字牌 + 8张花牌）', () => {
      const wall = createShandongWall()
      expect(wall.length).toBe(144)
      const flowers = wall.filter(isFlowerTile)
      expect(flowers.length).toBe(8)
    })
  })

  describe('258 将玩法与豁免牌型', () => {
    it('除花胡、风一色、将一色、十三不靠、十三幺外，所有牌型必须有 2、5、8 的将对', () => {
      // 平胡带 258 将（2万）=> 能胡
      const pinghu258: TileType[] = [
        'm1', 'm2', 'm3',
        'p4', 'p5', 'p6',
        's7', 's8', 's9',
        's1', 's1', 's1',
        'm2', 'm2',
      ]
      expect(canMakePinghu(pinghu258, []).valid).toBe(true)
      expect(isWinningHand(pinghu258)).toBe(true)

      // 平胡非 258 将（3万）=> 不能胡！
      const pinghuNon258: TileType[] = [
        'm1', 'm2', 'm3',
        'p4', 'p5', 'p6',
        's7', 's8', 's9',
        's1', 's1', 's1',
        'm3', 'm3',
      ]
      expect(canMakePinghu(pinghuNon258, []).valid).toBe(false)
      expect(isWinningHand(pinghuNon258)).toBe(false)

      // 碰碰胡带 258 将（5筒）=> 能胡
      const triplets258: TileType[] = [
        'm1', 'm1', 'm1',
        'p3', 'p3', 'p3',
        's7', 's7', 's7',
        'east', 'east', 'east',
        'p5', 'p5',
      ]
      expect(isAllTriplets(triplets258, []).valid).toBe(true)
      expect(isWinningHand(triplets258)).toBe(true)

      // 碰碰胡不带 258 将（东风作将）=> 必须有 258 将，因此不能胡！
      const tripletsNon258: TileType[] = [
        'm1', 'm1', 'm1',
        'p3', 'p3', 'p3',
        's7', 's7', 's7',
        's9', 's9', 's9',
        'east', 'east',
      ]
      expect(isAllTriplets(tripletsNon258, []).valid).toBe(false)
      expect(isWinningHand(tripletsNon258)).toBe(false)
    })

    it('风一色豁免 258 将', () => {
      const feng: TileType[] = [
        'east', 'east', 'east',
        'south', 'south', 'south',
        'west', 'west', 'west',
        'north', 'north', 'north',
        'red', 'red', // 红中为将
      ]
      expect(isFengYiSe(feng, [])).toBe(true)
      expect(isWinningHand(feng)).toBe(true)
    })

    it('将一色天然由 258 组成', () => {
      const jiang: TileType[] = [
        'm2', 'm2', 'm2',
        'm5', 'm5', 'm5',
        'p8', 'p8', 'p8',
        's2', 's2', 's2',
        's5', 's5',
      ]
      expect(isJiangYiSe(jiang, [])).toBe(true)
      expect(isWinningHand(jiang)).toBe(true)
    })

    it('十三不靠豁免 258 将', () => {
      // 万 147，筒 258，条 369，字牌 5 张各不相同
      const bukao: TileType[] = [
        'm1', 'm4', 'm7',
        'p2', 'p5', 'p8',
        's3', 's6', 's9',
        'east', 'south', 'west', 'north', 'red',
      ]
      expect(isShiSanBuKao(bukao, [])).toBe(true)
      expect(isWinningHand(bukao)).toBe(true)
    })

    it('十三幺豁免 258 将', () => {
      const orphans: TileType[] = [
        'm1', 'm9', 'p1', 'p9', 's1', 's9',
        'east', 'south', 'west', 'north',
        'red', 'green', 'white',
        'm1',
      ]
      expect(isThirteenOrphans(orphans, [])).toBe(true)
      expect(isWinningHand(orphans)).toBe(true)
    })

    it('七对必须包含至少一对 258 将对', () => {
      // 包含一对 8条 (258)
      const qiduiWith258: TileType[] = [
        'm1', 'm1',
        'm3', 'm3',
        'p4', 'p4',
        's6', 's6',
        's8', 's8', // 258对
        'east', 'east',
        'white', 'white',
      ]
      expect(isSevenPairs(qiduiWith258, []).valid).toBe(true)
      expect(isWinningHand(qiduiWith258)).toBe(true)

      // 完全没有 258 对的七对 => 不能胡！
      const qiduiNo258: TileType[] = [
        'm1', 'm1',
        'm3', 'm3',
        'p4', 'p4',
        's6', 's6',
        's7', 's7',
        'east', 'east',
        'white', 'white',
      ]
      expect(isSevenPairs(qiduiNo258, []).valid).toBe(false)
      expect(isWinningHand(qiduiNo258)).toBe(false)
    })
  })

  describe('花分计算（图二规则）', () => {
    it('正确计算底分、花牌、字明刻/暗刻、数杠、字杠', () => {
      const melds: Meld[] = [
        { type: 'flower', tile: 'f1', tiles: ['f1'] },
        { type: 'flower', tile: 'f2', tiles: ['f2'] }, // 2 张花牌 = 2花
        { type: 'peng', tile: 'east', tiles: ['east', 'east', 'east'] }, // 字明刻 = 1花
        { type: 'gang', tile: 'm5', tiles: ['m5', 'm5', 'm5', 'm5'] }, // 数明杠 = 1花
        { type: 'angang', tile: 'red', tiles: ['red', 'red', 'red', 'red'] }, // 字暗杠 = 3花
      ]
      // 手牌中有字暗刻（白板3张 = 1花）
      const hand: TileType[] = [
        'white', 'white', 'white',
        's2', 's2', // 2条将
      ]
      const player = makeMockPlayer({ melds, hand })
      const hua = calculateHuaPoints(player, hand, melds)

      // 预期：
      // 底分: 1花
      // 花牌: 2花
      // 字明刻: 1花
      // 数明杠: 1花
      // 字暗杠: 3花
      // 字暗刻: 1花
      // 总计: 1 + 2 + 1 + 1 + 3 + 1 = 9花
      expect(hua.totalHua).toBe(9)
    })
  })

  describe('番型倍数与总分结算（图三、四、五规则）', () => {
    it('平胡赢分 = 花分 × 1 × 底分', () => {
      const hand: TileType[] = [
        'm1', 'm2', 'm3',
        'p4', 'p5', 'p6',
        's7', 's8', 's9',
        's1', 's1', 's1',
        'm2', 'm2',
      ]
      const player = makeMockPlayer({ hand })
      const evalResult = evaluateShandongHand(player, hand, [], { selfDraw: false })
      expect(evalResult).not.toBeNull()
      expect(evalResult?.baseMultiplier).toBe(1)
      expect(evalResult?.pattern).toBe('平胡')
      // 底分 1花，门清×2 => totalMultiplier=2, hua=1, points = 1 * 2 * 10 = 20
      expect(evalResult?.huaPoints).toBe(1)
      expect(evalResult?.totalMultiplier).toBe(2)
      expect(evalResult?.totalPoints).toBe(20)
    })

    it('一条龙 ×4 门清 ×2', () => {
      // 123万 456万 789万 + 111条 + 55条（将）
      const dragonHand: TileType[] = [
        'm1', 'm2', 'm3',
        'm4', 'm5', 'm6',
        'm7', 'm8', 'm9',
        's1', 's1', 's1',
        's5', 's5',
      ]
      expect(isYiTiaoLong(dragonHand, [])).toBe(true)
      const player = makeMockPlayer({ hand: dragonHand })
      const evalResult = evaluateShandongHand(player, dragonHand, [], { selfDraw: false })
      expect(evalResult?.patterns.some((p) => p.name === '一条龙' && p.multiplier === 4)).toBe(true)
      expect(evalResult?.patterns.some((p) => p.name === '门清' && p.multiplier === 2)).toBe(true)
      // 平胡1 * 一条龙4 * 门清2 = 8倍
      expect(evalResult?.totalMultiplier).toBe(8)
    })

    it('大吊车 ×2', () => {
      const melds: Meld[] = [
        { type: 'chi', tile: 'm1', tiles: ['m1', 'm2', 'm3'] },
        { type: 'peng', tile: 'p1', tiles: ['p1', 'p1', 'p1'] },
        { type: 'peng', tile: 'p3', tiles: ['p3', 'p3', 'p3'] },
        { type: 'gang', tile: 's1', tiles: ['s1', 's1', 's1', 's1'] },
      ]
      const hand: TileType[] = ['s8', 's8'] // 单钓 8条（258）成和
      expect(isDaDiaoChe(hand, melds)).toBe(true)
      const player = makeMockPlayer({ hand, melds })
      const evalResult = evaluateShandongHand(player, hand, melds, { selfDraw: false })
      expect(evalResult?.patterns.some((p) => p.name === '大吊车' && p.multiplier === 2)).toBe(true)
    })

    it('明搂输赢翻倍（×2）', () => {
      const hand: TileType[] = [
        'm1', 'm2', 'm3',
        'p4', 'p5', 'p6',
        's7', 's8', 's9',
        's1', 's1', 's1',
        'm2', 'm2',
      ]
      const player = makeMockPlayer({ hand })
      const evalResult = evaluateShandongHand(player, hand, [], { selfDraw: true, isMingLou: true })
      expect(evalResult?.patterns.some((p) => p.name === '明搂' && p.multiplier === 2)).toBe(true)
      expect(evalResult?.totalMultiplier).toBe(4) // 门清2 * 明搂2 = 4
    })

    it('天胡 ×30，固定倍数不加花', () => {
      const hand: TileType[] = [
        'm1', 'm2', 'm3',
        'p4', 'p5', 'p6',
        's7', 's8', 's9',
        's1', 's1', 's1',
        'm2', 'm2',
      ]
      const player = makeMockPlayer({ hand })
      const evalResult = evaluateShandongHand(player, hand, [], { selfDraw: true, tianhu: true })
      expect(evalResult?.pattern).toBe('天胡')
      expect(evalResult?.totalMultiplier).toBe(30)
      expect(evalResult?.totalPoints).toBe(30 * 10) // 固定倍数 * 底分
      expect(evalResult?.winType).toBe('tianhu')
    })

    it('地胡 ×25，固定倍数不加花', () => {
      const hand: TileType[] = [
        'm1', 'm2', 'm3',
        'p4', 'p5', 'p6',
        's7', 's8', 's9',
        's1', 's1', 's1',
        'm2', 'm2',
      ]
      const player = makeMockPlayer({ hand })
      const evalResult = evaluateShandongHand(player, hand, [], { selfDraw: true, dihu: true })
      expect(evalResult?.pattern).toBe('地胡')
      expect(evalResult?.totalMultiplier).toBe(25)
      expect(evalResult?.totalPoints).toBe(25 * 10)
      expect(evalResult?.winType).toBe('dihu')
    })
  })

  describe('258掌将 与 乱将（任意将）规则选项', () => {
    const pinghuWith3Pair: TileType[] = [
      'm1', 'm2', 'm3',
      'p4', 'p5', 'p6',
      's7', 's8', 's9',
      's1', 's1', 's1',
      'm3', 'm3', // 3万将牌，非 258
    ]

    it('平胡：258 玩法下非 258 不能成和，乱将玩法下任意牌均可作为雀头和牌', () => {
      // 默认（258规则）
      expect(canMakePinghu(pinghuWith3Pair, []).valid).toBe(false)
      expect(isWinningHand(pinghuWith3Pair)).toBe(false)
      expect(isWinningHand(pinghuWith3Pair, [], { luanJiang: false })).toBe(false)

      // 乱将规则
      expect(canMakePinghu(pinghuWith3Pair, [], { luanJiang: true }).valid).toBe(true)
      expect(isWinningHand(pinghuWith3Pair, [], { luanJiang: true })).toBe(true)

      const player = makeMockPlayer({ hand: pinghuWith3Pair })
      const eval258 = evaluateShandongHand(player, pinghuWith3Pair, [], { selfDraw: true, luanJiang: false })
      expect(eval258).toBeNull()

      const evalLuan = evaluateShandongHand(player, pinghuWith3Pair, [], { selfDraw: true, luanJiang: true })
      expect(evalLuan).not.toBeNull()
      expect(evalLuan?.pattern).toBe('平胡')
    })

    it('碰碰胡：乱将玩法下非 258 将牌亦可和碰碰胡', () => {
      const tripletsWith1Pair: TileType[] = [
        'm3', 'm3', 'm3',
        'p4', 'p4', 'p4',
        's6', 's6', 's6',
        's9', 's9', 's9',
        'm1', 'm1', // 1万将牌
      ]
      expect(isAllTriplets(tripletsWith1Pair, []).valid).toBe(false)
      expect(isAllTriplets(tripletsWith1Pair, [], { luanJiang: false }).valid).toBe(false)
      expect(isAllTriplets(tripletsWith1Pair, [], { luanJiang: true }).valid).toBe(true)
      expect(isWinningHand(tripletsWith1Pair, [], { luanJiang: true })).toBe(true)
    })

    it('七对：乱将玩法下无需包含 258 对子即可和七对', () => {
      const sevenPairsNon258: TileType[] = [
        'm1', 'm1',
        'm3', 'm3',
        'm4', 'm4',
        'm6', 'm6',
        'm7', 'm7',
        'm9', 'm9',
        'p1', 'p1',
      ]
      expect(isSevenPairs(sevenPairsNon258, []).valid).toBe(false)
      expect(isSevenPairs(sevenPairsNon258, [], { luanJiang: false }).valid).toBe(false)
      expect(isSevenPairs(sevenPairsNon258, [], { luanJiang: true }).valid).toBe(true)
      expect(isWinningHand(sevenPairsNon258, [], { luanJiang: true })).toBe(true)
    })

    it('听牌计算：乱将模式下可听非 258 单钓或雀头牌', () => {
      // 13张手牌，单钓 3万
      const singleWaitHand: TileType[] = [
        'm1', 'm2', 'm3',
        'p4', 'p5', 'p6',
        's7', 's8', 's9',
        's1', 's1', 's1',
        'm3',
      ]
      // 258模式下单钓 3万无法胡牌（因为雀头是 3万），所以听牌列表不含 3万
      const waits258 = waitingTiles(singleWaitHand, [], { luanJiang: false })
      expect(waits258.includes('m3')).toBe(false)

      // 乱将模式下单钓 3万可以胡牌，听牌列表中必定包含 3万
      const waitsLuan = waitingTiles(singleWaitHand, [], { luanJiang: true })
      expect(waitsLuan.includes('m3')).toBe(true)
    })
  })

  describe('规则选择与持久化测试', () => {
    it('readRuleVariantPreference 与 saveRuleVariantPreference 能够正确读写与校验规则偏好', async () => {
      const {
        readRuleVariantPreference,
        saveRuleVariantPreference,
        readShandongJiangPreference,
        saveShandongJiangPreference,
      } = await import('../../core/rules/rulePreference')

      const mockStorage = new Map<string, string>()
      const storageLike = {
        getItem: (k: string) => mockStorage.get(k) ?? null,
        setItem: (k: string, v: string) => { mockStorage.set(k, v) },
      }

      // 初始未保存
      expect(readRuleVariantPreference(storageLike)).toBeNull()
      expect(readShandongJiangPreference(storageLike)).toBe('258')

      // 保存山东麻将
      saveRuleVariantPreference('shandong', storageLike)
      expect(readRuleVariantPreference(storageLike)).toBe('shandong')

      // 保存乱将
      saveShandongJiangPreference('luan', storageLike)
      expect(readShandongJiangPreference(storageLike)).toBe('luan')

      // 保存258
      saveShandongJiangPreference('258', storageLike)
      expect(readShandongJiangPreference(storageLike)).toBe('258')
    })
  })

  describe('杠头牌与报听规则测试', () => {
    it('computeUnseenTileCount 扣减公开的杠头牌', () => {
      const userHand: TileType[] = ['m1', 'm2']
      const players = [
        makeMockPlayer({ seat: 0, hand: userHand }),
        makeMockPlayer({ seat: 1, hand: ['m5', 'm6'] }),
      ]

      // 未指定杠头牌时，m1在手有1张，场外剩余 4 - 1 = 3
      expect(computeUnseenTileCount('m1', userHand, players, 0)).toBe(3)

      // 杠头牌公开为 m1 时，场外剩余变为 4 - 1(手牌) - 1(杠头) = 2
      expect(computeUnseenTileCount('m1', userHand, players, 0, 'm1')).toBe(2)

      // 杠头牌为 p9 时，对 m1 无影响
      expect(computeUnseenTileCount('m1', userHand, players, 0, 'p9')).toBe(3)
    })

    it('computeMingLouWaits 考虑公开的杠头牌', () => {
      const p1 = makeMockPlayer({
        seat: 1,
        isMingLou: true,
        hand: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 's2', 's2', 's3', 's4'], // 听 s2/s5
      })
      const userHand: TileType[] = ['s2']
      const players = [
        makeMockPlayer({ seat: 0, hand: userHand }),
        p1,
      ]

      // s2 在本家手牌有1张，p1明楼手牌有2张。未算杠头时剩余 4 - 1 - 2 = 1
      const waitsBefore = computeMingLouWaits(p1, userHand, players, 0, { luanJiang: true }, null)
      const wait2sBefore = waitsBefore.find((w) => w.tile === 's2')
      expect(wait2sBefore?.remaining).toBe(1)

      // 杠头公开为 s2 时，剩余 4 - 1(我) - 2(他明楼) - 1(杠头) = 0
      const waitsAfter = computeMingLouWaits(p1, userHand, players, 0, { luanJiang: true }, 's2')
      const wait2sAfter = waitsAfter.find((w) => w.tile === 's2')
      expect(wait2sAfter?.remaining).toBe(0)
    })

    it('报听与明楼算番：明楼番数*2，报听记录番型倍数正常', () => {
      const hand: TileType[] = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p2', 'p3', 'p4', 's5', 's5']
      const player = makeMockPlayer({ hand })

      // 普通自摸（报听）
      const evalBaoTing = evaluateShandongHand(player, hand, [], { selfDraw: true, isBaoTing: true })
      expect(evalBaoTing?.patterns.some((p) => p.name === '报听')).toBe(true)
      expect(evalBaoTing?.totalMultiplier).toBe(8) // 一条龙 (4) * 门清 (2)

      // 明楼自摸
      const evalMingLou = evaluateShandongHand(player, hand, [], { selfDraw: true, isMingLou: true })
      expect(evalMingLou?.patterns.some((p) => p.name === '明搂')).toBe(true)
      expect(evalMingLou?.totalMultiplier).toBe(16) // 一条龙 (4) * 门清 (2) * 明搂 (2) = 16
    })
  })
})
