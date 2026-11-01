import { effectScope, watch, type EffectScope } from 'vue'
import { useGame } from '../core/local/useGame'
import { useLotusGame } from '../variants/lotus/lotusGame'
import { useShandongGame } from '../variants/shandong/shandongGame'
import { normalizeShandongAiMode } from '../variants/shandong/shandongAiMode'
import { createWall, shuffle } from '../core/rules/tiles'
import { createShandongWall, ensureTailNotFlower } from '../variants/shandong/shandongRules'
import type { GamePort, GameStartOptions } from '../core/contracts/gamePort'
import type { NearbySettings, RoomSeat } from './protocol'
import { randomId } from './protocol'
import { DecisionBroker, type JournalAction } from './decisions'
import { nearbyControllers } from './controllers'
import { nearbyTableView, type NearbyTableView } from './tableView'
import { defaultAvatarForSeat } from '../core/presentation/avatar'
import { nearbyAiWorker } from './aiWorkerClient'

export interface RoundJournal {
  id?: string
  number: number
  opening: GameStartOptions & { dealer: number; scores: readonly number[]; openingSecondDice?: [number, number] }
  actions: JournalAction[]
}
export interface NearbyEngine {
  settled(): boolean
  scores(): number[]
  view(seat: number): { table?: NearbyTableView; blood?: unknown; decision: any }
  close(): void
  start(journal: RoundJournal): Promise<void>
}
export function newRound(number: number, settings: NearbySettings, scores?: number[]): RoundJournal {
  const wall = shuffle(settings.rule === 'shandong' ? createShandongWall() : createWall())
  if (settings.rule === 'shandong') ensureTailNotFlower(wall)
  const dice = (): [number, number] => [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1]
  return { id: randomId(), number, opening: { initialWall: wall, openingDice: dice(), openingSecondDice: dice(), dealer: (number - 1) % 4, scores: scores ?? [2000, 2000, 2000, 2000] }, actions: [] }
}
export function createNearbyEngine(settings: NearbySettings, seats: RoomSeat[], broker: DecisionBroker, changed: () => void): NearbyEngine {
  const scope: EffectScope = effectScope()
  const ai = nearbyAiWorker(settings)
  const controllers = nearbyControllers(settings, broker, ai?.decide)
  let game: GamePort
  const waitCache = new Map<string, any>()
  let stopped = false
  scope.run(() => {
    const seeds = seats.map(s => ({ name: s.name, avatar: defaultAvatarForSeat(s.seat), playerKind: s.bot ? 'bot' as const : 'human' as const }))
    const options = { controllers, countdownEnabled: false, headless: true, humanPlayerSeed: seeds[0], aiPlayerSeeds: seeds.slice(1) }
    game = settings.rule === 'shandong' ? useShandongGame({ ...options, controllerDrivenLockedTurns: true, getJiangRule: () => settings.jiang, getAllowChiRule: () => settings.chi, getAiMode: () => normalizeShandongAiMode(settings.aiMode) })
      : settings.rule === 'lotus-legacy' ? useLotusGame(options) : useGame(options)
    // Source changes are coalesced by the room before serializing private views.
    watch(() => [game.phase.value, game.players, game.wallCount.value, game.result.value, game.tableActionEvent.value, game.scoreFlowEvent.value,
      game.currentPlayer.value, game.openingStage.value, game.diceValues.value, game.revealHands.value, broker.decisions], changed, { deep: true })
  })
  const names = () => game.players.forEach((p, i) => {
    p.name = seats[i].name; p.avatar = defaultAvatarForSeat(i); p.playerKind = seats[i].bot ? 'bot' : 'human'
  })
  return {
    settled: () => !!game.result.value,
    scores: () => game.players.map(p => p.score),
    view: seat => {
      names()
      return { table: nearbyTableView(game, seat, broker.decisions[seat], settings, waitCache), decision: broker.decisions[seat] }
    },
    close: () => { stopped = true; game.returnToLobby(); scope.stop(); broker.reset(); ai?.close() },
    start: async journal => {
      broker.reset(); broker.replay = [...journal.actions]; broker.replayIndex = 0
      game.round.value = journal.number; game.dealer.value = (journal.number - 1) % 4
      game.matchFinished.value = false; game.honba.value = 0
      await game.startGame(undefined, journal.opening)
      if (journal.actions.length) {
        const deadline = Date.now() + 30_000
        while (!stopped && (broker.replayIndex < broker.replay.length || !broker.decisions.some(Boolean) && !game.result.value)) {
          if (Date.now() > deadline) throw new Error('房间恢复超时，请重新打开 App 再试')
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
      names(); changed()
    },
  }
}
