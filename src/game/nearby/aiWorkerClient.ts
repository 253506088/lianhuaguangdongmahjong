import type { NearbySettings } from './protocol'
/** Keep exhaustive bot searches off the host's rendering/network event loop. */
export function nearbyAiWorker(settings: NearbySettings) {
  if (typeof Worker === 'undefined') return null
  const worker = new Worker(new URL('./aiWorker.ts', import.meta.url), { type: 'module' })
  let serial = 0
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>()
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id); if (!p) return
    pending.delete(data.id)
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data.action)
  }
  worker.onerror = () => { pending.forEach(p => p.reject(new Error('普通 AI 引擎加载失败，请重新打开 App 恢复房间'))); pending.clear() }
  return {
    decide(method: string, context: any) {
      const id = ++serial
      // Contexts are trusted engine data; rule functions stay in the worker.
      const data = JSON.parse(JSON.stringify({ ...context, ruleset: undefined }))
      return new Promise<any>((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, method, context: data, rule: settings.rule }) })
    },
    close() { worker.terminate(); pending.forEach(p => p.reject(new Error('Room closed'))); pending.clear() },
  }
}
