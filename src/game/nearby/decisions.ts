import { reactive } from 'vue'
import type { Choice, Decision } from './protocol'

export interface JournalAction { seat: number; method: string; action: unknown }
type Pending = {
  decision: Decision
  resolve(action: unknown): void
  values: Map<string, unknown>
  ai(): Promise<unknown>
  running: boolean
}

/** One authority issues single-use choices. Peers never send executable game actions. */
export class DecisionBroker {
  readonly decisions: Array<Decision | null> = reactive([null, null, null, null])
  private pending = new Map<number, Pending>()
  private sequence = 0
  private epoch = 0
  replay: JournalAction[] = []
  replayIndex = 0
  onAction: (entry: JournalAction) => void = () => {}
  onError: (error: Error) => void = () => {}
  automated: (seat: number) => boolean = () => false
  constructor(private delay = 650) {}

  request<T>(seat: number, method: string, choices: Array<{ choice: Omit<Choice, 'id'>; value: T }>, ai: () => Promise<T>, source?: { tile?: any; from?: number }): Promise<T> {
    if (this.replayIndex < this.replay.length) {
      const entry = this.replay[this.replayIndex++]
      if (entry.seat !== seat || entry.method !== method) {
        this.onError(new Error('房间恢复校验失败，已停止推进以保护牌局'))
        return new Promise(() => {})
      }
      return Promise.resolve(entry.action as T)
    }
    const id = `${this.epoch}:${++this.sequence}`
    const mapped = choices.map((c, index) => ({ ...c.choice, id: String(index) }))
    return new Promise<T>(resolve => {
      const decision: Decision = { id, method, choices: mapped, tile: source?.tile, from: source?.from }
      const pending: Pending = { decision, resolve, ai, running: false, values: new Map(choices.map((c, i) => [String(i), c.value])) }
      this.pending.set(seat, pending)
      this.decisions[seat] = decision
      this.refresh(seat)
    })
  }
  submit(seat: number, decisionId: string, choiceId: string) {
    const p = this.pending.get(seat)
    if (!p || p.decision.id !== decisionId || !p.values.has(choiceId) || this.automated(seat)) return false
    return this.finish(seat, p, p.values.get(choiceId))
  }
  private finish(seat: number, p: Pending, action: unknown) {
    if (this.pending.get(seat) !== p) return false
    // Persist before resolving. A process death can replay every acknowledged action.
    try { this.onAction({ seat, method: p.decision.method, action }) }
    catch { this.onError(new Error('无法保存牌局，已暂停。请释放手机存储空间后重新打开 App 恢复房间')); return false }
    this.pending.delete(seat)
    this.decisions[seat] = null
    p.resolve(action)
    return true
  }
  refresh(seat?: number) {
    for (const [index, p] of this.pending) {
      if (seat !== undefined && seat !== index) continue
      if (!this.automated(index) || p.running) continue
      p.running = true
      const epoch = this.epoch
      setTimeout(async () => {
        try {
          if (this.epoch !== epoch || this.pending.get(index) !== p || !this.automated(index)) return
          const action = await p.ai()
          if (this.epoch === epoch && this.automated(index)) this.finish(index, p, action)
        } catch (e) { if (this.epoch === epoch && this.pending.get(index) === p) this.onError(e instanceof Error ? e : new Error('机器人决策失败')) }
        finally { p.running = false }
      }, this.delay)
    }
  }
  resetSeat(seat: number) { this.pending.delete(seat); this.decisions[seat] = null }
  reset() {
    this.epoch++
    this.pending.clear()
    this.decisions.fill(null)
  }
}
