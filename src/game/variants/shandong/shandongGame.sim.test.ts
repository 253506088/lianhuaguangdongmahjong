import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShandongGame, type ShandongGame } from './shandongGame'

function stubWindow() {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * 牌数守恒（山东麻将）：
 * 144 张牌（136数牌字牌 + 8花牌）在
 * 「牌墙 + 各家手牌 + 各家副露（含花牌） + 各家弃牌」之间流转，总数恒为 144。
 */
function checkTileConservation(game: ShandongGame) {
  const wall = game.wall.value.length
  const hands = game.players.reduce((sum, player) => sum + player.hand.length, 0)
  const melds = game.players.reduce(
    (sum, player) => sum + player.melds.reduce((m, meld) => m + (meld.tiles?.length ?? 0), 0),
    0,
  )
  const discards = game.players.reduce((sum, player) => sum + player.discards.length, 0)
  const inPlay = wall + hands + melds + discards
  expect(inPlay, `牌数不守恒: wall=${wall} hands=${hands} melds=${melds} discards=${discards}`).toBe(144)
}

async function playOneMatch(maxSteps = 8000) {
  const game = useShandongGame({
    playSound: () => {},
    playSoundAndWait: async () => {},
    countdownEnabled: true,
  })
  const startPromise = game.startGame('east')
  const settledRounds: string[] = []
  let steps = 0

  while (steps < maxSteps) {
    steps += 1
    if (game.matchFinished.value || game.phase.value === 'finished') break
    if (game.phase.value === 'settled') {
      settledRounds.push(String(game.round.value))
      checkTileConservation(game)
      game.nextRound()
      continue
    }
    if (game.phase.value === 'lobby') break
    await vi.advanceTimersByTimeAsync(1000)
  }

  await startPromise
  return {
    finished: game.matchFinished.value || game.phase.value === 'finished',
    steps,
    phase: game.phase.value,
    round: game.round.value,
    settledRounds,
    scores: game.players.map((player) => ({ name: player.name, score: player.score })),
  }
}

describe('山东麻将整局模拟：144张牌与对局闭环', () => {
  it('单人场在固定步数内能到达结算，不出死循环且牌数守恒', async () => {
    stubWindow()
    const result = await playOneMatch()
    expect(result.steps).toBeLessThan(8000)
    expect(result.phase === 'finished' || result.phase === 'settled').toBe(true)
    // 分数总和守恒（各家起始 2000，转移之和为 0，总分为 8000）
    const totalScore = result.scores.reduce((sum, p) => sum + p.score, 0)
    expect(totalScore).toBe(8000)
  }, 60_000)

  it('UI 开局流程：带 waitForTableReady 时状态能顺利脱离 lobby 并进入对局', async () => {
    stubWindow()
    const game = useShandongGame({
      playSound: () => {},
      playSoundAndWait: async () => {},
      countdownEnabled: false,
    })

    let resolveTable: () => void
    const tableReadyPromise = new Promise<void>((resolve) => {
      resolveTable = resolve
    })

    void game.startGame('east', {
      waitForTableReady: () => tableReadyPromise,
    })

    // 刚发起开局：phase 应该已经脱离 lobby，变成 opening，玩家已经创建
    expect(game.phase.value).toBe('opening')
    expect(game.players.length).toBe(4)
    expect(game.user.value).toBeDefined()
    expect(game.wall.value.length).toBe(144)

    // 牌桌准备完毕
    resolveTable!()

    // 推进开局时间线（掷骰 600ms + 发牌补花 600ms）
    await vi.advanceTimersByTimeAsync(1500)

    // 检查已进入对局或庄家第一回合出牌
    expect(['playing', 'discard'].includes(game.phase.value)).toBe(true)
    expect(game.isUserTurn.value).toBe(true)
    expect(game.user.value!.hand.length).toBe(14)
    checkTileConservation(game)

    // 本家打出第一张牌后，手牌从 14 张减少为 13 张
    game.userDiscard(0)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)

    expect(game.players[0].hand.length).toBe(13)
    // 牌数仍然守恒（弃牌进入牌河或被其他家鸣牌副露）
    checkTileConservation(game)
    const discardedOrClaimed = game.players[0].discards.length + game.players.reduce((sum, p) => sum + p.melds.filter(m => m.from === 0).length, 0)
    expect(discardedOrClaimed).toBe(1)
  })
})

