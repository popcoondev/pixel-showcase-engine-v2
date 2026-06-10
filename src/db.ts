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

/** Publish 用: slug をキーに SceneFile を保存する */
export async function saveShow(slug: string, file: SceneFile): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(file, slug)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB write failed'))
    }
  })
}

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
