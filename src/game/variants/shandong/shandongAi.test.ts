import { describe, expect, it } from 'vitest'
import type { Meld, TileType } from '../../core/contracts/types'
import { chooseBestDiscardIndex, decideTurn, rankDiscardOptions } from './shandongAi'
import { shandongShanten } from './shandongEfficiency'
import { waitingTiles } from './shandongRules'

const MELDS:TileType[]=['m1','m2','m3','m4','m5','m6','m7','m8','m9','p1','p2','p3']

describe('山东AI弃牌牌效',()=>{
  it('单钓选择还有牌的258将，不选已在公开信息中耗尽的听口',()=>{
    const hand:TileType[]=[...MELDS,'s2','s5']
    const known:TileType[]=[...hand,'s5','s5','s5']
    const choice=chooseBestDiscardIndex(hand,[],false,known)
    expect(hand[choice.index]).toBe('s5')
    expect(choice.reachesTing).toBe(true)
    expect(waitingTiles(hand.filter((_,i)=>i!==choice.index),[])).toEqual(['s2'])
    expect(hand).toEqual([...MELDS,'s2','s5'])
  })
  it('只剩死听时不报听或明搂，保留改良机会',()=>{
    const hand:TileType[]=[...MELDS,'s5','red']
    const decision=decideTurn({hand,melds:[],visibleTiles:[...hand,'s5','s5','s5']})
    expect(decision.kind).toBe('discard')
    if(decision.kind==='discard') {
      expect(decision.declareBaoTing).toBe(false)
      expect(decision.declareMingLou).toBe(false)
    }
  })
  it('同张牌只生成一个候选，实际返回合法原手牌索引',()=>{
    const hand:TileType[]=['m2','m2','m2','m3','m4','p2','p2','p6','p7','s3','s4','s8','red','white']
    const options=rankDiscardOptions(hand)
    expect(new Set(options.map(option=>option.tile)).size).toBe(options.length)
    expect(options.every(option=>hand[option.index]===option.tile)).toBe(true)
  })
  it('258缺将不能当作乱将听牌，七对将对也遵循同一限制',()=>{
    expect(shandongShanten([...MELDS,'east'],[],false)).toBe(1)
    expect(shandongShanten([...MELDS,'east'],[],true)).toBe(0)
    const pairs:TileType[]=['m1','m1','m3','m3','m4','m4','p1','p1','p3','p3','p4','p4','s1']
    expect(shandongShanten(pairs,[],false)).toBe(1)
    expect(shandongShanten([...pairs,'s1'],[],false)).toBe(1)
    expect(shandongShanten(pairs,[],true)).toBe(0)
  })
  it('山东四张同牌计两对，保留豪华七对及十三幺路线',()=>{
    const luxury:TileType[]=['m1','m1','m1','m1','m2','m2','m2','m2','p5','p5','p5','p5','s8']
    expect(shandongShanten(luxury)).toBe(0)
    expect(shandongShanten([...luxury,'s8'])).toBe(-1)
    const orphans:TileType[]=['m1','m9','p1','p9','s1','s9','east','south','west','north','red','green','white']
    expect(shandongShanten(orphans)).toBe(0)
  })
  it('声明仍由完整山东规则核准，已报听摸打仍只打新摸牌',()=>{
    const hand:TileType[]=[...MELDS,'s5','red']
    expect(decideTurn({hand,melds:[],isBaoTing:true})).toEqual({kind:'discard',handIndex:13})
    const choice=chooseBestDiscardIndex(hand)
    expect(choice.reachesTing).toBe(true)
    expect(waitingTiles(hand.filter((_,i)=>i!==choice.index),[]).length).toBeGreaterThan(0)
  })

  it('结构快速筛选不漏掉不同副露数量的合法标准听牌',()=>{
    const blocks:TileType[][]=[['m1','m2','m3'],['m4','m5','m6'],['p7','p8','p9'],['s3','s3','s3']]
    for(const jiang of ['m2','p5','s8','east'] as TileType[]) {
      const luan=jiang==='east'
      for(let exposed=0;exposed<=3;exposed++) {
        const melds:Meld[]=blocks.slice(0,exposed).map(tiles=>({type:'chi',tile:tiles[0],tiles:[...tiles],from:1}))
        const complete=[...blocks.slice(exposed).flat(),jiang,jiang]
        for(let removed=0;removed<complete.length;removed++) {
          const ready=complete.filter((_,index)=>index!==removed)
          expect(waitingTiles(ready,melds,{luanJiang:luan})).toContain(complete[removed])
          expect(shandongShanten(ready,melds,luan)).toBeLessThanOrEqual(0)
          const choice=chooseBestDiscardIndex([...ready,'red'],melds,luan)
          expect(choice.reachesTing).toBe(true)
        }
      }
    }
  })
})
