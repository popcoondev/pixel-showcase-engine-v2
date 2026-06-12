import { getDb, getStorageInstance } from '../firebase'
import { useStore } from '../store'
import type { SceneFile } from '../types'
import { requireUid, resolveAssetUrls, uploadAssets } from './storage'

/**
 * 現在のシーンを公開スナップショットとして showcases/{id} に保存し、id を返す。
 * - サインイン必須 / Shot が1つ以上必要 (固定画角で見せるため)
 * - active shot のサムネを thumbs/{id}.jpg にアップロード
 * - uid は doc 内 ownerId (ルール用) のみ。URL・表示には出さない
 */
export async function publishToCloud(title: string, author: string): Promise<string> {
  const uid = await requireUid()
  const db = await getDb()
  const storage = await getStorageInstance()
  const fs = await import('firebase/firestore')
  const st = await import('firebase/storage')

  const state = useStore.getState()
  const file = state.serialize()
  if (!file.shots.length) throw new Error('no-shots')

  const assetRefs = await uploadAssets(file.assets)
  const { assets: _assets, ...sceneNoAssets } = file

  const docRef = fs.doc(fs.collection(db, 'showcases'))

  // active shot のサムネをアップロード
  let thumbPath: string | null = null
  const thumb = state.shotThumbnails[file.activeShotId ?? '']
  if (thumb) {
    thumbPath = `thumbs/${docRef.id}.jpg`
    const blob = await fetch(thumb).then((r) => r.blob())
    await st.uploadBytes(st.ref(storage, thumbPath), blob, { contentType: 'image/jpeg' })
  }

  await fs.setDoc(docRef, {
    ownerId: uid,
    ownerName: author || null,
    name: title,
    scene: sceneNoAssets,
    assetRefs,
    thumbPath,
    publishedAt: fs.serverTimestamp(),
    termsAgreedAt: fs.serverTimestamp(),
  })
  return docRef.id
}

/** 公開シーンを読み込む(認証不要の公開 read)。assets は Storage のダウンロードURL。 */
export async function loadPublicShowcase(
  id: string,
): Promise<{ file: SceneFile; author: string | null } | null> {
  const db = await getDb()
  const fs = await import('firebase/firestore')
  const snap = await fs.getDoc(fs.doc(db, 'showcases', id))
  if (!snap.exists()) return null
  const data = snap.data() as {
    name?: string
    ownerName?: string | null
    scene: Omit<SceneFile, 'assets'>
    assetRefs?: Record<string, string>
  }
  const assets = await resolveAssetUrls(data.assetRefs ?? {})
  const file: SceneFile = { ...data.scene, assets, name: data.name ?? data.scene.name }
  return { file, author: data.ownerName ?? null }
}
