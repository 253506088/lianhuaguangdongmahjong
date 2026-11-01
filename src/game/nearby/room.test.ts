import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createNearbyRoom, readNearbySave, type RoomStorage } from './room'
import type { NativeNearbyEvent, NearbyTransport } from '../../platform/nearbyBridge'
import { DEFAULT_NEARBY_SETTINGS } from './protocol'

function memory(): RoomStorage {
  const map = new Map<string, string>()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value) }, removeItem: key => { map.delete(key) } }
}
/** Deterministic protocol test only. Real TLS/Android coverage lives in android-nearby.mjs. */
function network() {
  let host: ReturnType<typeof endpoint> | null = null, seq = 0
  const endpoints = new Map<string, ReturnType<typeof endpoint>>()
  function endpoint() {
    let id = ''
    const listeners = new Set<(e: NativeNearbyEvent) => void>()
    const emit = (event: NativeNearbyEvent['event'], peer = '', data = '') => listeners.forEach(l => l({ event, peer, data }))
    const transport: NearbyTransport = {
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      request: async (op, args: any = {}): Promise<any> => {
        if (op === 'host') { host = current; return { hosts: ['192.168.1.2'], port: 30000, fingerprint: 'a'.repeat(64) } }
        if (op === 'join') {
          if (id) { endpoints.delete(id); host?.emit('disconnected', id) }
          id = `connection-${++seq}`; endpoints.set(id, current)
          queueMicrotask(() => { host?.emit('connected', id); emit('connected', 'host') }); return true
        }
        if (op === 'send') {
          if (current === host) endpoints.get(args.peer)?.emit('message', 'host', args.data)
          else host?.emit('message', id, args.data)
        }
        if (op === 'disconnect') {
          const target = endpoints.get(args.peer); endpoints.delete(args.peer)
          host?.emit('disconnected', args.peer); target?.emit('disconnected', 'host')
        }
        if (op === 'stop') {
          if (current === host) { for (const peer of endpoints.values()) peer.emit('disconnected', 'host'); endpoints.clear(); host = null }
          else { endpoints.delete(id); host?.emit('disconnected', id) }
        }
        return true
      },
    }
    const current = { transport, emit, drop: () => { endpoints.delete(id); host?.emit('disconnected', id); emit('disconnected', 'host') } }
    return current
  }
  return { endpoint }
}
const close: Array<() => void> = []
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval }) })
afterEach(() => { close.splice(0).forEach(fn => fn()); vi.useRealTimers(); vi.unstubAllGlobals() })
const flush = () => vi.advanceTimersByTimeAsync(100)
function client(net: ReturnType<typeof network>, storage = memory()) {
  const end = net.endpoint(), room = createNearbyRoom(end.transport, storage)
  close.push(room.dispose)
  return { room, end, storage }
}

it.each([2, 3, 4])('%i humans: host owns settings, all humans ready, empty seats become bots, peers see only their hand', async count => {
  const net = network(), host = client(net), guests = Array.from({ length: count - 1 }, () => client(net))
  await host.room.create('Host')
  await expect(host.room.start()).rejects.toThrow('至少两位')
  for (const [i, guest] of guests.entries()) await guest.room.join(host.room.invite.value!, `Guest ${i}`)
  await flush()
  expect(host.room.room.value!.seats.filter(s => !s.bot)).toHaveLength(count)
  for (const guest of guests) {
    guest.room.configure({ ...DEFAULT_NEARBY_SETTINGS, rule: 'shandong', takeover: true })
    guest.room.act('ready', { ready: true })
  }
  await flush()
  expect(host.room.room.value!.settings.takeover).toBe(false)
  await host.room.start(); await flush()
  expect(host.room.room.value!.seats.filter(s => s.bot)).toHaveLength(4 - count)
  for (const guest of guests) {
    expect(guest.room.table.value!.players[0].seat).toBe(guest.room.mySeat.value)
    expect(guest.room.table.value!.players[0].hand.length).toBeGreaterThan(0)
    expect(guest.room.table.value!.players.slice(1).every(p => p.hand.length === 0)).toBe(true)
    expect(guest.room.table.value!.wall).toEqual([])
  }
  await host.room.leave(true); await flush()
  expect(guests.every(g => g.room.room.value === null)).toBe(true)
  expect(guests.every(g => readNearbySave(g.storage) === null)).toBe(true)
})

it('reserves the original seat across changed connections and app restart; strangers cannot enter a running game', async () => {
  const net = network(), host = client(net), guest = client(net)
  await host.room.create('Host')
  await guest.room.join(host.room.invite.value!, 'Guest'); await flush()
  guest.room.act('ready', { ready: true }); await flush()
  await host.room.start(); await flush()
  const seat = guest.room.mySeat.value
  guest.end.drop(); await flush()
  expect(host.room.room.value!.seats[seat].online).toBe(false)
  const stranger = client(net)
  await stranger.room.join(host.room.invite.value!, 'Stranger'); await flush()
  expect(stranger.room.error.value).toContain('只允许原玩家')
  await vi.advanceTimersByTimeAsync(2500)
  expect(guest.room.mySeat.value).toBe(seat)
  expect(host.room.room.value!.seats[seat].online).toBe(true)
  guest.room.dispose()
  const restarted = client(net, guest.storage)
  await restarted.room.resume(); await flush()
  expect(restarted.room.mySeat.value).toBe(seat)
  expect(host.room.room.value!.seats.filter(s => !s.bot)).toHaveLength(2)
})

it('waits indefinitely for an offline human by default, then host can enable takeover and revoke it mid-game', async () => {
  const net = network(), host = client(net), guest = client(net)
  await host.room.create('Host'); await guest.room.join(host.room.invite.value!, 'Guest'); await flush()
  guest.room.act('ready', { ready: true }); await flush(); await host.room.start(); await flush()
  // Leave the first host turn untouched for ten simulated minutes.
  const original = host.room.decision.value
  await vi.advanceTimersByTimeAsync(600_000)
  expect(host.room.decision.value?.id).toBe(original?.id)
  guest.room.dispose(); await flush()
  host.room.configure({ ...DEFAULT_NEARBY_SETTINGS, takeover: true })
  expect(host.room.room.value!.settings.takeover).toBe(true)
  host.room.configure({ ...DEFAULT_NEARBY_SETTINGS, takeover: false })
  expect(host.room.room.value!.settings.takeover).toBe(false)
  expect(host.room.room.value!.seats[1].bot).toBe(false)
})

it('restores the host journal and pinned invitation after a process restart, retaining cumulative scores and identities', async () => {
  const net = network(), host = client(net), guest = client(net)
  await host.room.create('Host'); await guest.room.join(host.room.invite.value!, 'Guest'); await flush()
  guest.room.act('ready', { ready: true }); await flush(); await host.room.start(); await flush()
  const invite = host.room.invite.value, before = host.room.table.value!.players
  host.room.dispose()
  const resumed = client(net, host.storage)
  await resumed.room.resume(); await flush()
  expect(resumed.room.invite.value).toEqual(invite)
  expect(resumed.room.table.value!.players).toEqual(before)
  await vi.advanceTimersByTimeAsync(2500)
  expect(guest.room.status.value).toBe('online')
  expect(guest.room.mySeat.value).toBe(1)
})
