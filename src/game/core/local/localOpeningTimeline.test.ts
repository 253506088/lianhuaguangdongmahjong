import { describe, expect, it, vi } from 'vitest'
import { createLocalGameState } from './localGameState'
import { createLocalOpeningTimeline } from './localOpeningTimeline'

describe('localOpeningTimeline', () => {
  it('marks the dealer draw before another player wins on four opening reds', async () => {
    const state = createLocalGameState()
    let drawn = 0
    const endGame = vi.fn()
    const timeline = createLocalOpeningTimeline({
      state, clearTimers: () => timeline.cancel(),
      // The first four-tile batch for seat 1 contains all four reds.
      takeTile: () => { const index = drawn++; return index >= 4 && index < 8 ? 'red' : 'm1' },
      wait: async () => {}, later: vi.fn(() => 1), playSound: vi.fn(),
      playSoundAndWait: async () => {}, announce: vi.fn(), getRoundLabel: () => '东1局',
      beginTurn: vi.fn(), endGame,
    })
    await timeline.start('east', { openingDice: [1, 1] })
    expect(endGame).toHaveBeenCalledWith(1, { fourRed: true })
    expect(state.players[0].hand).toHaveLength(14)
    expect(state.players[0].drawnTileIndex).toBe(13)
  })
  it('waits for the 3D table before entering the opening stage', async () => {
    const state = createLocalGameState()
    let releaseTableReady!: () => void
    const tableReady = new Promise<void>((resolve) => { releaseTableReady = resolve })
    const timeline = createLocalOpeningTimeline({
      state,
      clearTimers: () => timeline.cancel(),
      takeTile: () => null,
      wait: async () => {},
      later: vi.fn(() => 1),
      playSound: vi.fn(),
      playSoundAndWait: async () => {},
      announce: vi.fn(),
      getRoundLabel: () => '东1局',
      beginTurn: vi.fn(),
      endGame: vi.fn(),
    })

    const opening = timeline.start('east', { waitForTableReady: () => tableReady })
    await Promise.resolve()
    expect(state.openingStage.value).toBeNull()

    releaseTableReady()
    await Promise.resolve()
    expect(state.openingStage.value).toBe('start')

    timeline.cancel()
    await opening
  })

  it('cancels an in-flight opening before dice and dealing mutate state', async () => {
    const state = createLocalGameState()
    let releaseWait!: () => void
    const timeline = createLocalOpeningTimeline({
      state,
      clearTimers: () => timeline.cancel(),
      takeTile: () => null,
      wait: () => new Promise<void>((resolve) => { releaseWait = resolve }),
      later: vi.fn(() => 1),
      playSound: vi.fn(),
      playSoundAndWait: async () => {},
      announce: vi.fn(),
      getRoundLabel: () => '东1局',
      beginTurn: vi.fn(),
      endGame: vi.fn(),
    })

    const opening = timeline.start('east')
    await Promise.resolve()
    expect(state.openingStage.value).toBe('start')

    timeline.cancel()
    releaseWait()
    await opening

    expect(state.openingStage.value).toBeNull()
    expect(state.diceValues.value).toEqual([1, 1])
  })
})
