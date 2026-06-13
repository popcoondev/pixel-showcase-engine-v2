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
export async function publishToCloud(
  title: string,
  author: string,
  existingId?: string | null,
): Promise<string> {
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

  // existingId があれば同じ公開ドキュメント (= 同じ /s/{id}) を上書き更新
  const col = fs.collection(db, 'showcases')
  const docRef = existingId ? fs.doc(col, existingId) : fs.doc(col)

  // active shot のサムネをアップロード。OG画像用に download URL も保存する。
  let thumbPath: string | null = null
  let thumbUrl: string | null = null
  const thumb = state.shotThumbnails[file.activeShotId ?? '']
  if (thumb) {
    thumbPath = `thumbs/${docRef.id}.jpg`
    const thumbRef = st.ref(storage, thumbPath)
    const blob = await fetch(thumb).then((r) => r.blob())
    await st.uploadBytes(thumbRef, blob, { contentType: 'image/jpeg' })
    thumbUrl = await st.getDownloadURL(thumbRef)
  }

  await fs.setDoc(docRef, {
    ownerId: uid,
    ownerName: author || null,
    name: title,
    scene: sceneNoAssets,
    assetRefs,
    thumbPath,
    thumbUrl,
    publishedAt: fs.serverTimestamp(),
    termsAgreedAt: fs.serverTimestamp(),
  })

  // クラウド保存済みのシーンには公開先リンクを記録 (次セッションでも上書き更新できる)
  const cloudSceneId = state.cloudSceneId
  if (cloudSceneId) {
    try {
      await fs.setDoc(
        fs.doc(db, 'users', uid, 'showcases', cloudSceneId),
        { publishedId: docRef.id },
        { merge: true },
      )
    } catch {
      /* リンク記録の失敗は致命的でない */
    }
  }
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
