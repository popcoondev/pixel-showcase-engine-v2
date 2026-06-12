import { getAuthInstance } from '../firebase'
import { useStore } from '../store'

/** 認証状態の監視を開始 (App マウント時に1度)。store.cloudUser を更新する。 */
export async function initAuthWatcher() {
  try {
    const auth = await getAuthInstance()
    const { onAuthStateChanged } = await import('firebase/auth')
    onAuthStateChanged(auth, (user) => {
      useStore.getState().setCloudUser(
        user ? { uid: user.uid, name: user.displayName } : null,
      )
    })
  } catch {
    /* Auth 未設定の環境では無視 */
  }
}

/** Google ポップアップでサインイン。 */
export async function signInWithGoogle() {
  const auth = await getAuthInstance()
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth')
  await signInWithPopup(auth, new GoogleAuthProvider())
}

export async function signOutCloud() {
  const auth = await getAuthInstance()
  const { signOut } = await import('firebase/auth')
  await signOut(auth)
}
