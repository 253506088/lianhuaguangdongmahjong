import { expect, it } from 'vitest'
import * as THREE from 'three'
import { createTileInstanceRenderer } from './tileInstanceRenderer'

it('picks the nearest real tile body, including backs, after animations and instance reuse', () => {
  const scene = new THREE.Scene()
  const geometry = new THREE.BoxGeometry(1, .3, 1)
  const material = new THREE.MeshBasicMaterial()
  Object.assign(scene.userData, { tileBaseGeometry: geometry, tileCapGeometry: geometry,
    faceSide: material, backMaterial: material, tileSide: material, tileBottom: material })
  const resources: { dispose?: () => void }[] = []
  const renderer = createTileInstanceRenderer({ scene, dynamicGroups: [], ownDynamic: resource => { resources.push(resource); return resource },
    getAtlasMaterial: () => material, getAtlasCapGeometry: () => geometry.clone(), atlasCellUvFor: () => ({ u: 0, v: 0 }) })
  const ray = (x: number) => new THREE.Raycaster(new THREE.Vector3(x, 10, 0), new THREE.Vector3(0, -1, 0))
  renderer.begin()
  const face = renderer.add(new THREE.Vector3(), new THREE.Quaternion(), 's7')
  const back = renderer.add(new THREE.Vector3(0, 2, 0), new THREE.Quaternion(), null)
  renderer.finish()
  expect(renderer.pick(ray(0))).toBe(back.baseIndex)
  renderer.set(back.baseIndex, back.capMesh, back.capIndex, new THREE.Vector3(20, 2, 0), new THREE.Quaternion(), 1)
  expect(renderer.pick(ray(0))).toBe(face.baseIndex)
  expect(renderer.pick(ray(20))).toBe(back.baseIndex)
  expect(renderer.pick(ray(10))).toBeNull()
  renderer.begin(true)
  renderer.add(new THREE.Vector3(30, 0, 0), new THREE.Quaternion(), 'p9')
  renderer.finish()
  expect(renderer.pick(ray(20))).toBeNull()
  expect(renderer.pick(ray(30))).toBe(0)
  resources.forEach(resource => resource.dispose?.())
  geometry.dispose(); material.dispose()
})
