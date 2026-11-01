import { describe, expect, it, vi } from 'vitest'
import type { TileType } from '../../core/contracts/types'
import { resetLocalPlayers } from '../../shared/runtime/localOpening'
import { createShandongGameState } from './shandongState'
import { createShandongSettlement } from './shandongSettlement'
import { createShandongTurnOrchestrator } from './shandongTurnOrchestrator'
import { ShandongAiController, type ShandongController, type ShandongHumanController } from './shandongControllers'
import { createShandongHuman } from './shandongHuman'
import { createShandongSelectors } from './shandongSelectors'
import { createShandongTileFlow } from './shandongTileFlow'
import { waitingTiles } from './shandongRules'

const BASE: TileType[] = ['m1','m2','m3','m4','m5','m6','m7','m8','m9','p1','p2','p3','s5']
const setup = () => {
  const state = createShandongGameState()
  resetLocalPlayers(state, 2000)
  state.phase.value = 'discard'
  return state
}
function controller() {
  return {
    requestTurn: vi.fn<ShandongController['requestTurn']>(async () => ({ kind: 'discard', handIndex: 0 })),
    requestHu: vi.fn<ShandongController['requestHu']>(async () => ({ kind: 'hu' })),
    requestClaim: vi.fn<ShandongController['requestClaim']>(async () => ({ kind: 'pass' })),
    requestChi: vi.fn<ShandongController['requestChi']>(async () => ({ kind: 'pass' })),
    requestRobKong: vi.fn<ShandongController['requestRobKong']>(async () => 'pass'), reset() {},
  }
}
function harness(state = setup(), controllers: ShandongController[] = Array.from({ length: 4 }, controller)) {
  const settlement = createShandongSettlement({ state, playSound() {}, playSoundAndWait: async () => {}, getRoundLabel: () => '东1局' })
  const endGame = vi.fn(settlement.settleWin)
  const discardTile = vi.fn((seat: number, index: number) => {
    const [tile] = state.players[seat].hand.splice(index, 1)
    state.players[seat].discards.push(tile)
  })
  const engine = createShandongTurnOrchestrator({
    state, controllers, endGame, discardTile, drawFor: async () => false, endDraw() {},
    announce() {}, showTableAction() {}, playSound() {}, playSoundAndWait: async () => {}, wait: async () => {}, later: () => 0,
  })
  return { state, engine, endGame, settlement, discardTile }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const lock = (state: ReturnType<typeof setup>, seat: number) => {
  state.baoTingPlayers.value.add(seat); state.players[seat].isBaoTing = true
}

describe('山东麻将规则闭环回归', () => {
  it('点炮用完整和牌算80分，保留实体牌归属与计分明细', async () => {
    const { state, engine } = harness()
    state.players[1].hand = [...BASE]; lock(state, 1)
    state.players[0].discards = ['s5']
    engine.routeDiscard(0, 's5'); await flush()
    expect(state.result.value?.points).toBe(80)
    expect(state.result.value?.details).toContainEqual({ label: '一条龙 ×4', multiplier: 4 })
    expect(state.players.map(p => p.score)).toEqual([1920, 2080, 2000, 2000])
    expect(state.players[1].hand).toEqual(BASE)
    expect(state.players[0].discards).toEqual(['s5'])
  })

  it('已报听AI实际抢补杠，按完整牌型包赔三份且未把碰升级为杠', async () => {
    const state = setup()
    state.players[0].hand = ['p3']; state.players[0].melds = [{ type: 'peng', tile: 'p3', tiles: ['p3','p3','p3'] }]
    state.players[1].hand = [...BASE.slice(0,11), 's5','s5']; lock(state, 1)
    const ai = new ShandongAiController(0, fn => fn())
    const { engine } = harness(state, [controller(), ai, controller(), controller()])
    await engine.declareAddedKong(0, 0)
    expect(state.result.value?.winType).toBe('robbed-kong')
    expect(state.result.value?.totalWon).toBe(240)
    expect(state.players.map(p => p.score)).toEqual([1760,2240,2000,2000])
    expect(state.players[0].melds[0].type).toBe('peng')
    expect(state.players[0].hand).toEqual(['p3'])
  })

  it.each(['discard','rob'] as const)('单响%s：近家放弃，继续询问远家；近家进入过胡锁定', async (kind) => {
    const state = setup(); const cs = Array.from({ length: 4 }, controller)
    state.players[1].hand = kind === 'discard' ? [...BASE] : [...BASE.slice(0,11),'s5','s5']
    state.players[2].hand = [...state.players[1].hand]; lock(state,1); lock(state,2)
    cs[1].requestHu.mockResolvedValue({kind:'pass'}); cs[2].requestRobKong.mockResolvedValue('win')
    const { engine } = harness(state,cs)
    if (kind === 'discard') { state.players[0].discards=['s5']; engine.routeDiscard(0,'s5'); await flush() }
    else { state.players[0].hand=['p3']; state.players[0].melds=[{type:'peng',tile:'p3',tiles:['p3','p3','p3']}]; await engine.declareAddedKong(0,0) }
    expect(state.result.value?.winnerIndex).toBe(2)
    expect(state.passedHuPlayers.value.has(1)).toBe(true)
  })

  it('引擎拒绝不能听的报听声明，重新请求操作后才允许合法声明', async () => {
    const state=setup(); state.players[0].hand=[...BASE,'red']
    const c=controller()
    c.requestTurn.mockResolvedValueOnce({kind:'discard',handIndex:0,declareBaoTing:true})
      .mockResolvedValueOnce({kind:'discard',handIndex:13,declareBaoTing:true})
    const {engine,discardTile}=harness(state,[c,controller(),controller(),controller()])
    await engine.beginTurn(0,{skipDraw:true})
    expect(c.requestTurn).toHaveBeenCalledTimes(2)
    expect(discardTile).toHaveBeenCalledExactlyOnceWith(0,13)
    expect(state.players[0].isBaoTing).toBe(true)
    expect(waitingTiles(state.players[0].hand,[])).toEqual(['s5'])
  })

  it('真人不能借报听/明搂打出不听牌，支持取消与新局清理声明', () => {
    const state=setup(); state.players[0].hand=[...BASE,'red']; state.currentPlayer.value=0
    const selectors=createShandongSelectors(state)
    const resolveDiscard=vi.fn()
    const human=createShandongHuman({state,
      humanController:{hasPendingTurn:()=>true,resolveDiscard} as unknown as ShandongHumanController,
      turnOrchestrator:{} as ReturnType<typeof createShandongTurnOrchestrator>,
      getUser:()=>state.players[0],isUserTurn:()=>true,canUserHu:()=>false,getUserKongs:()=>[],
      userCanMingLou:()=>selectors.userCanMingLou.value,userCanBaoTing:()=>selectors.userCanBaoTing.value,
      stopCountdown(){},startTurnCountdown(){},discardTile(){},beginTurn(){},endGame(){},announce(){},playSound(){},later:()=>0})
    human.selectTile(0); human.userBaoTing(); expect(resolveDiscard).not.toHaveBeenCalled()
    human.userBaoTing(); human.userDiscard(0)
    expect(resolveDiscard).toHaveBeenLastCalledWith(0,false,false)
    human.resetDeclaration(); resolveDiscard.mockClear()
    human.userMingLou(); expect(resolveDiscard).not.toHaveBeenCalled()
    human.resetDeclaration(); human.userDiscard(0)
    expect(resolveDiscard).toHaveBeenLastCalledWith(0,false,false)
  })

  it('报听后摸牌保留原听口，禁止开杠，结算后不能再明搂', () => {
    const state=setup(); state.players[0].hand=[...BASE]; lock(state,0)
    const selectors=createShandongSelectors(state)
    expect(selectors.userCurrentWaits.value?.tiles.map(t=>t.tile)).toEqual(['s5'])
    state.players[0].hand.push('red'); state.players[0].drawnTileIndex=13
    expect(selectors.userCurrentWaits.value?.tiles.map(t=>t.tile)).toEqual(['s5'])
    expect(selectors.userKongs.value).toEqual([])
    state.phase.value='settled'; expect(selectors.userCanMingLou.value).toBe(false)
  })

  it('地胡只在庄家首张弃牌触发，无需报听，沿用三家各付固定25倍', async () => {
    const {state,engine}=harness(); state.players[1].hand=[...BASE]
    state.roundFirstDiscard.value=true; state.dealer.value=0; state.players[0].discards=['s5']
    engine.routeDiscard(0,'s5'); await flush()
    expect(state.result.value?.winType).toBe('dihu')
    expect(state.result.value?.points).toBe(250)
    expect(state.players.map(p=>p.score)).toEqual([1750,2750,1750,1750])
    expect(state.roundFirstDiscard.value).toBe(false)
  })

  it.each(['normal','flower','kong'] as const)('海底按最后可正常摸牌判定：%s', async reason => {
    const {state,settlement}=harness(); state.players[0].hand=[...BASE]; lock(state,0)
    state.wall.value=reason==='flower'?['f1','s5','east']:['s5','east']
    const flow=createShandongTileFlow({state,drawFromWall:()=>state.wall.value.shift()??null,
      endDraw(){},endGame(){},showTableAction(){},playSound(){},playSoundAndWait:async()=>{},wait:async()=>{},routeDiscard(){}})
    await flow.drawFor(0,reason==='flower'?'normal':reason)
    expect(state.lastNormalDrawPlayer.value).toBe(reason==='kong'?null:0)
    await settlement.settleWin(0,{selfDraw:true,winTile:'s5'})
    expect(state.result.value?.details?.some(d=>d.label==='海底捞月 ×2')).toBe(reason!=='kong')
    expect(state.wall.value).toEqual(['east'])
  })

  it('非法和牌不再悄悄结算10分，不改变积分和阶段', async () => {
    const {state,settlement}=harness(); state.players[0].hand=['m2','m2']
    await settlement.settleWin(0,{selfDraw:true,winTile:'m2'})
    expect(state.result.value).toBeNull(); expect(state.phase.value).toBe('discard')
    expect(state.players.map(p=>p.score)).toEqual([2000,2000,2000,2000])
  })

  it('AI上下文仅含本人和公开牌，不包含他家暗手或未知牌墙',async()=>{
    const state=setup(); state.players[0].hand=[...BASE,'red']
    state.players[1].hand=['white']; state.players[1].discards=['p9']
    state.players[2].hand=['green']; state.players[2].isMingLou=true
    state.gangHeadTile.value='north'; state.wall.value=['west','north']
    const c=controller(); const {engine}=harness(state,[c,controller(),controller(),controller()])
    await engine.beginTurn(0,{skipDraw:true})
    const visible=c.requestTurn.mock.calls[0][0].visibleTiles!
    expect(visible).toEqual([...BASE,'red','p9','green','north'])
    expect(visible).not.toContain('white'); expect(visible).not.toContain('west')
  })
})
