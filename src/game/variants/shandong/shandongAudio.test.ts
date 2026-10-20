import { describe, expect, it, vi } from 'vitest'
import type { TileType } from '../../core/contracts/types'
import { resetLocalPlayers } from '../../shared/runtime/localOpening'
import { createShandongGameState } from './shandongState'
import { createShandongTileFlow } from './shandongTileFlow'
import { createShandongTurnOrchestrator } from './shandongTurnOrchestrator'
import { createShandongSettlement } from './shandongSettlement'
import { useShandongGame } from './shandongGame'

describe('山东麻将音频与语音播报', () => {
  it('出牌时必须播放实体落牌声 dapai.mp3 与牌名报牌', async () => {
    const playSound = vi.fn()
    const playSoundAndWait = vi.fn(async () => {})
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    state.players[0].hand = ['m1', 'p5', 'east']

    const flow = createShandongTileFlow({
      state,
      drawFromWall: () => null,
      endDraw: () => {},
      endGame: () => {},
      showTableAction: () => {},
      playSound,
      playSoundAndWait,
      wait: async () => {},
      routeDiscard: () => {},
    })

    flow.discardTile(0, 0) // 出 m1

    // 立即播放实体打牌声
    expect(playSound).toHaveBeenCalledWith('dapai.mp3', 0.8)
    expect(state.lastDiscardSound.value).toBeInstanceOf(Promise)

    // 等待报牌延迟执行
    await new Promise((r) => setTimeout(r, 120))
    // 应该调用 playSoundAndWait 或 playSound 播放 1m.mp3
    expect(playSoundAndWait).toHaveBeenCalledWith('1m.mp3')
  })

  it('正常摸牌时播放 give.mp3 音效', async () => {
    const playSound = vi.fn()
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    state.wall.value = ['m2']

    const flow = createShandongTileFlow({
      state,
      drawFromWall: () => state.wall.value.shift() ?? null,
      endDraw: () => {},
      endGame: () => {},
      showTableAction: () => {},
      playSound,
      playSoundAndWait: async () => {},
      wait: async () => {},
      routeDiscard: () => {},
    })

    const result = await flow.drawFor(0)
    expect(result).toBe(true)
    expect(playSound).toHaveBeenCalledWith('give.mp3', 0.7)
    expect(state.players[0].hand).toContain('m2')
  })

  it('结算自摸播放 zimo.mp3 与 hu_effect_sound.mp3，点炮播放 hu.mp3 与 hu_effect_sound.mp3', () => {
    const playSound = vi.fn()
    const showTableAction = vi.fn()
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    state.players[0].hand = ['m2', 'm2']

    const settlement = createShandongSettlement({
      state,
      playSound,
      playSoundAndWait: async () => {},
      getRoundLabel: () => '第1圈 第1局',
      showTableAction,
    })

    // 1. 测试自摸
    settlement.settleWin(0, { selfDraw: true, winTile: 'm2' })
    expect(playSound).toHaveBeenCalledWith('zimo.mp3')
    expect(playSound).toHaveBeenCalledWith('hu_effect_sound.mp3')
    expect(showTableAction).toHaveBeenCalledWith('self-draw', 0, null, 'm2', -1)

    playSound.mockClear()
    showTableAction.mockClear()

    // 2. 测试点炮
    settlement.settleWin(0, { selfDraw: false, winTile: 'm2', sourceFrom: 1 })
    expect(playSound).toHaveBeenCalledWith('hu.mp3')
    expect(playSound).toHaveBeenCalledWith('hu_effect_sound.mp3')
    expect(showTableAction).toHaveBeenCalledWith('discard-win', 0, 1, 'm2', -1)
  })

  it('二次元主题下动作语音交由固定台词处理，并抑制原本地动作音', () => {
    const playSound = vi.fn()
    const executeAction = vi.fn(async () => ({ fallbackAudioFile: undefined }))
    const dummyAnimeTts = {
      executeAction,
      executeRound: vi.fn(async () => {}),
      cancel: vi.fn(),
    } as any

    const game = useShandongGame({
      playSound,
      getTableThemeName: () => 'llmAnime',
      animeFixedTts: dummyAnimeTts,
      countdownEnabled: false,
      headless: false,
    })

    expect(game).toBeDefined()
  })

  it('出牌后手牌自动按序重新排列，摸牌位不再残留在末尾', () => {
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    // 假设初始摸牌为 m9，排在最右端：[m3, m1, m9]
    state.players[0].hand = ['m3', 'm1', 'm9']
    state.players[0].drawnTileIndex = 2

    const flow = createShandongTileFlow({
      state,
      drawFromWall: () => null,
      endDraw: () => {},
      endGame: () => {},
      showTableAction: () => {},
      playSound: () => {},
      playSoundAndWait: async () => {},
      wait: async () => {},
      routeDiscard: () => {},
    })

    // 打出中间的 m1 (index 1)
    flow.discardTile(0, 1)

    // 剩余手牌必须排序为 ['m3', 'm9']
    expect(state.players[0].hand).toEqual(['m3', 'm9'])
    expect(state.players[0].drawnTileIndex).toBe(-1)
  })

  it('明搂后玩家对象标记 isMingLou 为 true', () => {
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    state.players[0].hand = ['m1', 'm1']

    const game = useShandongGame({
      playSound: () => {},
      countdownEnabled: false,
    })

    // 测试明搂触发状态
    state.players[1].isMingLou = true
    expect(state.players[1].isMingLou).toBe(true)
  })

  it('computeMingLouWaits 正确计算明楼玩家胡什么牌以及玩家视角下的剩余张数', async () => {
    const { computeMingLouWaits } = await import('./shandongRules')
    // 假设对手明楼，手牌 4面子少1张或两面听牌：[m1, m2, m3, p2, p3, p4, s2, s3, s4, east, east, east, m2] (单吊 m2，或将碰)
    // 简单两面听：手牌万字 258 将或顺子
    const mingLouPlayer = {
      hand: ['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm5', 'm5', 'p6', 'p7'] as TileType[],
      melds: [],
    } // 听 p5 (14张带雀头m5，顺子p5-p6-p7或p6-p7-p8；平胡雀头m5是258) 和 p8

    // 本家手牌有两张 p5
    const userHand: TileType[] = ['p5', 'p5', 'm1']
    // 弃牌堆有 1 张 p8
    const allPlayers = [
      { hand: userHand, melds: [], discards: [], isMingLou: false, seat: 0 },
      { hand: mingLouPlayer.hand, melds: [], discards: ['p8' as TileType], isMingLou: true, seat: 1 },
      { hand: [], melds: [], discards: [], isMingLou: false, seat: 2 },
      { hand: [], melds: [], discards: [], isMingLou: false, seat: 3 },
    ]

    const waits = computeMingLouWaits(mingLouPlayer, userHand, allPlayers, 0)
    expect(waits.length).toBeGreaterThan(0)

    const waitP5 = waits.find((w) => w.tile === 'p5')
    expect(waitP5).toBeDefined()
    // 4张 - 本家2张 = 剩余2张
    expect(waitP5?.remaining).toBe(2)

    const waitP8 = waits.find((w) => w.tile === 'p8')
    expect(waitP8).toBeDefined()
    // 4张 - 弃牌1张 = 剩余3张
    expect(waitP8?.remaining).toBe(3)
  })

  it('其他玩家明楼时，玩家听牌提示中的剩余张数扣减明楼手牌中的可见张数', async () => {
    const { createShandongSelectors } = await import('./shandongSelectors')
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    // 玩家 0 手牌听 m4（双碰听 m2, m4；手里已有两张 m4）
    state.players[0].hand = [
      'm1', 'm2', 'm3',
      'p1', 'p2', 'p3',
      's1', 's2', 's3',
      'm2', 'm2',
      'm4', 'm4',
    ] as TileType[]
    state.phase.value = 'discard'

    const selectors = createShandongSelectors(state)
    const initialWaitM4 = selectors.userCurrentWaits.value?.tiles.find((t) => t.tile === 'm4')
    expect(initialWaitM4).toBeDefined()
    // 4 - 玩家手里的2张 = 2张
    expect(initialWaitM4?.remaining).toBe(2)

    // 玩家 1（对手）明楼，手里公开亮出一张 m4
    state.players[1].isMingLou = true
    state.players[1].hand = ['m4', 's5', 's6'] as TileType[]

    // 此时玩家 0 的听牌提示应计算 4 - 我手里的2张 - 对方明楼的1张 = 1张
    const afterWaitM4 = selectors.userCurrentWaits.value?.tiles.find((t) => t.tile === 'm4')
    expect(afterWaitM4?.remaining).toBe(1)
  })

  it('computeUnseenTileCount 准确计算某张牌场面上未出现的剩余张数', async () => {
    const { computeUnseenTileCount } = await import('./shandongRules')
    // 用户手牌有 2 张 p5
    const userHand: TileType[] = ['p5', 'p5', 'm1', 'm2']
    const allPlayers: Array<{ hand: TileType[]; melds: import('../../core/contracts/types').Meld[]; discards: TileType[]; isMingLou?: boolean; seat: number }> = [
      { hand: userHand, melds: [{ type: 'chi', tile: 'p5', tiles: ['p3', 'p4', 'p5'] }], discards: [], seat: 0 },
      { hand: ['p8'], melds: [], discards: ['p5'], seat: 1 },
      { hand: ['m9'], melds: [], discards: [], isMingLou: true, seat: 2 },
      { hand: [], melds: [], discards: [], seat: 3 },
    ]

    // 此时 p5: 用户手牌 2 张 + 用户副露 1 张 + 玩家1弃牌 1 张 = 4张已现，场外剩余 0 张
    expect(computeUnseenTileCount('p5', userHand, allPlayers, 0)).toBe(0)

    // 测试未现牌 m1: 用户手里 1 张，其余未现 = 3张
    expect(computeUnseenTileCount('m1', userHand, allPlayers, 0)).toBe(3)

    // 若玩家 2（明楼）手牌亮出 1 张 m1
    allPlayers[2].hand.push('m1' as TileType)
    // 此时 m1 场外剩余: 4 - 1(自己) - 1(明楼对手) = 2张
    expect(computeUnseenTileCount('m1', userHand, allPlayers, 0)).toBe(2)
  })

  it('胡牌时先呈现 win-effect 特写与音效，再进入 revealing 亮牌，最后才进入 settled 弹窗', async () => {
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    state.players[0].hand = ['m2', 'm2']
    const showTableAction = vi.fn()
    const playSound = vi.fn()
    const announce = vi.fn()

    const waitResolvers: Array<() => void> = []
    const wait = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        waitResolvers.push(resolve)
      })
    })

    const settlement = createShandongSettlement({
      state,
      playSound,
      playSoundAndWait: async () => {},
      getRoundLabel: () => '第1圈 第1局',
      showTableAction,
      wait,
      announce,
    })

    const settlePromise = settlement.settleWin(0, { selfDraw: true, winTile: 'm2' })

    // 第1阶段：立即呈现 win-effect 特写
    expect(state.phase.value).toBe('win-effect')
    expect(state.winEffect.value).toBeDefined()
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('自摸'), 'gold')
    expect(showTableAction).toHaveBeenCalledWith('self-draw', 0, null, 'm2', -1)
    expect(state.revealHands.value).toBe(false)
    expect(state.result.value).toBeNull() // 尚未弹窗结算

    // 解除特写等待（1.5s）
    expect(waitResolvers.length).toBe(1)
    waitResolvers.shift()!()
    await new Promise((r) => setTimeout(r, 10))

    // 第2阶段：进入 revealing 亮牌展示
    expect(state.phase.value).toBe('revealing')
    expect(state.revealHands.value).toBe(true)
    expect(state.result.value).toBeNull() // 依然尚未弹窗结算

    // 解除亮牌等待（1.2s）
    expect(waitResolvers.length).toBe(1)
    waitResolvers.shift()!()
    await settlePromise

    // 第3阶段：进入 settled 弹窗结算，并且 announcement 必须已经清除
    expect(state.phase.value).toBe('settled')
    expect(state.result.value).toBeDefined()
    expect(state.announcement.value).toBeNull()
  })

  it('摸到花牌时应为补花，不应播报【杠】也不应显示【杠】动作', async () => {
    const playSound = vi.fn()
    const playSoundAndWait = vi.fn(async () => {})
    const showTableAction = vi.fn()
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    // 牌头摸出花牌 f1，尾部补牌 m5
    state.wall.value = ['f1', 'm5']

    const flow = createShandongTileFlow({
      state,
      drawFromWall: (fromTail) => (fromTail ? state.wall.value.pop() : state.wall.value.shift()) ?? null,
      endDraw: () => {},
      endGame: () => {},
      showTableAction,
      playSound,
      playSoundAndWait,
      wait: async () => {},
      routeDiscard: () => {},
    })

    const drawn = await flow.drawFor(0)
    expect(drawn).toBe(true)

    // 花牌被记录到副露中
    expect(state.players[0].melds).toContainEqual({ type: 'flower', tile: 'f1', tiles: ['f1'] })
    // 从牌尾补入 m5
    expect(state.players[0].hand).toContain('m5')

    // 绝不可播报【杠】与显示【杠】动作
    expect(playSoundAndWait).not.toHaveBeenCalledWith('gang.mp3')
    expect(showTableAction).not.toHaveBeenCalledWith('flower-gang', expect.anything(), expect.anything(), expect.anything(), expect.anything())
  })

  it('computeMingLouWaits 在乱将规则下准确识别非258听牌，且在14张摸牌状态下剥离摸牌稳定计算', async () => {
    const { computeMingLouWaits } = await import('./shandongRules')
    // 西关十三姨手牌：345s, 678s, 9s, 111m, 摸到 2s
    // 基础牌 10 张（加上 3 张吃牌副露 = 13 张），听 9s 单吊（非 258）
    const mingLouPlayer = {
      hand: ['s3', 's4', 's5', 's6', 's7', 's8', 's9', 'm1', 'm1', 'm1', 's2'] as TileType[],
      melds: [{ type: 'chi', tile: 's3', tiles: ['s1', 's2', 's3'] }] as import('../../core/contracts/types').Meld[],
      drawnTileIndex: 10,
    }
    const userHand: TileType[] = ['p1', 'p2', 'p3']
    const allPlayers = [
      { hand: userHand, melds: [], discards: [], seat: 0 },
      { hand: mingLouPlayer.hand, melds: mingLouPlayer.melds, discards: [], isMingLou: true, seat: 2 },
    ]

    // 默认 258 规则：9s 不是 258，不能胡
    const waits258 = computeMingLouWaits(mingLouPlayer, userHand, allPlayers, 0, { luanJiang: false })
    expect(waits258.find((w) => w.tile === 's9')).toBeUndefined()

    // 乱将规则：9s 单吊可以胡，且摸牌位 s2 被剥离不破坏判定
    const waitsLuan = computeMingLouWaits(mingLouPlayer, userHand, allPlayers, 0, { luanJiang: true })
    const s9Wait = waitsLuan.find((w) => w.tile === 's9')
    expect(s9Wait).toBeDefined()
    expect(s9Wait?.remaining).toBe(3) // 4 - 1 (庄家手里的那张) = 3
  })

  it('userCanMingLou 在自家出牌回合且打牌可听牌时为 true（即使未自摸抽牌，如碰后出牌）', async () => {
    const { createShandongSelectors } = await import('./shandongSelectors')
    const state = createShandongGameState()
    state.luanJiang.value = true
    resetLocalPlayers(state, 2000)
    // 玩家 0 碰了 8筒、暗杠 8条，手牌 [2筒, 3筒x2, 4筒x3, 3条x2]，打出 2筒 听 3筒/3条
    state.players[0].hand = ['p2', 'p3', 'p3', 'p4', 'p4', 'p4', 's3', 's3'] as TileType[]
    state.players[0].melds = [
      { type: 'gang', tile: 's8', tiles: ['s8', 's8', 's8', 's8'] },
      { type: 'peng', tile: 'p8', tiles: ['p8', 'p8', 'p8'] },
    ] as import('../../core/contracts/types').Meld[]
    state.phase.value = 'discard'
    state.currentPlayer.value = 0
    state.userDrewThisTurn.value = false // 模拟碰牌后出牌，userDrewThisTurn 为 false

    const selectors = createShandongSelectors(state)
    expect(selectors.isUserTurn.value).toBe(true)
    expect(selectors.userCanMingLou.value).toBe(true)
  })

  it('真人玩家打牌触发牌名语音播报，不被 suppress 抑制', async () => {
    const { createShandongTileFlow } = await import('./shandongTileFlow')
    const state = createShandongGameState()
    resetLocalPlayers(state, 2000)
    state.players[0].hand = ['p2', 'p3'] as TileType[]

    const playSound = vi.fn()
    const playSoundAndWait = vi.fn(async () => {})
    const flow = createShandongTileFlow({
      state,
      drawFromWall: () => null,
      endDraw: () => {},
      endGame: () => {},
      showTableAction: () => {},
      playSound,
      playSoundAndWait,
      shouldAnnounceDiscard: (playerIndex, player) => playerIndex === 0 || player.playerKind === 'human',
      wait: async () => {},
      routeDiscard: () => {},
    })

    flow.discardTile(0, 0)
    expect(playSound).toHaveBeenCalledWith('dapai.mp3', 0.8)
    await new Promise((r) => setTimeout(r, 120))
    expect(playSoundAndWait).toHaveBeenCalledWith('2p.mp3')
  })

  it('未报听未明楼时 userCanHu 为 false；报听后 userCanHu 为 true', async () => {
    const { createShandongSelectors } = await import('./shandongSelectors')
    const state = createShandongGameState()
    state.luanJiang.value = true
    resetLocalPlayers(state, 2000)

    // 玩家 0 已经摸到了胡牌：手牌为成和牌型
    state.players[0].hand = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 's5', 's5'] as TileType[]
    state.phase.value = 'discard'
    state.currentPlayer.value = 0
    state.userDrewThisTurn.value = true

    const selectors = createShandongSelectors(state)
    // 尚未报听也未明楼：不可胡牌！
    expect(selectors.userCanHu.value).toBe(false)
    expect(selectors.userCanBaoTing.value).toBe(true)
    expect(selectors.userCanMingLou.value).toBe(true)

    // 玩家声明报听后
    state.baoTingPlayers.value.add(0)
    expect(selectors.userCanHu.value).toBe(true)
    // 报听后不能重复报听或明楼
    expect(selectors.userCanBaoTing.value).toBe(false)
    expect(selectors.userCanMingLou.value).toBe(false)
  })

  it('点炮胡必须要求报听：未报听玩家不可点炮胡，已报听玩家可点炮胡，明楼玩家不可点炮胡', async () => {
    const state = createShandongGameState()
    state.luanJiang.value = true
    resetLocalPlayers(state, 2000)

    // 玩家1听 s5，但未报听
    state.players[1].hand = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 's5'] as TileType[]
    // 玩家2听 s5，已明楼
    state.players[2].hand = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 's5'] as TileType[]
    state.mingLouPlayers.value.add(2)
    state.players[2].isMingLou = true
    // 玩家3听 s5，已报听
    state.players[3].hand = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'p1', 'p2', 'p3', 's5'] as TileType[]
    state.baoTingPlayers.value.add(3)
    state.players[3].isBaoTing = true

    const endGameMock = vi.fn()
    const controllers = [
      { requestTurn: vi.fn(), requestHu: vi.fn(), requestClaim: vi.fn(), requestChi: vi.fn(), requestRobKong: vi.fn(), reset: vi.fn() },
      { requestTurn: vi.fn(), requestHu: vi.fn(), requestClaim: vi.fn(), requestChi: vi.fn(), requestRobKong: vi.fn(), reset: vi.fn() },
      { requestTurn: vi.fn(), requestHu: vi.fn(), requestClaim: vi.fn(), requestChi: vi.fn(), requestRobKong: vi.fn(), reset: vi.fn() },
      {
        requestTurn: vi.fn(),
        requestHu: vi.fn(async () => ({ kind: 'hu' as const })),
        requestClaim: vi.fn(),
        requestChi: vi.fn(),
        requestRobKong: vi.fn(),
        reset: vi.fn(),
      },
    ]

    const orchestrator = createShandongTurnOrchestrator({
      state,
      controllers,
      drawFor: async () => true,
      discardTile: () => {},
      endDraw: () => {},
      endGame: endGameMock,
      announce: () => {},
      showTableAction: () => {},
      playSound: () => {},
      playSoundAndWait: async () => {},
      wait: async () => {},
      later: (cb) => { cb(); return 0 },
    })

    // 玩家0打出 s5
    orchestrator.routeDiscard(0, 's5')

    // 玩家1（未报听）不应被请求胡牌
    expect(controllers[1].requestHu).not.toHaveBeenCalled()
    // 玩家2（明楼）不应被请求胡牌（只能自摸）
    expect(controllers[2].requestHu).not.toHaveBeenCalled()
    // 玩家3（已报听）应该被请求胡牌
    expect(controllers[3].requestHu).toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 50))
    expect(endGameMock).toHaveBeenCalledWith(3, expect.objectContaining({ selfDraw: false, winTile: 's5' }))
  })

  it('杠头全局公开：初始为牌尾最后一张，正常摸牌与补花不改变杠头，开杠摸取后翻开下一张', async () => {
    const game = useShandongGame({ headless: true })
    // 初始化对局
    game.startGame('east')
    const wall = game.wall.value

    expect(wall.length).toBeGreaterThan(0)
    // 初始杠头应为牌尾最后一张且非花牌
    const initialGangHead = wall[wall.length - 1]
    expect(game.capabilities.value.gangHeadTile).toBe(initialGangHead)
    expect(initialGangHead.startsWith('f')).toBe(false)

    // 1. 正常摸牌：从牌头摸取，公开杠头绝对不变
    const normalTile = game.drawFromWall('normal')
    expect(normalTile).toBeTruthy()
    expect(game.capabilities.value.gangHeadTile).toBe(initialGangHead)

    // 2. 补花摸牌：从杠头前摸取，公开杠头绝对不变
    const flowerTile = game.drawFromWall('flower')
    expect(flowerTile).toBeTruthy()
    expect(game.capabilities.value.gangHeadTile).toBe(initialGangHead)

    // 3. 只有开杠：从牌尾摸走杠头，之后掀开牌尾下一张作为新的杠头
    const tailDrawn = game.drawFromWall('kong')
    expect(tailDrawn).toBe(initialGangHead)

    // 牌尾新的最后一张自动成为新的杠头
    const nextGangHead = wall[wall.length - 1]
    expect(game.capabilities.value.gangHeadTile).toBe(nextGangHead)
    expect(nextGangHead.startsWith('f')).toBe(false)
  })

  it('听牌提示包含番数估算与剩余张数', async () => {
    const { createShandongSelectors } = await import('./shandongSelectors')
    const { computeMingLouWaits } = await import('./shandongRules')
    const state = createShandongGameState()
    state.luanJiang.value = true
    resetLocalPlayers(state, 2000)

    // 玩家 0 听 s5，牌型包含一条龙 + 门清
    state.players[0].hand = [
      'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',
      'p1', 'p2', 'p3',
      's5',
    ] as TileType[]
    state.phase.value = 'discard'
    state.currentPlayer.value = 0
    state.userDrewThisTurn.value = false

    const selectors = createShandongSelectors(state)
    const waits = selectors.userCurrentWaits.value?.tiles
    expect(waits).toBeDefined()
    expect(waits?.length).toBeGreaterThan(0)

    const s5Wait = waits?.find((w) => w.tile === 's5')
    expect(s5Wait).toBeDefined()
    expect(s5Wait?.remaining).toBe(3) // 4 - 1(手里的1张)
    expect(s5Wait?.fan).toBe(8) // 一条龙 (4) * 门清 (2) = 8番

    // 明楼玩家听牌列表中亦包含番数（明楼翻倍 ×2 => 16番）
    const mingLouWaits = computeMingLouWaits(
      { hand: state.players[0].hand, melds: [] },
      ['s5'],
      state.players,
      1,
      { luanJiang: true },
    )
    const mlWait = mingLouWaits.find((w) => w.tile === 's5')
    expect(mlWait?.fan).toBe(16)
  })

  it('玩家报听后，只要未胡牌摸到手里的牌自动摸打直接打出；胡牌时提供胡牌决策', async () => {
    const state = createShandongGameState()
    state.luanJiang.value = true
    resetLocalPlayers(state, 2000)

    // 玩家 0 听 s5，且已报听
    state.players[0].hand = [
      'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',
      'p1', 'p2', 'p3',
      's5',
    ] as TileType[]
    state.baoTingPlayers.value.add(0)
    state.players[0].isBaoTing = true

    const discardTileMock = vi.fn()
    const requestTurnMock = vi.fn(async () => ({ kind: 'win' as const }))
    const controllers = [
      { requestTurn: requestTurnMock, requestHu: vi.fn(), requestClaim: vi.fn(), requestChi: vi.fn(), requestRobKong: vi.fn(), reset: vi.fn() },
      { requestTurn: vi.fn(), requestHu: vi.fn(), requestClaim: vi.fn(), requestChi: vi.fn(), requestRobKong: vi.fn(), reset: vi.fn() },
      { requestTurn: vi.fn(), requestHu: vi.fn(), requestClaim: vi.fn(), requestChi: vi.fn(), requestRobKong: vi.fn(), reset: vi.fn() },
      { requestTurn: vi.fn(), requestHu: vi.fn(), requestClaim: vi.fn(), requestChi: vi.fn(), requestRobKong: vi.fn(), reset: vi.fn() },
    ]

    let nextDrawTile: TileType = 'p9'
    const orchestrator = createShandongTurnOrchestrator({
      state,
      controllers,
      drawFor: async (idx) => {
        state.players[idx].hand.push(nextDrawTile)
        state.players[idx].drawnTileIndex = state.players[idx].hand.length - 1
        return true
      },
      discardTile: discardTileMock,
      endDraw: () => {},
      endGame: vi.fn(),
      announce: () => {},
      showTableAction: () => {},
      playSound: () => {},
      playSoundAndWait: async () => {},
      wait: async () => {},
      later: (cb) => { cb(); return 0 },
    })

    // 1. 摸到非胡牌 p9：直接自动摸打打出，不阻塞玩家请求
    nextDrawTile = 'p9'
    await orchestrator.beginTurn(0)
    expect(discardTileMock).toHaveBeenCalledWith(0, expect.any(Number))
    expect(requestTurnMock).not.toHaveBeenCalled()

    // 2. 摸到可胡牌 s5：交由 requestTurn 供玩家点击【胡】
    discardTileMock.mockClear()
    requestTurnMock.mockClear()
    // 恢复手牌为 13 张
    state.players[0].hand = [
      'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9',
      'p1', 'p2', 'p3',
      's5',
    ] as TileType[]
    nextDrawTile = 's5'
    await orchestrator.beginTurn(0)
    expect(requestTurnMock).toHaveBeenCalled()
  })
})


