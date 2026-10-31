import type { Meld } from '../../../game/core/contracts/types'
import { pointFromSeat } from '../../../game/core/presentation/tableLayout'

/** Separate face-up flower rack in the player's left corner, inside the wall.
 * Four columns by two rows keep all eight flowers away from the meld track,
 * discards and concealed hands. Coordinates use the table's wall center. */
export function flowerTilePlacements(seat: number, melds: readonly Meld[]) {
  return melds.filter(meld => meld.type === 'flower').slice(0, 8).map((meld, index) => {
    const point = pointFromSeat(seat, -5.6 + (index % 4) * .72, 4.1 + Math.floor(index / 4) * 1.04)
    return { tile: meld.tile, x: point.x, z: point.z - 1.65, y: .28, rotation: seat * Math.PI / 2 }
  })
}
