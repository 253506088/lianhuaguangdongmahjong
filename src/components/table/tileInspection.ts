import type { TileType } from '../../game/core/contracts/types'

export interface PublicTileInspection {
  tile: TileType
  source: 'discard' | 'meld' | 'minglou'
  playerIndex: number
}

export interface TileHintAnchor { left: number; right: number; top: number; bottom: number }

/** Only immediate neighbours of the same suit; honours have no neighbours. */
export function adjacentHandTiles(tile: TileType): TileType[] {
  const suited = /^([mps])([1-9])$/.exec(tile)
  if (!suited) return [tile]
  const rank = Number(suited[2])
  return [rank - 1, rank, rank + 1].filter(value => value >= 1 && value <= 9)
    .map(value => `${suited[1]}${value}` as TileType)
}

export function tileHintPosition(anchor: TileHintAnchor, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  const margin = 8
  const above = anchor.top - height - 12
  return {
    left: Math.max(margin, Math.min((anchor.left + anchor.right - width) / 2, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(above >= margin ? above : anchor.bottom + 12, viewportHeight - height - margin)),
  }
}
