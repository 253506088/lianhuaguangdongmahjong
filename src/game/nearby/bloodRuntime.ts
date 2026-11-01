import { BloodFlowEngine } from '../variants/lotus/bloodFlow/engine'
import { bloodFlowSeatView } from '../variants/lotus/bloodFlow/seatView'
import { decideBloodFlowActionEv } from '../variants/lotus/bloodFlow/ai'
import { BLOOD_FLOW_AI } from '../variants/lotus/bloodFlow/config'
import type { Seat } from '../variants/lotus/bloodFlow/types'
import type { RoundJournal } from './roomEngine'

/** No expire path: time can open visual beats but never chooses a human's action. */
export function createNearbyBloodRuntime() {
  let engine: BloodFlowEngine | null = null
  let time = Date.now()
  return (request: any): any => {
    time = Math.max(time, Date.now())
    if (request.op === 'start') {
      const journal = request.journal as RoundJournal
      const o = journal.opening
      engine = new BloodFlowEngine({ authorityEpoch: journal.id ?? 'nearby-v1', roundId: journal.id ? `${journal.id}/${journal.number}` : `nearby-round-${journal.number}`,
        dealer: o.dealer as Seat, scores: o.scores as [number, number, number, number], initialWall: o.initialWall,
        firstDice: o.openingDice, secondDice: o.openingSecondDice, decisionMs: Number.MAX_SAFE_INTEGER,
        winBeatMs: 0, now: () => time })
      for (const entry of journal.actions) {
        if (entry.method !== `blood:${engine.window?.id}`) throw new Error('血流恢复日志与当前决策窗口不匹配')
        time = Math.max(time, engine.window?.opensAt ?? time)
        if (!engine.submit(engine.command(entry.seat as Seat, entry.action as any))) throw new Error('血流恢复日志含有无效动作')
      }
    }
    if (!engine) throw new Error('No nearby blood-flow round')
    if (request.op === 'choose') return decideBloodFlowActionEv(bloodFlowSeatView(engine, request.seat), BLOOD_FLOW_AI)
    if (request.op === 'action' && `blood:${engine.window?.id}` === request.method) engine.submit(engine.command(request.seat, request.action))
    return [0, 1, 2, 3].map(seat => bloodFlowSeatView(engine!, seat as Seat))
  }
}
