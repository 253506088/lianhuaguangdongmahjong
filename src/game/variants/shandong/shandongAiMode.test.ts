import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TileType } from '../../core/contracts/types'
import { ShandongAiController } from './shandongControllers'
import { decideTurn } from './shandongAi'
import { createShandongWall } from './shandongRules'
import { useShandongGame } from './shandongGame'
import {
  DEFAULT_SHANDONG_AI_MODE, SHANDONG_AI_MODE_STORAGE_KEY,
  readShandongAiModePreference, saveShandongAiModePreference, shandongAiModeLabel, type ShandongAiMode,
} from './shandongAiMode'

const BLOCKS: TileType[] = ['m1','m2','m3','m4','m5','m6','m7','m8','m9','p1','p2','p3']
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('山东AI模式并存', () => {
  it('同一局面旧版仍比较听口种类，新版按公开余张选择活听', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.99)
    const hand: TileType[] = [...BLOCKS,'s2','s5']
    const ctx = {hand, melds: [], visibleTiles: [...hand,'s5','s5','s5'] as TileType[]}
    const controller = new ShandongAiController(0, fn => fn())
    const classic = await controller.requestTurn({...ctx, aiMode: 'classic'})
    const efficiency = await controller.requestTurn({...ctx, aiMode: 'efficiency'})
    expect(classic).toEqual({kind: 'discard', handIndex: 12, declareBaoTing: true, declareMingLou: false})
    expect(efficiency).toEqual({kind: 'discard', handIndex: 13, declareBaoTing: true, declareMingLou: false})
    expect(decideTurn(ctx)).toEqual(efficiency)
  })

  it('模式偏好持久化；旧存储、非法值和禁用存储安全回退到当前牌效版', () => {
    const values = new Map<string, string>()
    const storage = {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }}
    expect(readShandongAiModePreference(storage)).toBe(DEFAULT_SHANDONG_AI_MODE)
    for (const mode of ['classic','efficiency'] as const) {
      saveShandongAiModePreference(mode, storage)
      expect(readShandongAiModePreference(storage)).toBe(mode)
    }
    values.set(SHANDONG_AI_MODE_STORAGE_KEY, 'unknown')
    expect(readShandongAiModePreference(storage)).toBe('efficiency')
    const denied = {getItem: () => { throw new Error('disabled') }, setItem: () => { throw new Error('disabled') }}
    expect(readShandongAiModePreference(denied)).toBe('efficiency')
    expect(() => saveShandongAiModePreference('classic', denied)).not.toThrow()
    expect(shandongAiModeLabel(undefined)).toBe('AI 模式未记录')
  })

  it('开场读取选择，同场续局固定模式，另开一场才采用新的选择', async () => {
    vi.stubGlobal('window', {setTimeout, clearTimeout, setInterval, clearInterval})
    let selected: ShandongAiMode = 'classic'
    const received: ShandongAiMode[] = []
    const controllers = Array.from({length: 4}, () => {
      const ai = new ShandongAiController(0)
      vi.spyOn(ai, 'requestTurn').mockImplementation(ctx => {
        received.push(ctx.aiMode!)
        return new Promise(() => {})
      })
      return ai
    })
    const hand: TileType[] = [...BLOCKS,'s5','red']
    const pool = createShandongWall()
    hand.forEach(tile => pool.splice(pool.indexOf(tile),1))
    const initialWall = [...hand,...pool]
    const game = useShandongGame({headless: true, controllers, getAiMode: () => selected})
    await game.startGame('east', {initialWall})
    await Promise.resolve()
    selected = 'efficiency'
    game.phase.value = 'settled'
    await game.startGame(undefined, {initialWall})
    await Promise.resolve()
    await game.startGame('east', {initialWall})
    await Promise.resolve()
    expect(received).toEqual(['classic','classic','efficiency'])
    game.returnToLobby()
  })
})
