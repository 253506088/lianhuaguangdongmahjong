import { it, expect, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { chooseBestDiscardIndex as oldChoose, decideTurn as oldTurn } from '../../tmp/shandong-ai-bench/baseline'
import { chooseBestDiscardIndex as newChoose, decideTurn as newTurn } from '../../src/game/variants/shandong/shandongAi'
import { shandongShanten } from '../../src/game/variants/shandong/shandongEfficiency'
import { createShandongWall } from '../../src/game/variants/shandong/shandongRules'
import { useShandongGame } from '../../src/game/variants/shandong/shandongGame'
import { ShandongAiController } from '../../src/game/variants/shandong/shandongControllers'

let seed=20261102
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
function shuffled(wall=createShandongWall()) {const copy=[...wall];for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]]}return copy}
const report:any={timing:[],paired:[]}
function summary(values:number[]){values.sort((a,b)=>a-b);return{medianMs:+values[Math.floor(values.length/2)].toFixed(2),p95Ms:+values[Math.floor(values.length*.95)].toFixed(2),maxMs:+values.at(-1)!.toFixed(2)}}

it('相同随机手牌比较弃牌计算开销与选择',()=>{
 const hands=Array.from({length:200},()=>shuffled(createShandongWall().filter(t=>!t.startsWith('f'))).slice(0,14))
 for(const luan of [false,true]) {
   hands.slice(0,10).forEach(hand=>{oldChoose(hand,[],luan);newChoose(hand,[],luan)})
   const oldMs:number[]=[],newMs:number[]=[],choices:any[]=[]
   for(const hand of hands.slice(10)) {
     let t=performance.now();const old=oldChoose(hand,[],luan);oldMs.push(performance.now()-t)
     t=performance.now();const next=newChoose(hand,[],luan);newMs.push(performance.now()-t)
     choices.push({hand,old:hand[old.index],next:hand[next.index],oldDistance:shandongShanten(hand.filter((_,i)=>i!==old.index),[],luan),newDistance:shandongShanten(hand.filter((_,i)=>i!==next.index),[],luan)})
   }
   const row={luan,samples:oldMs.length,baseline:summary(oldMs),candidate:summary(newMs),changed:choices.filter(c=>c.old!==c.next).length,lowerDistance:choices.filter(c=>c.newDistance<c.oldDistance).length,higherDistance:choices.filter(c=>c.newDistance>c.oldDistance).length,example:choices.find(c=>c.newDistance<c.oldDistance)}
   report.timing.push(row);console.log('TIMING',JSON.stringify(row))
 }
 writeFileSync('tmp/shandong-ai-bench/report.json',JSON.stringify(report,null,2))
},30000)

it('固定牌墙轮换席位：一名新AI对三名基线AI，与全基线相同座位比较',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',{setTimeout,clearTimeout,setInterval,clearInterval})
 // 关闭两版本共同的随机明搂，单独度量弃牌变化；初始牌墙用独立固定种子。
 vi.spyOn(Math,'random').mockReturnValue(.99)
 try {
  for(const luan of [false,true]) {
   const walls=Array.from({length:12},()=>shuffled())
   let baselineScore=0,candidateScore=0,baselineWins=0,candidateWins=0,baselineDraws=0,candidateDraws=0
   const play=async(wall:any[],upgraded:number)=>{
     const controllers=Array.from({length:4},(_,seat)=>{
       const c=new ShandongAiController(0)
       c.requestTurn=async ctx=>(seat===upgraded?newTurn:oldTurn)(ctx)
       return c
     })
     const game=useShandongGame({headless:true,controllerDrivenLockedTurns:true,controllers,getJiangRule:()=>luan?'luan':'258'})
     await game.startGame('east',{initialWall:wall})
     let guard=0
     while(game.phase.value!=='settled'&&guard++<1500) await vi.advanceTimersByTimeAsync(1)
     expect(game.phase.value).toBe('settled')
     const result={scores:game.players.map(p=>p.score-2000),win:game.result.value?.winnerIndex,draw:Boolean(game.result.value?.draw)}
     game.returnToLobby();return result
   }
   for(const wall of walls){
     const base=await play(wall,-1)
     for(let seat=0;seat<4;seat++){
       const next=await play(wall,seat)
       baselineScore+=base.scores[seat];candidateScore+=next.scores[seat]
       baselineWins+=Number(base.win===seat);candidateWins+=Number(next.win===seat)
       baselineDraws+=Number(base.draw);candidateDraws+=Number(next.draw)
     }
   }
   const row={luan,pairedSeats:48,baselineScore,candidateScore,baselineWins,candidateWins,baselineDraws,candidateDraws}
   report.paired.push(row);console.log('PAIRED',JSON.stringify(row))
   writeFileSync('tmp/shandong-ai-bench/report.json',JSON.stringify(report,null,2))
  }
 }finally{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()}
},120000)
