// 山东麻将本地引擎组装：规则、开局、摸打、吃碰杠胡、明搂、花分与算番
import { computed, getCurrentInstance, onBeforeUnmount, ref } from 'vue'
import { defineGamePort, type GameCapabilities, type GameStartOptions } from '../../core/contracts/gamePort'
import type { EndGameOptions, MatchType, TableActionEvent, TileType } from '../../core/contracts/types'
import { createLocalCountdownController } from '../../core/local/localCountdownController'
import { createLocalTransientEventPresenter } from '../../core/local/localTransientEventPresenter'
import { createMatchLifecycle } from '../../shared/runtime/matchLifecycle'
import { createTimerScheduler } from '../../shared/runtime/timerScheduler'
import type { PlayerSeed } from '../../shared/runtime/localOpening'
import { tileName } from '../../core/rules/tiles'
import { SHANDONG_RULESET } from './shandongRules'
import type { RuleSet } from '../../core/rules/ruleset'
import { createShandongGameState, type ShandongEndGameOptions } from './shandongState'
import { createShandongSelectors } from './shandongSelectors'
import { createShandongOpening } from './shandongOpening'
import { createShandongTileFlow } from './shandongTileFlow'
import { createShandongTurnOrchestrator } from './shandongTurnOrchestrator'
import { createShandongSettlement } from './shandongSettlement'
import { createShandongHuman } from './shandongHuman'
import {
  ShandongAiController,
  ShandongHumanController,
  type ShandongController,
  type ShandongHumanBridge,
} from './shandongControllers'
import { resolveAnimeAudioPolicy } from '../../core/presentation/animeAudioPolicy'
import {
  ANIME_ACTION_FALLBACK_AUDIO,
  type AnimeFixedTtsExecutor,
  type AnimeSeat,
} from '../../llm/animeFixedTtsExecutor'

const ANIME_FIXED_ACTION_AUDIO_FILES: ReadonlySet<string> = new Set(
  Object.values(ANIME_ACTION_FALLBACK_AUDIO),
)

interface UseShandongGameOptions {
  playSound?: (name: string, volume?: number, onFinish?: () => void) => unknown
  playSoundAndWait?: (name: string, volume?: number) => Promise<void>
  controllers?: ShandongController[]
  aiControllers?: ShandongController[]
  aiPlayerSeeds?: Array<PlayerSeed | undefined>
  humanPlayerSeed?: PlayerSeed
  countdownEnabled?: boolean
  headless?: boolean
  getTableThemeName?: () => string
  ruleset?: RuleSet
  animeFixedTts?: AnimeFixedTtsExecutor
  getJiangRule?: () => '258' | 'luan'
}

