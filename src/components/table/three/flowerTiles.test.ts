import { describe, expect, it } from 'vitest'
import { flowerTilePlacements } from './flowerTiles'
import { FLOWER_TILES } from '../../../game/core/rules/tiles'
import type { Meld } from '../../../game/core/contracts/types'
import { discardTileLayout } from '../../../game/core/presentation/tableLayout'
import { wallStackSlot } from '../../../game/core/rules/wallLayout'

const flowers: Meld[] = FLOWER_TILES.map(tile => ({ type: 'flower', tile, tiles: [tile] }))
describe('separate flower racks', () => {
  it.each([0, 1, 2, 3])('keeps seat %i flowers in draw order and separate from claims', seat => {
    const rack = flowerTilePlacements(seat, [...flowers.slice(0, 3), { type: 'peng', tile: 'm1', tiles: ['m1','m1','m1'] }, ...flowers.slice(3)])
    expect(rack.map(p => p.tile)).toEqual(FLOWER_TILES)
    expect(new Set(rack.map(p => `${p.x}/${p.z}`)).size).toBe(8)
    const overlaps = (a: { x: number; z: number; rotation: number }, b: { x: number; z: number; rotation: number }) => {
      const halfX = (r: number) => Math.abs(Math.cos(r)) * .36 + Math.abs(Math.sin(r)) * .51
      const halfZ = (r: number) => Math.abs(Math.cos(r)) * .51 + Math.abs(Math.sin(r)) * .36
      return Math.abs(a.x-b.x) < halfX(a.rotation)+halfX(b.rotation)-.01 && Math.abs(a.z-b.z) < halfZ(a.rotation)+halfZ(b.rotation)-.01
    }
    for (const flower of rack) {
      for (let wall = 0; wall < 68; wall++) {
        const slot = wallStackSlot(wall)
        expect(overlaps(flower, { ...slot, rotation: slot.rotationY })).toBe(false)
      }
      for (let player = 0; player < 4; player++) for (let discard = 0; discard < 30; discard++) {
        const slot = discardTileLayout(player, discard, 8)
        expect(overlaps(flower, { ...slot, z: slot.z - 1.65 })).toBe(false)
      }
    }
  })
  it('clears the rack when a new round has no flowers', () => {
    expect(flowerTilePlacements(0, [])).toEqual([])
  })
})
