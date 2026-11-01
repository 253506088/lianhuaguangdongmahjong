import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShandongGame } from '../variants/shandong/shandongGame'
import { ShandongAiController } from '../variants/shandong/shandongControllers'
import { createShandongWall } from '../variants/shandong/shandongRules'
import { createReplayRecorder } from './recorder'
import { buildReplayFrames } from './projection'
import { buildReplayExport } from './export'
import { parseReplayImport } from './importReplay'
import type { ReplayRound } from './types'
import type { TileType } from '../core/contracts/types'

function timers(seed = 20261102) {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval })
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0
    return seed / 4294967296
  })
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function record() {
  const saved: ReplayRound[] = []
  const recorder = createReplayRecorder({
    meta: () => ({rulesetId:'shandong',rulesetName:'山东麻将',themeName:'jade',humanSeat:0}),
    sink:{saveMatch(){},saveRound(round){saved.push(round)}},
  })
  return {recorder,saved}
}

describe('山东引擎录制与回放', () => {
  it.each(['258','luan'] as const)('%s：整场事件、144张牌、规则设置、声明、分数及导出导入闭环', async jiang => {
    timers()
    const {recorder,saved}=record()
    const game=useShandongGame({recorder:recorder.hooks,headless:true,controllerDrivenLockedTurns:true,
      getJiangRule:()=>jiang,getAllowChiRule:()=>jiang==='258',
      controllers:Array.from({length:4},()=>new ShandongAiController(0))})
    await game.startGame('east')
    let iterations=0
    while(!game.matchFinished.value && iterations++<10000) {
      if(game.phase.value==='settled') {
        const final=saved.at(-1)!.final!
        expect(final.hands).toEqual(game.players.map(p=>p.hand))
        expect(final.melds).toEqual(game.players.map(p=>p.melds))
        expect(final.discards).toEqual(game.players.map(p=>p.discards))
        expect(final.scores).toEqual(game.players.map(p=>p.score))
        expect(final.isBaoTing).toEqual(game.players.map(p=>Boolean(p.isBaoTing)))
        game.nextRound()
      }
      await vi.advanceTimersByTimeAsync(1)
    }
    expect(game.matchFinished.value).toBe(true)
    const match=recorder.finishAuto()!
    expect(match.status).toBe('finished')
    expect(match.roundCount).toBe(saved.length)
    expect(recorder.snapshot().stats.roundEndsSkipped).toBe(0)
    expect(saved.flatMap(r=>r.steps).some(s=>s.t==='declaration')).toBe(true)
    for(const round of saved) {
      expect(round.jokerTiles).toEqual([])
      expect(round.shandong).toEqual({jiang,allowChi:jiang==='258'})
      expect([...round.initialWall!].sort()).toEqual(createShandongWall().sort())
      expect(round.final!.scores.reduce((a,b)=>a+b,0)).toBe(8000)
      const frames=buildReplayFrames(match,round,{revealAll:false})
      for(const frame of frames.filter(f=>!f.settled)) {
        const count=frame.wallLeft+frame.table.players.reduce((total,p)=>total+p.hand.length+p.discards.length+p.melds.reduce((n,m)=>n+m.tiles.length,0),0)
        expect(count,`第${round.roundIndex}局第${frame.index}帧`).toBe(144)
        expect(frame.table.gangHeadTile).toBe(frame.step?.gangHeadTile??round.anchor.gangHeadTile)
        if(frame.step?.t==='declaration') {
          const actor=frame.table.players.find(p=>p.seat===frame.step!.seat)!
          expect(frame.step.declaration==='ming-lou'?actor.isMingLou:actor.isBaoTing).toBe(true)
        }
      }
      expect(frames.at(-1)!.scores).toEqual(round.final!.scores)
      expect(()=>structuredClone(round)).not.toThrow()
    }
    const imported=parseReplayImport(JSON.parse(JSON.stringify(buildReplayExport(match,saved))))
    expect(imported.ok).toBe(true)
    expect(imported.rounds).toEqual(saved)
    game.returnToLobby()
  },30000)

  it('天胡也先记录发牌后的锚点；空癞子列表不会变成白板癞子', async () => {
    timers()
    const {recorder,saved}=record()
    const hand:TileType[]=['m1','m2','m3','m4','m5','m6','m7','m8','m9','p1','p2','p3','s5','s5']
    const pool=createShandongWall()
    for(const tile of hand) pool.splice(pool.indexOf(tile),1)
    const game=useShandongGame({headless:true,recorder:recorder.hooks})
    await game.startGame('east',{initialWall:[...hand,...pool]})
    await vi.advanceTimersByTimeAsync(1)
    expect(saved).toHaveLength(1)
    expect(saved[0].anchor.hands[0]).toEqual(hand)
    expect(saved[0].final!.winType).toBe('tianhu')
    expect(saved[0].steps.map(s=>s.t)).toEqual(['win'])
    expect(saved[0].jokerTiles).toEqual([])
    const match=recorder.finishAuto()!
    expect(match.status).toBe('aborted')
    game.returnToLobby()
  })
})
