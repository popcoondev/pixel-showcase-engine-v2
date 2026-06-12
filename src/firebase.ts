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

// すべて dynamic import 経由。クラウド機能を使う瞬間まで SDK を読み込まない
// (メインバンドルを太らせない)。
let appPromise: Promise<FirebaseApp> | null = null
function getApp(): Promise<FirebaseApp> {
  if (!appPromise) {
    appPromise = import('firebase/app').then((m) => m.initializeApp(firebaseConfig))
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
