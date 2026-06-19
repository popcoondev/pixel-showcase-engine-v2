import { getDb } from '../firebase'
import type { SceneObjectDef } from '../types'
import { requireUid, resolveAssetUrls } from './storage'

export interface LibraryAsset {
  /** Storage の content-hash (= Firestore doc id, assets/{hash}) */
  hash: string
  name: string
  kind: 'glb' | 'image'
  /** ダウンロード URL(配置時はこれをアセット実体として使う) */
  url: string
  /** 画像の幅/高さ(プレートの縦横比) */
  aspect?: number
  /** 配置時の既定スケール(GLB が大きすぎる等の調整) */
  defaultScale?: number
  /** 配置時の既定の色味(material.color) */
  tint?: string
  /** AI 向け: これが何かの説明 */
  description?: string
  /** AI 向け: 分類タグ */
  tags?: string[]
}

/** ユーザーが設定できるメタ(レンダリング既定 + AI 向け情報) */
export interface LibraryAssetPatch {
  defaultScale?: number
  tint?: string
  description?: string
  tags?: string[]
}

interface AssetMeta {
  name: string
  kind: 'glb' | 'image'
  aspect?: number
}

/**
 * scene objects と assetRefs(storeKey→assets/{hash})から storageHash→メタ を導く純関数。
 * GLB は glbAssetId、画像プレートは material.textureAssetId を参照する。
 * 画像は plane の scale から縦横比(aspect = w/h)を導いて持つ。
 */
export function deriveAssetMeta(
  objects: SceneObjectDef[],
  assetRefs: Record<string, string>,
): Record<string, AssetMeta> {
  const hashOf = (storeKey?: string): string | null => {
    if (!storeKey) return null
    const path = assetRefs[storeKey]
    return path ? (path.split('/').pop() ?? null) : null
  }
  const out: Record<string, AssetMeta> = {}
  for (const o of objects) {
    if (o.glbAssetId) {
      const h = hashOf(o.glbAssetId)
      if (h) out[h] = { name: o.name, kind: 'glb' } // GLB 優先
    }
    const tex = o.material?.textureAssetId
    if (tex) {
      const h = hashOf(tex)
      if (h && !out[h]) {
        const sx = o.scale?.[0] ?? 1
        const sy = o.scale?.[1] ?? 1
        out[h] = { name: o.name, kind: 'image', aspect: sy > 0 ? sx / sy : 1 }
      }
    }
  }
  return out
}

/** 保存時: scene のアセットをアカウントのライブラリ(users/{uid}/assets/{hash})に登録する。 */
export async function registerSceneAssets(
  objects: SceneObjectDef[],
  assetRefs: Record<string, string>,
): Promise<void> {
  const meta = deriveAssetMeta(objects, assetRefs)
  const hashes = Object.keys(meta)
  if (hashes.length === 0) return
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  const batch = fs.writeBatch(db)
  for (const h of hashes) {
    // merge: ユーザーが設定した defaultScale/tint/description/tags は上書きしない
    const doc: Record<string, unknown> = {
      name: meta[h].name,
      kind: meta[h].kind,
      storagePath: `assets/${h}`,
      updatedAt: fs.serverTimestamp(),
    }
    if (meta[h].kind === 'image' && typeof meta[h].aspect === 'number') doc.aspect = meta[h].aspect
    batch.set(fs.doc(db, 'users', uid, 'assets', h), doc, { merge: true })
  }
  await batch.commit()
}

/** ライブラリのアセットに、既定スケール/色味/説明/タグを設定する(本人のみ)。 */
export async function updateLibraryAsset(hash: string, patch: LibraryAssetPatch): Promise<void> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  await fs.setDoc(
    fs.doc(db, 'users', uid, 'assets', hash),
    { ...patch, updatedAt: fs.serverTimestamp() },
    { merge: true },
  )
}

/** アカウントのアセットライブラリ一覧(更新が新しい順)。 */
export async function listLibraryAssets(): Promise<LibraryAsset[]> {
  const uid = await requireUid()
  const db = await getDb()
  const fs = await import('firebase/firestore')
  const col = fs.collection(db, 'users', uid, 'assets')
  const snap = await fs.getDocs(fs.query(col, fs.orderBy('updatedAt', 'desc')))
  const refs: Record<string, string> = {}
  for (const d of snap.docs) {
    const data = d.data() as { storagePath?: string }
    refs[d.id] = data.storagePath ?? `assets/${d.id}`
  }
  const urls = await resolveAssetUrls(refs)
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>
    return {
      hash: d.id,
      name: (x.name as string) ?? '(無題)',
      kind: x.kind === 'glb' ? 'glb' : 'image',
      url: urls[d.id],
      aspect: typeof x.aspect === 'number' ? (x.aspect as number) : undefined,
      defaultScale: typeof x.defaultScale === 'number' ? (x.defaultScale as number) : undefined,
      tint: typeof x.tint === 'string' ? (x.tint as string) : undefined,
      description: typeof x.description === 'string' ? (x.description as string) : undefined,
      tags: Array.isArray(x.tags) ? (x.tags as string[]) : undefined,
    }
  })
}
