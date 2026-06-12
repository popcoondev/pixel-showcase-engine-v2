import type { FirebaseApp } from 'firebase/app'
import type { Auth } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore'
import type { FirebaseStorage } from 'firebase/storage'

// Firebase web config は公開情報 (secret ではない)。アクセス制御は
// Security Rules + App Check で行う。Analytics は PII/不要のため初期化しない。
const firebaseConfig = {
  apiKey: 'AIzaSyDzsAv1PTkD7KKJFJOC74HrmudXKUbE1Ww',
  authDomain: 'pixelshowcase-7bc44.firebaseapp.com',
  projectId: 'pixelshowcase-7bc44',
  storageBucket: 'pixelshowcase-7bc44.firebasestorage.app',
  messagingSenderId: '498699227586',
  appId: '1:498699227586:web:d5e0620f5dd5fc9687865b',
}

// App Check の reCAPTCHA Enterprise site key (公開情報)。空の間は App Check 無効。
// Google Cloud で reCAPTCHA Enterprise の Website キーを作成し、その Key ID を入れる。
const APP_CHECK_SITE_KEY = '6LcKORstAAAAAPEBV01Cp9aPo7ugGB30oVKUSQ_3'

// すべて dynamic import 経由。クラウド機能を使う瞬間まで SDK を読み込まない
// (メインバンドルを太らせない)。
let appPromise: Promise<FirebaseApp> | null = null
function getApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = import('firebase/app').then(async (m) => {
      const app = m.initializeApp(firebaseConfig)
      // App Check: site key が設定されていれば有効化 (curl 等での Rules 迂回を防ぐ)
      if (APP_CHECK_SITE_KEY) {
        const ac = await import('firebase/app-check')
        ac.initializeAppCheck(app, {
          provider: new ac.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        })
      }
      return app
    })
  }
  return appPromise
}

let authPromise: Promise<Auth> | null = null
export function getAuthInstance(): Promise<Auth> {
  if (!authPromise) {
    authPromise = Promise.all([getApp(), import('firebase/auth')]).then(([app, m]) =>
      m.getAuth(app),
    )
  }
  return authPromise
}

let dbPromise: Promise<Firestore> | null = null
export function getDb(): Promise<Firestore> {
  if (!dbPromise) {
    dbPromise = Promise.all([getApp(), import('firebase/firestore')]).then(([app, m]) =>
      m.getFirestore(app),
    )
  }
  return dbPromise
}

let storagePromise: Promise<FirebaseStorage> | null = null
export function getStorageInstance(): Promise<FirebaseStorage> {
  if (!storagePromise) {
    storagePromise = Promise.all([getApp(), import('firebase/storage')]).then(([app, m]) =>
      m.getStorage(app),
    )
  }
  return storagePromise
}
