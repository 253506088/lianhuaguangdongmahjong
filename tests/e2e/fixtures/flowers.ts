import { createApp, h, reactive } from 'vue'
import '../../../src/style.css'
import GameTableHud from '../../../src/components/table/GameTableHud.vue'
import GameShellHeader from '../../../src/components/shell/GameShellHeader.vue'
import { FLOWER_TILES } from '../../../src/game/core/rules/tiles'
import type { GamePlayer, Meld, TileType } from '../../../src/game/core/contracts/types'
import { defaultAvatarForSeat } from '../../../src/game/core/presentation/avatar'
import { themePresentationByName, themePresentationCssVariables } from '../../../src/theme/themePresentation'
import { isTableThemeName } from '../../../src/theme/themeIdentity'
import { useAudio } from '../../../src/game/core/presentation/useAudio'

const query = new URLSearchParams(location.search)
const requestedTheme = query.get('theme')
const theme = isTableThemeName(requestedTheme) ? requestedTheme : 'jade'
const max = query.has('max')
const players = reactive<GamePlayer[]>([0, 1, 2, 3].map(seat => ({
  seat, name: ['本家', '下家', '对家', '上家'][seat], avatar: defaultAvatarForSeat(seat), score: 2000,
  hand: ['m2','m3','m4','m6','m7','m8','p2','p3','p4','s8'] as TileType[],
  melds: [
    { type: 'peng', tile: 's1', from: (seat + 1) % 4, tiles: ['s1','s1','s1'] },
    ...(max ? seat === 0 ? FLOWER_TILES : [] : FLOWER_TILES.slice(seat * 2, seat * 2 + 2))
      .map(tile => ({ type: 'flower', tile, tiles: [tile] })),
  ] as Meld[],
  discards: ['m9', 'p9', 's9', 'east', 'red', 'green'] as TileType[], redCount: 0, drawnTileIndex: -1,
})))
const props = {
  themeName: theme, players, user: players[0], phase: 'playing' as const,
  wall: Array(64).fill('east') as TileType[], wallHeadDrawn: 0, wallCount: 64,
  currentPlayer: 0, selectedIndex: -1, turnSeconds: 0, lastDiscard: null, actionPrompt: null, announcement: null,
  tableActionEvent: null, scoreFlowEvent: null, result: null, winEffect: null, winPresentation: null,
  revealHands: false, matchFinished: false, winningPlayerIndex: -1, dealer: 0, isUserTurn: true,
  userCanHu: false, matchName: '东风场', roundLabel: '东一局', dealAnimation: { playerIndex: -1, count: 0, serial: 0 },
  openingStage: null, diceValues: [1, 2], diceThrowerIndex: 0, userCurrentWaits: null, userTingOptions: [],
  userDiscardWaits: null, userKongs: [], userHasWindKong: false, rulesetId: 'shandong' as const,
  jokerTiles: [], wildcardTiles: [],
}
Object.assign(window, { flowerFixture: {
  reset: () => players.forEach(p => { p.melds = p.melds.filter(m => m.type !== 'flower') }),
  draw: (seat: number, tile: TileType) => players[seat].melds.push({ type: 'flower', tile, tiles: [tile] }),
} })
createApp({ setup() { useAudio(); }, render: () => h('main', { class: 'game-app', 'data-table-theme': theme,
  style: themePresentationCssVariables(themePresentationByName(theme)) },
  [h('div', { class: 'has-three-scene' }, [
    h(GameShellHeader, { gameMode: 'local', phase: 'playing', hasPlayers: true,
      matchName: '东风场', roundLabel: '东一局', honba: 0, roomId: '', signalQuality: 3, themeName: theme }),
    h(GameTableHud, props),
  ])]) }).mount('#app')
