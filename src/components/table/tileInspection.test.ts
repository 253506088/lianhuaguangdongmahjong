import { describe, expect, it } from 'vitest'
import { adjacentHandTiles, tileHintPosition } from './tileInspection'
import { computeUnseenTileCount } from '../../game/variants/shandong/shandongRules'
import { HONORS, SUITS } from '../../game/core/rules/tiles'
import type { Meld, TileType } from '../../game/core/contracts/types'

describe('tile inspection from the local player perspective', () => {
  it.each(SUITS)('shows only immediate %s neighbours without wrapping 1 or 9', suit => {
    expect(adjacentHandTiles(`${suit}7`)).toEqual([`${suit}6`, `${suit}7`, `${suit}8`])
    expect(adjacentHandTiles(`${suit}1`)).toEqual([`${suit}1`, `${suit}2`])
    expect(adjacentHandTiles(`${suit}9`)).toEqual([`${suit}8`, `${suit}9`])
  })
  it.each(HONORS)('shows only %s for an honour', tile => {
    expect(adjacentHandTiles(tile)).toEqual([tile])
  })
  it('deducts each visible physical tile once, without reading hidden hands or double counting the local minglou hand', () => {
    const userHand: TileType[] = ['s7', 's6', 'm1', 'red']
    const players = [
      { seat: 2, hand: userHand, isMingLou: true, discards: ['m1'] as TileType[], melds: [{ type: 'peng', tile: 'p2', tiles: ['p2','p2','p2'] }] as Meld[] },
      { seat: 3, hand: ['s8','s8','s8','s7'] as TileType[], discards: ['s8'] as TileType[], melds: [{ type: 'peng', tile: 's6', tiles: ['s6','s6','s6'] }] as Meld[] },
      { seat: 0, hand: ['s8','m1'] as TileType[], isMingLou: true, discards: [] as TileType[], melds: [] as Meld[] },
      { seat: 1, hand: ['red'] as TileType[], discards: [] as TileType[], melds: [{ type: 'gang', added: true, tile: 'p3', tiles: ['p3','p3','p3','p3'] }] as Meld[] },
    ]
    const count = (tile: TileType) => computeUnseenTileCount(tile, userHand, players, 2, 's7')
    expect(adjacentHandTiles('s7').map(count)).toEqual([0, 2, 2])
    expect(count('m1')).toBe(1)
    expect(count('p2')).toBe(1)
    expect(count('p3')).toBe(0)
    expect(count('red')).toBe(3)
    expect(count('white')).toBe(4)
    players[2].hand.push('s8')
    expect(count('s8')).toBe(1)
    players[1].discards.push('s8', 's8')
    expect(count('s8')).toBe(0)
  })
  it('keeps the hint on screen at both hand edges and below a top-row tile', () => {
    expect(tileHintPosition({ left: 0, right: 30, top: 260, bottom: 310 }, 244, 76, 568, 320)).toEqual({ left: 8, top: 172 })
    expect(tileHintPosition({ left: 540, right: 568, top: 260, bottom: 310 }, 244, 76, 568, 320)).toEqual({ left: 316, top: 172 })
    expect(tileHintPosition({ left: 250, right: 280, top: 5, bottom: 30 }, 244, 76, 568, 320)).toEqual({ left: 143, top: 42 })
  })
})
