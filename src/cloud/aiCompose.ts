import { getFunctionsInstance } from '../firebase'

export interface CreateSceneOptions {
  /** 保存名(既定: AI 生成シーン) */
  name?: string
  /** GLB に軽いターンテーブル回転を付ける */
  turntable?: boolean
  /** 使うアセットの hash を限定(省略=ライブラリ全件) */
  assetHashes?: string[]
}

export interface CreateSceneResult {
  ok: boolean
  sceneId: string
  objectCount: number
}

/**
 * 外部AI/エージェント・またはUIから、アカウントのアセットで新シーンを
 * サーバ側生成・保存する(Cloud Function createSceneFromAssets / DR-2026-008)。
 * 呼び出しには Firebase 認証(ID トークン)が要る。公開はしない(作業コピー止まり)。
 */
export async function createSceneFromAssets(opts: CreateSceneOptions = {}): Promise<CreateSceneResult> {
  const functions = await getFunctionsInstance()
  const { httpsCallable } = await import('firebase/functions')
  const res = await httpsCallable(functions, 'createSceneFromAssets')(opts)
  return res.data as CreateSceneResult
}
