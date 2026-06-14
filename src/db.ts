import type { SceneFile } from './types'

const DB_NAME = 'pixel-showcase-engine'
const STORE = 'shows'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

// 旧ローカル Publish (?showcase=slug) の読み込み用。新規公開はクラウド (/s/{id}) に移行済みで、
// loadShow は過去に IndexedDB へ保存された旧リンクの後方互換のためだけに残す。

/** Viewer 用: slug から SceneFile を読み込む。無ければ null */
export async function loadShow(slug: string): Promise<SceneFile | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(slug)
    req.onsuccess = () => {
      db.close()
      resolve((req.result as SceneFile | undefined) ?? null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('IndexedDB read failed'))
    }
  })
}
