import type { Meld, TileType } from '../../core/contracts/types'
import { TILE_TYPES } from '../../core/rules/tiles'
import { is258Tile, TERMINAL_AND_HONOR_TILES } from './shandongRules'

const INDEX = new Map(TILE_TYPES.map((tile, index) => [tile, index]))
const EYES = TILE_TYPES.map(is258Tile)
const ORPHANS = TERMINAL_AND_HONOR_TILES.map(tile => INDEX.get(tile)!)
const cache = new Map<string, number>()

/** 无癞子的山东牌效估值。实际报听仍由完整规则验证，估值不授予合法动作。 */
export function shandongShanten(hand: readonly TileType[], melds: readonly Meld[] = [], luanJiang = false): number {
  const exposed = melds.filter(meld => meld.type !== 'flower').length
  const counts = Array<number>(34).fill(0)
  for (const tile of hand) { const index=INDEX.get(tile); if(index!==undefined) counts[index]++ }
  const key = `${exposed}/${Number(luanJiang)}/${counts.join('')}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  let best = 9
  if (exposed === 0) {
    // 山东豪华七对：四张同牌算两对，不套用需要七种不同牌的公式。
    const pairs=counts.reduce((n,count)=>n+Math.floor(count/2),0)
    const hasEye=luanJiang||counts.some((count,index)=>count>=2&&EYES[index])
    const eyeSingle=luanJiang||counts.some((count,index)=>count>0&&EYES[index])
    // 摸成七个非258对子仍需换出一对，不能把这张进牌误当作降低向听。
    const sevenPairs = hasEye ? 6-pairs : Math.max(eyeSingle ? 0 : 1,6-pairs+(eyeSingle?0:1))
    best=Math.min(best,sevenPairs)
    const uniqueOrphans=ORPHANS.filter(index=>counts[index]>0).length
    best=Math.min(best,13-uniqueOrphans-Number(ORPHANS.some(index=>counts[index]>=2)))
    // 十三不靠必须给三门分配不同的147/258/369组合。
    for(const a of [0,1,2]) for(const b of [0,1,2]) {
      if(a===b) continue
      const patterns=[a,b,3-a-b]
      let unique=counts.slice(27).filter(count=>count>0).length
      for(let suit=0;suit<3;suit++) for(let rank=patterns[suit];rank<9;rank+=3) {
        if(counts[suit*9+rank]>0) unique++
      }
      best=Math.min(best,13-unique)
    }
  }

  function dfs(start:number, groups:number, partials:number, pair:number, eyeSingle:boolean) {
    if(groups+exposed>4||partials>4) return
    while(start<34&&counts[start]===0) start++
    if(start===34) {
      const complete=groups+exposed
      // 没有合法将对时，必须保留一个可配将的孤张；258以外的对子只算搭子。
      const missingEye=pair===0&&!eyeSingle?1:0
      best=Math.min(best,8-complete*2-Math.min(partials,4-complete)-pair+missingEye)
      return
    }
    if(best===-1) return
    const count=counts[start]
    const eligible=luanJiang||EYES[start]
    if(count>=3) { counts[start]-=3; dfs(start,groups+1,partials,pair,eyeSingle); counts[start]+=3 }
    const rank=start%9
    if(start<27&&rank<=6&&counts[start+1]&&counts[start+2]) {
      counts[start]--;counts[start+1]--;counts[start+2]--
      dfs(start,groups+1,partials,pair,eyeSingle)
      counts[start]++;counts[start+1]++;counts[start+2]++
    }
    if(count>=2) {
      counts[start]-=2
      if(!pair&&eligible) dfs(start,groups,partials,1,eyeSingle)
      dfs(start,groups,partials+1,pair,eyeSingle)
      counts[start]+=2
    }
    if(start<27) for(const gap of [1,2]) {
      if(rank+gap>8||!counts[start+gap]) continue
      counts[start]--;counts[start+gap]--
      dfs(start,groups,partials+1,pair,eyeSingle)
      counts[start]++;counts[start+gap]++
    }
    counts[start]=0
    dfs(start+1,groups,partials,pair,eyeSingle||eligible)
    counts[start]=count
  }
  dfs(0,0,0,0,false)
  const result=Math.max(-1,best)
  if(cache.size>=12000) cache.delete(cache.keys().next().value!)
  cache.set(key,result)
  return result
}
