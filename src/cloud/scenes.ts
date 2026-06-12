import { getAuthInstance, getDb, getStorageInstance } from '../firebase'
import { hashDataUrl, useStore } from '../store'
import type { SceneFile } from '../types'

export interface CloudSceneMeta {
  id: string
  name: string
  updatedAt: number
}

async function requireUid(): Promise<string> {
  const auth = await getAuthInstance()
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('not-signed-in')
  return uid
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then((r) => r.blob())
}

/**
 * 現在のシーンをクラウドに保存する。
 * - assets (dataURL) は content-hash パス assets/{hash} に Storage アップロード (既存はスキップ)
 * - Firestore には assets を除いた純 JSON + assetRefs{key→storagePath} を書く
 */
export async function saveSceneToCloud(name: string): Promise<string> {
  const uid = await requireUid()
  const db = await getDb()
  const storage = await getStorageInstance()
  const fs = await import('firebase/firestore')
  const st = await import('firebase/storage')

  const state = useStore.getState()
  const file = state.serialize()

  // 1. アセット実体を Storage へ (content-hash で重複排除)
  const assetRefs: Record<string, string> = {}
  for (const [key, dataUrl] of Object.entries(file.assets)) {
    const hash = await hashDataUrl(dataUrl)
    const path = `assets/${hash}`
    const ref = st.ref(storage, path)
    try {
      await st.getMetadata(ref) // 既にあればアップロードしない
    } catch {
      const blob = await dataUrlToBlob(dataUrl)
      await st.uploadBytes(ref, blob, { contentType: blob.type || 'application/octet-stream' })
    }
    assetRefs[key] = path
  }

  // 2. assets を除いたシーン本体
  const { assets: _assets, ...sceneNoAssets } = file

  // 3. Firestore へ (作業コピー)
  const existingId = state.cloudSceneId
  const col = fs.collection(db, 'users', uid, 'showcases')
  const docRef = existingId ? fs.doc(col, existingId) : fs.doc(col)
  await fs.setDoc(docRef, {
    name,
    ownerUid: uid,
    scene: sceneNoAssets,
    assetRefs,
    updatedAt: fs.serverTimestamp(),
  })
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
  const storage = await getStorageInstance()
  const fs = await import('firebase/firestore')
  const st = await import('firebase/storage')

  const snap = await fs.getDoc(fs.doc(db, 'users', uid, 'showcases', id))
  if (!snap.exists()) throw new Error('not-found')
  const data = snap.data() as {
    name?: string
    scene: Omit<SceneFile, 'assets'>
    assetRefs?: Record<string, string>
  }

  // assetRefs (key→storagePath) を key→downloadURL に解決
  const assets: Record<string, string> = {}
  for (const [key, path] of Object.entries(data.assetRefs ?? {})) {
    assets[key] = await st.getDownloadURL(st.ref(storage, path))
  }

  const file: SceneFile = { ...data.scene, assets, name: data.name ?? data.scene.name }
  useStore.getState().loadScene(file)
  useStore.getState().setCloudSceneId(id)
}

export async function deleteCloudScene(id: string): Promise<void> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  await fs.deleteDoc(fs.doc(db, 'users', uid, 'showcases', id))
}