export function useShandongGame({
  playSound = () => {},
  playSoundAndWait = async () => {},
  controllers: suppliedControllers,
  aiControllers,
  aiPlayerSeeds,
  humanPlayerSeed,
  countdownEnabled = true,
  headless = false,
  getTableThemeName = () => '',
  ruleset = SHANDONG_RULESET,
  animeFixedTts,
  getJiangRule = () => '258',
}: UseShandongGameOptions = {}) {
  const sound = headless ? () => {} : playSound
  const soundAndWait = headless ? async () => {} : playSoundAndWait

  const usesAnimeFixedActionVoice = () => resolveAnimeAudioPolicy({
    themeName: getTableThemeName(),
    playerKind: 'unknown',
  }).actionVoice === 'fixed-line'

  const playPresentationSound = (name: string, volume?: number, onFinish?: () => void) => {
    if (usesAnimeFixedActionVoice() && ANIME_FIXED_ACTION_AUDIO_FILES.has(name)) return
    if (onFinish !== undefined) return sound(name, volume, onFinish)
    if (volume !== undefined) return sound(name, volume)
    return sound(name)
  }

  const playPresentationSoundAndWait = (name: string, volume?: number) => (
    usesAnimeFixedActionVoice() && ANIME_FIXED_ACTION_AUDIO_FILES.has(name)
      ? Promise.resolve()
      : soundAndWait(name, volume)
  )

  const playAnimeAction = (event: TableActionEvent) => {
    if (!animeFixedTts || !usesAnimeFixedActionVoice()) return
    const actor = state.players[event.actorIndex]
    if (!actor || event.actorIndex < 0 || event.actorIndex > 3) return
    void animeFixedTts.executeAction({
      eventId: event.id,
      seat: event.actorIndex as AnimeSeat,
      characterId: actor.characterId,
      action: event.type,
    }).then((result) => {
      if (result.fallbackAudioFile) sound(result.fallbackAudioFile)
    }).catch(() => {})
  }

  const state = createShandongGameState()
  state.luanJiang.value = getJiangRule() === 'luan'
  const selectors = createShandongSelectors(state, ruleset)

  let openingTimeline!: ReturnType<typeof createShandongOpening>
  let settlementTimeline!: ReturnType<typeof createShandongSettlement>
  let turnOrchestrator!: ReturnType<typeof createShandongTurnOrchestrator>
  let tileFlow!: ReturnType<typeof createShandongTileFlow>
  let playerActions!: ReturnType<typeof createShandongHuman>
  let countdown!: ReturnType<typeof createLocalCountdownController>
  let transient!: ReturnType<typeof createLocalTransientEventPresenter>

  const humanBridge: ShandongHumanBridge = {
    isTurn: ref(false),
    canHu: ref(false),
    canKong: ref<TileType[]>([]),
    canMingLou: selectors.userCanMingLou,
    actionPrompt: state.actionPrompt,
    selectedIndex: state.selectedIndex,
    drawnThisTurn: state.userDrewThisTurn,
    turnSeconds: state.turnSeconds,
    activateTurn() {
      state.phase.value = 'discard'
      countdown.startTurn()
    },
    activateClaim() {
      state.phase.value = 'prompt'
      countdown.startPrompt()
    },
    activateChi() {
      state.phase.value = 'prompt'
      countdown.startPrompt()
    },
    activateRobKong() {
      state.phase.value = 'prompt'
      transient.announce('可抢杠胡', 'red')
      countdown.startPrompt()
    },
    deactivate() {
      countdown?.stop()
    },
  }

  const humanController = new ShandongHumanController(humanBridge)
  const controllers: ShandongController[] = suppliedControllers ? [...suppliedControllers] : [
    humanController,
    aiControllers?.[0] ?? new ShandongAiController(headless ? 0 : 850),
    aiControllers?.[1] ?? new ShandongAiController(headless ? 0 : 850),
    aiControllers?.[2] ?? new ShandongAiController(headless ? 0 : 850),
  ]

  const timer = createTimerScheduler({
    controllers,
    stopCountdown: () => countdown?.stop(),
    cancelOpening: () => openingTimeline?.cancel(),
    instant: headless,
  })
  const later = timer.later
  const wait = timer.wait
  const clearTimers = () => {
    timer.clear()
  }

  transient = createLocalTransientEventPresenter({ state, later, onTableAction: playAnimeAction })

  function drawFromWall(fromTail = false): TileType | null {
    if (state.wall.value.length === 0) return null
    if (fromTail) {
      return state.wall.value.pop() ?? null
    }
    state.wallHeadDrawn.value += 1
    return state.wall.value.shift() ?? null
  }

  function endDraw() {
    if (['win-effect', 'revealing', 'settled'].includes(state.phase.value)) return
    countdown?.stop()
    state.actionPrompt.value = null
    void settlementTimeline.settleDraw()
  }

  function endGame(winnerIndex: number, options: ShandongEndGameOptions = {}) {
    if (['win-effect', 'revealing', 'settled'].includes(state.phase.value)) return
    countdown?.stop()
    state.actionPrompt.value = null
    void settlementTimeline.settleWin(winnerIndex, options)
  }

  function showTableAction(type: TableActionEvent['type'], actorIndex: number, sourceIndex: number | null, tile: TileType, meldIndex: number) {
    transient.showTableAction(type, actorIndex, sourceIndex, tile, meldIndex)
  }

  tileFlow = createShandongTileFlow({
    state,
    drawFromWall,
    endDraw,
    endGame,
    showTableAction,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    shouldAnnounceDiscard: (playerIndex, player) => {
      if (playerIndex === 0 || player.playerKind === 'human') return true
      return (
        resolveAnimeAudioPolicy({
          themeName: getTableThemeName(),
          playerKind: player.playerKind,
          isLlm: player.isLlm,
        }).discard.tileName !== 'suppress'
      )
    },
    wait,
    routeDiscard: (from, tile) => turnOrchestrator.routeDiscard(from, tile),
  })

  turnOrchestrator = createShandongTurnOrchestrator({
    state,
    controllers,
    drawFor: tileFlow.drawFor,
    discardTile: tileFlow.discardTile,
    endDraw,
    endGame,
    announce: transient.announce,
    showTableAction,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    wait,
    later,
  })

  settlementTimeline = createShandongSettlement({
    state,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    getRoundLabel: () => selectors.roundLabel.value,
    showTableAction,
    wait,
    announce: transient.announce,
  })

  openingTimeline = createShandongOpening({
    state,
    clearTimers,
    wait,
    later,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    announce: transient.announce,
    beginTurn: turnOrchestrator.beginTurn,
    endGame,
    playerSeeds: aiPlayerSeeds,
    humanPlayerSeed,
  })

  countdown = createLocalCountdownController({
    state,
    playSound: sound,
    enabled: countdownEnabled,
    onDiscard: () => playerActions.userDiscard(),
    onPass: () => playerActions.userPass(),
  })

  playerActions = createShandongHuman({
    state,
    humanController,
    turnOrchestrator,
    getUser: () => selectors.user.value,
    isUserTurn: () => selectors.isUserTurn.value,
    canUserHu: () => selectors.userCanHu.value,
    getUserKongs: () => selectors.userKongs.value,
    userCanMingLou: () => selectors.userCanMingLou.value,
    stopCountdown: countdown.stop,
    startTurnCountdown: countdown.startTurn,
    discardTile: tileFlow.discardTile,
    beginTurn: (playerIndex, opts) => turnOrchestrator.beginTurn(playerIndex, opts),
    endGame,
    announce: transient.announce,
    playSound: playPresentationSound,
    later,
  })

  const matchLifecycle = createMatchLifecycle({
    state,
    clearTimers: clearPresentation,
    startGame,
  })

  function clearPresentation() {
    clearTimers()
    animeFixedTts?.cancel()
    countdown?.stop()
    state.actionPrompt.value = null
    state.tableActionEvent.value = null
    state.scoreFlowEvent.value = null
    state.announcement.value = null
  }

  function startGame(mode?: MatchType, options: GameStartOptions = {}) {
    state.luanJiang.value = getJiangRule() === 'luan'
    controllers.forEach((c) => c.reset())
    return openingTimeline.start(mode, options)
  }

  const capabilities = computed<GameCapabilities>(() => ({
    chi: {
      choose(optionIndex: number) {
        playerActions.chooseChi(optionIndex)
      },
    },
    mingLou: {
      get available() {
        return selectors.userCanMingLou.value
      },
      execute() {
        playerActions.userMingLou()
      },
    },
  }))

  if (getCurrentInstance()) onBeforeUnmount(clearPresentation)

  return defineGamePort({
    phase: state.phase,
    players: state.players,
    wall: state.wall,
    wallHeadDrawn: state.wallHeadDrawn,
    wallCount: selectors.wallCount,
    currentPlayer: state.currentPlayer,
    selectedIndex: state.selectedIndex,
    turnSeconds: state.turnSeconds,
    lastDiscard: state.lastDiscard,
    actionPrompt: state.actionPrompt,
    announcement: state.announcement,
    tableActionEvent: state.tableActionEvent,
    scoreFlowEvent: state.scoreFlowEvent,
    result: state.result,
    winEffect: state.winEffect,
    winPresentation: state.winPresentation,
    revealHands: state.revealHands,
    winningPlayerIndex: state.winningPlayerIndex,
    round: state.round,
    dealer: state.dealer,
    user: selectors.user,
    isUserTurn: selectors.isUserTurn,
    userCanHu: selectors.userCanHu,
    matchType: state.matchType,
    matchName: selectors.matchName,
    matchFinished: state.matchFinished,
    honba: state.honba,
    roundLabel: selectors.roundLabel,
    standings: selectors.standings,
    dealAnimation: state.dealAnimation,
    openingStage: state.openingStage,
    diceValues: state.diceValues,
    diceThrowerIndex: state.diceThrowerIndex,
    userCurrentWaits: selectors.userCurrentWaits,
    userTingOptions: selectors.userTingOptions,
    userDiscardWaits: selectors.userDiscardWaits,
    userKongs: selectors.userKongs,
    capabilities,
    startGame,
    ...playerActions,
    ...matchLifecycle,
    tileName,
    humanController,
  })
}

export type ShandongGame = ReturnType<typeof useShandongGame>
