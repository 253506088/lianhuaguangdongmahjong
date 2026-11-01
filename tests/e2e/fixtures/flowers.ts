import { createApp, h, reactive, ref } from 'vue'
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
const mingLou = query.has('minglou')
const inspection = query.has('inspection')
const gangHeadTile = ref<TileType | null>(query.has('ganghead') ? 'm5' : null)
const players = reactive<GamePlayer[]>([0, 1, 2, 3].map(seat => ({
  seat, name: ['本家', '下家', '对家', '上家'][seat], avatar: defaultAvatarForSeat(seat), score: 2000,
  isMingLou: mingLou && seat === 2,
  hand: (mingLou && seat === 2
    ? ['m1','m2','m3','m4','m5','m6','p1','p2','p3','s4','s5','s6','east']
    : ['m2','m3','m4','m6','m7','m8','p2','p3','p4','s8']) as TileType[],
  melds: [
    ...(mingLou && seat === 2 ? [] : [{ type: 'peng', tile: 's1', from: (seat + 1) % 4, tiles: ['s1','s1','s1'] }]),
    ...(max ? seat === 0 ? FLOWER_TILES : [] : FLOWER_TILES.slice(seat * 2, seat * 2 + 2))
      .map(tile => ({ type: 'flower', tile, tiles: [tile] })),
  ] as Meld[],
  discards: ['m9', 'p9', 's9', 'east', 'red', 'green'] as TileType[], redCount: 0, drawnTileIndex: -1,
})))
if (inspection) {
  players[0].hand = ['m1','m2','m3','p7','p8','p9','s5','s6','s7','s9','east','red','green','white']
  players.forEach(player => { player.melds = []; player.discards = []; player.isMingLou = false })
  players[1].discards = ['s8', 'm9', 'p9']
  players[1].melds = [{ type: 'peng', tile: 's6', from: 0, tiles: ['s6','s6','s6'] }]
  players[2].isMingLou = true
  players[2].hand = ['m4','m5','m6','p1','p2','p3','p4','p5','p6','s8','s9','east','east']
  players[3].melds = [{ type: 'gang', tile: 'p3', from: 1, added: true, tiles: ['p3','p3','p3','p3'] }]
  gangHeadTile.value = 's7'
}
const props = reactive({
  themeName: theme, players, user: players[0], phase: 'playing' as const,
  wall: Array(64).fill('east') as TileType[], wallHeadDrawn: 0, wallCount: 64,
  currentPlayer: 0, selectedIndex: -1, turnSeconds: 0, lastDiscard: null, actionPrompt: null, announcement: null,
  tableActionEvent: null, scoreFlowEvent: null, result: null, winEffect: null, winPresentation: null,
  revealHands: false, matchFinished: false, winningPlayerIndex: -1, dealer: 0, isUserTurn: true,
  userCanHu: false, matchName: '东风场', roundLabel: '东一局', dealAnimation: { playerIndex: -1, count: 0, serial: 0 },
  openingStage: null, diceValues: [1, 2], diceThrowerIndex: 0, userCurrentWaits: null, userTingOptions: [],
  userDiscardWaits: null, userKongs: [], userHasWindKong: false, rulesetId: 'shandong' as const,
  jokerTiles: [], wildcardTiles: [],
})
const discarded: number[] = []
Object.assign(window, { flowerFixture: {
  reset: () => players.forEach(p => { p.melds = p.melds.filter(m => m.type !== 'flower') }),
  draw: (seat: number, tile: TileType) => players[seat].melds.push({ type: 'flower', tile, tiles: [tile] }),
  setGangHead: (tile: TileType | null) => { gangHeadTile.value = tile },
  setTurn: (turn: boolean) => { props.isUserTurn = turn },
  setLocked: (locked: boolean) => { players[0].isBaoTing = locked },
  setMingLou: (seat: number, enabled: boolean) => { players[seat].isMingLou = enabled },
  discard: (seat: number, tile: TileType) => players[seat].discards.push(tile),
  discarded,
} })
createApp({ setup() { useAudio(); }, render: () => h('main', { class: 'game-app', 'data-table-theme': theme,
  style: themePresentationCssVariables(themePresentationByName(theme)) },
  [h('div', { class: 'has-three-scene' }, [
    h(GameShellHeader, { gameMode: 'local', phase: 'playing', hasPlayers: true,
      matchName: '东风场', roundLabel: '东一局', honba: 0, roomId: '', signalQuality: 3, themeName: theme }),
    h(GameTableHud, { ...props, gangHeadTile: gangHeadTile.value,
      onSelectTile: (index: number) => { props.selectedIndex = index },
      onClearSelection: () => { props.selectedIndex = -1 },
      onDiscard: (index: number) => { if (inspection) { discarded.push(index); players[0].hand.splice(index, 1); props.selectedIndex = -1 } },
    }),
  ])]) }).mount('#app')
