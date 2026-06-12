import { getDb } from '../firebase'
import { useStore } from '../store'
import type { SceneFile } from '../types'
import { requireUid, resolveAssetUrls, uploadAssets } from './storage'

export interface CloudSceneMeta {
  id: string
  name: string
  updatedAt: number
}

/**
 * 現在のシーンをクラウドに保存する。
 * - assets は content-hash で Storage に重複排除アップロード
 * - Firestore には assets を除いた純 JSON + assetRefs{key→storagePath} を書く
 */
export async function saveSceneToCloud(name: string): Promise<string> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')

  const state = useStore.getState()
  const file = state.serialize()
  const assetRefs = await uploadAssets(file.assets)
  const { assets: _assets, ...sceneNoAssets } = file

  const existingId = state.cloudSceneId
  const col = fs.collection(db, 'users', uid, 'showcases')
  const docRef = existingId ? fs.doc(col, existingId) : fs.doc(col)

  // TASK-015: 新規作成時のみシーン数カウンタを +1 (削除時に -1)。
  // batch で atomic にし、カウント乖離を防ぐ。Rules は counter < 20 を要求。
  const batch = fs.writeBatch(db)
  batch.set(docRef, {
    name,
    ownerUid: uid,
    scene: sceneNoAssets,
    assetRefs,
    updatedAt: fs.serverTimestamp(),
  })
  if (!existingId) {
    batch.set(fs.doc(db, 'users', uid), { sceneCount: fs.increment(1) }, { merge: true })
  }
  await batch.commit()
  return docRef.id
}

/** 自分のシーン一覧 (更新が新しい順)。 */
export async function listMyScenes(): Promise<CloudSceneMeta[]> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  const col = fs.collection(db, 'users', uid, 'showcases')
  const snap = await fs.getDocs(fs.query(col, fs.orderBy('updatedAt', 'desc')))
  return snap.docs.map((d) => {
    const data = d.data() as { name?: string; updatedAt?: { toMillis?: () => number } }
    return {
      id: d.id,
      name: data.name ?? '(無題)',
      updatedAt: data.updatedAt?.toMillis?.() ?? 0,
    }
  })
}

/** クラウドのシーンを読み込み、store に反映する。assets は Storage のダウンロードURLにする。 */
export async function loadSceneFromCloud(id: string): Promise<void> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')

  const snap = await fs.getDoc(fs.doc(db, 'users', uid, 'showcases', id))
  if (!snap.exists()) throw new Error('not-found')
  const data = snap.data() as {
    name?: string
    scene: Omit<SceneFile, 'assets'>
    assetRefs?: Record<string, string>
    publishedId?: string
  }

  const assets = await resolveAssetUrls(data.assetRefs ?? {})
  const file: SceneFile = { ...data.scene, assets, name: data.name ?? data.scene.name }
  useStore.getState().loadScene(file) // loadScene が cloudSceneId/publishedId を null にリセット
  useStore.getState().setCloudSceneId(id)
  useStore.getState().setPublishedId(data.publishedId ?? null)
}

export async function deleteCloudScene(id: string): Promise<void> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  // TASK-015: 削除と同時にシーン数カウンタを -1 (saveSceneToCloud の +1 と対)。
  const batch = fs.writeBatch(db)
  batch.delete(fs.doc(db, 'users', uid, 'showcases', id))
  batch.set(fs.doc(db, 'users', uid), { sceneCount: fs.increment(-1) }, { merge: true })
  await batch.commit()
}
