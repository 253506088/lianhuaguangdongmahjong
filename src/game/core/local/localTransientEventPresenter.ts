import type { ScoreDelta, TableActionEvent, TableActionType, TileType } from '../contracts/types'
import type { LocalGameState } from './localGameState'

interface LocalTransientEventPresenterOptions {
  state: LocalGameState
  later(callback: () => void, delay: number): number
  /** 主题表现副作用；不得抛错或阻塞规则推进。 */
  onTableAction?: (event: TableActionEvent) => void
}

export function createLocalTransientEventPresenter(options: LocalTransientEventPresenterOptions) {
  const { state } = options
  let tableActionSequence = 0

  function announce(text: string, tone = 'gold') {
    const id = Date.now()
    state.announcement.value = { text, tone, id }
    options.later(() => {
      if (state.announcement.value?.id === id) state.announcement.value = null
    }, 1500)
    if (typeof window !== 'undefined' && window.setTimeout) {
      window.setTimeout(() => {
        if (state.announcement.value?.id === id) state.announcement.value = null
      }, 1800)
    }
  }

  function showTableAction(
    type: TableActionType,
    actorIndex: number,
    sourceIndex: number | null,
    tile: TileType,
    meldIndex: number,
  ) {
    const event = { id: tableActionSequence += 1, type, actorIndex, sourceIndex, tile, meldIndex }
    state.tableActionEvent.value = event
    try { options.onTableAction?.(event) } catch { /* 表现失败不影响牌局 */ }
    options.later(() => {
      if (state.tableActionEvent.value?.id === event.id) state.tableActionEvent.value = null
    }, 2000)
  }

  function showScoreFlow(deltas: ScoreDelta[]) {
    if (!deltas.length) return
    const event = { id: Date.now(), deltas }
    state.scoreFlowEvent.value = event
    options.later(() => {
      if (state.scoreFlowEvent.value?.id === event.id) state.scoreFlowEvent.value = null
    }, 1050)
  }

  return { announce, showTableAction, showScoreFlow }
}
