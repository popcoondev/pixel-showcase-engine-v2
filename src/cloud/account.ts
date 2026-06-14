import { getAuthInstance, getFunctionsInstance } from '../firebase'

/**
 * 退会: アカウントと自分のデータを完全削除する (TASK-019, DR-2026-007)。
 * 実体削除は Admin 権限が要るため Cloud Function purgeMyData に委譲する。
 * Function 側で 公開スナップショット + その thumbs + 作業シーン + counter + Auth を削除。
 * 共有アセット assets/{hash} は孤立分を定期 GC (TASK-020) で回収する。
 */
export async function deleteAccount(): Promise<void> {
  const auth = await getAuthInstance()
  if (!auth.currentUser) throw new Error('not-signed-in')
  const functions = await getFunctionsInstance()
  const { httpsCallable } = await import('firebase/functions')
  await httpsCallable(functions, 'purgeMyData')()
  // Auth ユーザーはサーバー側で削除済み → onAuthStateChanged が null を流す
}
