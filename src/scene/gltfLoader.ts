import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

/**
 * Draco / meshopt 圧縮に対応した GLTFLoader を共有で1つ持つ。
 * Draco の WASM デコーダは public/draco/ に同梱(静的エクスポートでも自己完結)。
 */
let loader: GLTFLoader | null = null

function getLoader(): GLTFLoader {
  if (loader) return loader
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`)
  loader = new GLTFLoader()
  loader.setDRACOLoader(draco)
  loader.setMeshoptDecoder(MeshoptDecoder)
  return loader
}

/** dataURL / URL から GLTF を読み込む。Draco / meshopt 圧縮も透過的に解凍する。 */
export function loadGltf(url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    getLoader().load(url, resolve, undefined, reject)
  })
}

/** mesh に影を付ける共通処理 */
export function enableShadows(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
}
