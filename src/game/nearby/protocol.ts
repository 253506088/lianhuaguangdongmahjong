import type { RuleVariant } from '../core/rules/ruleVariants'
import type { TileType } from '../core/contracts/types'
import { DEFAULT_SHANDONG_AI_MODE, isShandongAiMode, type ShandongAiMode } from '../variants/shandong/shandongAiMode'

export const NEARBY_VERSION = 1
export interface NearbySettings {
  rule: RuleVariant
  takeover: boolean
  jiang: '258' | 'luan'
  chi: boolean
  /** 旧房间存档可缺省，沿用增加此设置前的牌效版。 */
  aiMode?: ShandongAiMode
}
export const DEFAULT_NEARBY_SETTINGS: NearbySettings = {
  rule: 'shandong', takeover: false, jiang: '258', chi: true, aiMode: DEFAULT_SHANDONG_AI_MODE,
}
export interface Invitation {
  v: 1
  room: string
  key: string
  hosts: string[]
  port: number
  fingerprint: string
}
export interface RoomSeat {
  seat: number
  name: string
  bot: boolean
  online: boolean
  ready: boolean
  continued: boolean
}
export interface RoomView {
  id: string
  settings: NearbySettings
  seats: RoomSeat[]
  started: boolean
  round: number
  recovering: boolean
}
export interface Choice {
  id: string
  kind: string
  handIndex?: number
  tile?: TileType
  meldIndex?: number
  meld?: { tiles: TileType[]; kind: 'sequence' | 'wind' | 'dragon' }
  declareMingLou?: boolean
  declareBaoTing?: boolean
}
export interface Decision {
  id: string
  method: string
  choices: Choice[]
  tile?: TileType
  from?: number
}
export function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('')
}
export function validSettings(value: unknown): value is NearbySettings {
  const s = value as NearbySettings
  return !!s && ['lotus-classic', 'lotus-legacy', 'lotus-blood-flow', 'shandong'].includes(s.rule)
    && typeof s.takeover === 'boolean' && ['258', 'luan'].includes(s.jiang) && typeof s.chi === 'boolean'
    && (s.aiMode === undefined || isShandongAiMode(s.aiMode))
}
export function privateAddress(host: string) {
  if (typeof host !== 'string') return false
  const p = host.split('.').map(Number)
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && p.every(n => n >= 0 && n < 256)
    && (p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31))
}
export function encodeInvitation(invite: Invitation) {
  return 'mahjong-nearby:' + JSON.stringify(invite)
}
export function parseInvitation(text: string): Invitation {
  if (text.length > 4096 || !text.startsWith('mahjong-nearby:')) throw new Error('这不是附近麻将房间的二维码')
  let value: Invitation
  try { value = JSON.parse(text.slice('mahjong-nearby:'.length)) } catch { throw new Error('房间二维码已损坏') }
  if (value?.v !== NEARBY_VERSION) throw new Error('房间版本不同，请双方更新到相同版本')
  if (!/^[a-f0-9]{48}$/.test(value.room) || !/^[a-f0-9]{48}$/.test(value.key)
    || !Array.isArray(value.hosts) || value.hosts.length < 1 || value.hosts.length > 8
    || !value.hosts.every(privateAddress) || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535
    || !/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new Error('房间地址无效，请重新扫描房主二维码')
  return value
}
export function roundLabel(round: number) {
  return `${['东', '南', '西', '北'][Math.floor((round - 1) / 4) % 4]}${(round - 1) % 4 + 1}局 · 第${Math.floor((round - 1) / 16) + 1}轮`
}
