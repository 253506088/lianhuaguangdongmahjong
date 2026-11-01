import '../../platform/androidCompatibility'
import { AiController } from '../core/controllers/playerController'
import { LotusAiController } from '../variants/lotus/lotusControllers'
import { ShandongAiController } from '../variants/shandong/shandongControllers'
const classic = new AiController({ turn: 0, afterKong: 0, claim: 0 })
const lotus = new LotusAiController({ turn: 0, afterKong: 0, claim: 0 })
const shandong = new ShandongAiController(0)
self.onmessage = async ({ data }) => {
  try {
    const ai = data.rule === 'shandong' ? shandong : data.rule === 'lotus-legacy' ? lotus : classic
    const action = await ai[data.method](data.context)
    self.postMessage({ id: data.id, action })
  } catch (e) { self.postMessage({ id: data.id, error: (e as Error).message }) }
}
