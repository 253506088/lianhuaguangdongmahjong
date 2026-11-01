import '../../platform/androidCompatibility'
import { createNearbyBloodRuntime } from './bloodRuntime'
const run = createNearbyBloodRuntime()
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, result: run(data) }) }
  catch (e) { self.postMessage({ id: data.id, error: (e as Error).message }) }
}
