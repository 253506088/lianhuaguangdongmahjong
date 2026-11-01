export interface NativeNearbyEvent { event: 'connected' | 'disconnected' | 'message' | 'foreground' | 'background' | 'connectionError'; peer: string; data: string }
export interface NearbyTransport {
  request<T = any>(op: string, args?: Record<string, unknown>): Promise<T>
  subscribe(listener: (event: NativeNearbyEvent) => void): () => void
}
declare global {
  interface Window {
    MahjongNearby?: { postMessage(data: string): void; onmessage: ((event: { data: string }) => void) | null }
  }
}
let transport: NearbyTransport | null = null
export function nativeNearby(): NearbyTransport {
  if (transport) return transport
  const bridge = window.MahjongNearby
  if (!bridge) throw new Error('附近联机需要新版 Android App 与 Android System WebView')
  let serial = 0
  const waiting = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const listeners = new Set<(event: NativeNearbyEvent) => void>()
  bridge.onmessage = ({ data }) => {
    let message: any
    try { message = JSON.parse(data) } catch { return }
    if (message.event) { listeners.forEach(listener => listener(message)); return }
    const pending = waiting.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer); waiting.delete(message.id)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result)
  }
  transport = {
    request: (op, args = {}) => new Promise((resolve, reject) => {
      const id = String(++serial)
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('连接超时，请检查双方 Wi-Fi 或热点连接')) }, op === 'scan' ? 300_000 : 15_000)
      waiting.set(id, { resolve, reject, timer })
      try { bridge.postMessage(JSON.stringify({ id, op, args })) }
      catch (e) { waiting.delete(id); clearTimeout(timer); reject(e) }
    }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return transport
}
