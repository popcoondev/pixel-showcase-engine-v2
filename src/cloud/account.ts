import { getAuthInstance, getDb } from '../firebase'

/**
 * アカウントと自分のデータを削除する (クライアント完結部分)。
 * - 作業シーン users/{uid}/showcases/* を削除
 * - 公開スナップショット showcases (ownerId==uid) を削除 → /s/{id} は閲覧不可になる
 * - Auth アカウントを削除
 * Storage の実体 (assets/{hash}, thumbs) は content-hash 共有のため個別削除せず、
 * 管理スクリプト / GC に委譲する (DR-2026-005)。users/{uid} カウンタ doc は
 * sceneCount のみ(PIIなし)のため残置 (GC 対象)。
 */
export async function deleteAccount(): Promise<void> {
  const auth = await getAuthInstance()
  const user = auth.currentUser
  if (!user) throw new Error('not-signed-in')
  const uid = user.uid
  const db = await getDb()
  const fs = await import('firebase/firestore')

  // 1. 作業シーン
  const mine = await fs.getDocs(fs.collection(db, 'users', uid, 'showcases'))
  for (const d of mine.docs) await fs.deleteDoc(d.ref)

  // 2. 公開スナップショット
  const pub = await fs.getDocs(
    fs.query(fs.collection(db, 'showcases'), fs.where('ownerId', '==', uid)),
  )
  for (const d of pub.docs) await fs.deleteDoc(d.ref)

  // 3. Auth アカウント (recent-login が要る場合は呼び出し側で再サインインを促す)
  await user.delete()
}
