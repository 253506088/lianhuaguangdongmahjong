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
import { ensureTailNotFlower, SHANDONG_RULESET } from './shandongRules'
import type { RuleSet } from '../../core/rules/ruleset'
import { createShandongGameState, type ShandongEndGameOptions } from './shandongState'
import { createShandongSelectors } from './shandongSelectors'
import { createShandongOpening } from './shandongOpening'
import { createShandongTileFlow, type ShandongDrawReason } from './shandongTileFlow'
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
import type { ReplayFrameSource, ReplayRecorderHooks, ReplayDeclaration } from '../../replay/types'
import {
  ANIME_ACTION_FALLBACK_AUDIO,
  type AnimeFixedTtsExecutor,
  type AnimeSeat,
} from '../../llm/animeFixedTtsExecutor'

const ANIME_FIXED_ACTION_AUDIO_FILES: ReadonlySet<string> = new Set(
  Object.values(ANIME_ACTION_FALLBACK_AUDIO),
)

interface UseShandongGameOptions {
  recorder?: ReplayRecorderHooks
  playSound?: (name: string, volume?: number, onFinish?: () => void) => unknown
  playSoundAndWait?: (name: string, volume?: number) => Promise<void>
  controllers?: ShandongController[]
  aiControllers?: ShandongController[]
  aiPlayerSeeds?: Array<PlayerSeed | undefined>
  humanPlayerSeed?: PlayerSeed
  countdownEnabled?: boolean
  headless?: boolean
  controllerDrivenLockedTurns?: boolean
  getTableThemeName?: () => string
  ruleset?: RuleSet
  animeFixedTts?: AnimeFixedTtsExecutor
  getJiangRule?: () => '258' | 'luan'
  getAllowChiRule?: () => boolean
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
  controllerDrivenLockedTurns = false,
  getTableThemeName = () => '',
  ruleset = SHANDONG_RULESET,
  animeFixedTts,
  getJiangRule = () => '258',
  getAllowChiRule = () => true,
  recorder,
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
  state.allowChi.value = getAllowChiRule() !== false
  const selectors = createShandongSelectors(state, ruleset)
  let initialWall: TileType[] = []
  const replayFrame = (): ReplayFrameSource => ({
    players: state.players, wallLeft: state.wall.value.length, headDrawn: state.wallHeadDrawn.value,
    currentPlayer: state.currentPlayer.value, round: state.round.value, dealer: state.dealer.value,
    honba: state.honba.value, matchType: state.matchType.value,
    diceValues: state.diceValues.value, diceThrowerIndex: state.diceThrowerIndex.value,
    jokerTiles: [], wildcardTiles: [], initialWall, gangHeadTile: state.gangHeadTile.value,
    shandong: { jiang: state.luanJiang.value ? 'luan' : '258', allowChi: state.allowChi.value },
  })
  const onDeclaration = (seat: number, kind: ReplayDeclaration) => recorder?.declaration?.({ seat, kind }, replayFrame())

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

  function drawFromWall(type: ShandongDrawReason | boolean = 'normal'): TileType | null {
    if (state.wall.value.length === 0) return null
    const mode: ShandongDrawReason = type === true || type === 'kong'
      ? 'kong'
      : type === 'flower'
        ? 'flower'
        : 'normal'

    if (mode === 'normal') {
      // 牌墙若仅剩 1 张（即仅剩公开的杠头），正常摸牌结束，不能摸走杠头，流局
      if (state.wall.value.length <= 1) return null
      state.wallHeadDrawn.value += 1
      return state.wall.value.shift() ?? null
    }

    if (mode === 'flower') {
      // 补花摸牌：绝不能摸走公开的杠头（最后一张），从杠头前一张（倒数第二张）摸取
      if (state.wall.value.length < 2) return null
      return state.wall.value.splice(state.wall.value.length - 2, 1)[0] ?? null
    }

    if (mode === 'kong') {
      // 开杠摸牌：摸走公开的杠头（最后一张）
      const tile = state.wall.value.pop() ?? null
      // 摸走后，掀开牌尾下一张作为新的杠头（确保不为花牌）
      ensureTailNotFlower(state.wall.value)
      state.gangHeadTile.value = state.wall.value.length > 0 ? state.wall.value[state.wall.value.length - 1] : null
      return tile
    }

    return null
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
    recorder?.tableAction({ type, actorIndex, sourceIndex, tile, meldIndex }, replayFrame())
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
    onDraw: (seat, tile, reason) => recorder?.draw({ seat, tile, fromTail: reason !== 'normal', reason }, replayFrame()),
    onDiscard: (seat, tile, id) => recorder?.discard({ seat, tile, id }, replayFrame()),
  })

  turnOrchestrator = createShandongTurnOrchestrator({
    onDeclaration,
    controllerDrivenLockedTurns,
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
    onRoundSettled: () => {
      if (state.result.value) recorder?.roundEnd(state.result.value, replayFrame())
    },
    state,
    playSound: playPresentationSound,
    playSoundAndWait: playPresentationSoundAndWait,
    getRoundLabel: () => selectors.roundLabel.value,
    showTableAction,
    wait,
    announce: transient.announce,
  })

  openingTimeline = createShandongOpening({
    onRoundReady: (wall) => {
      initialWall = wall
      recorder?.roundStart(replayFrame())
    },
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
    enabled: countdownEnabled && !headless,
    onDiscard: () => playerActions.userDiscard(),
    onPass: () => playerActions.userPass(),
  })

  playerActions = createShandongHuman({
    onDeclaration,
    state,
    humanController,
    turnOrchestrator,
    getUser: () => selectors.user.value,
    isUserTurn: () => selectors.isUserTurn.value,
    canUserHu: () => selectors.userCanHu.value,
    getUserKongs: () => selectors.userKongs.value,
    userCanMingLou: () => selectors.userCanMingLou.value,
    userCanBaoTing: () => selectors.userCanBaoTing.value,
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
    playerActions?.resetDeclaration()
    clearTimers()
    animeFixedTts?.cancel()
    countdown?.stop()
    state.actionPrompt.value = null
    state.tableActionEvent.value = null
    state.scoreFlowEvent.value = null
    state.announcement.value = null
    state.gangHeadTile.value = null
  }

  function startGame(mode?: MatchType, options: GameStartOptions = {}) {
    playerActions?.resetDeclaration()
    state.luanJiang.value = getJiangRule() === 'luan'
    state.allowChi.value = getAllowChiRule() !== false
    controllers.forEach((c) => c.reset())
    return openingTimeline.start(mode, options)
  }

  const capabilities = computed<GameCapabilities>(() => ({
    chi: {
      get available() {
        return state.allowChi.value
      },
      choose(optionIndex: number) {
        if (!state.allowChi.value) return
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
    baoTing: {
      get available() {
        return selectors.userCanBaoTing.value
      },
      execute() {
        playerActions.userBaoTing()
      },
    },
    gangHeadTile: state.gangHeadTile.value,
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
    drawFromWall,
  })
}

export type ShandongGame = ReturnType<typeof useShandongGame>
