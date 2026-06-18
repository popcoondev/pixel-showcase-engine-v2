import type { CameraMotion, LightPulse, ObjectMotion } from './types'

export interface MotionPreset<T> {
  id: string
  label: string
  /** enabled:true を含む、適用するパラメータ一式 */
  apply: Partial<T>
}

/** カメラワーク・プリセット(1クリックでリッチな見回し/寄り引き) */
export const CAMERA_PRESETS: MotionPreset<CameraMotion>[] = [
  { id: 'pan', label: 'ゆっくり見回し', apply: { enabled: true, yawDeg: 18, pitchDeg: 4, dolly: 0, speed: 11, easing: 'easeInOut' } },
  { id: 'turntable', label: 'ターンテーブル風', apply: { enabled: true, yawDeg: 32, pitchDeg: 0, dolly: 0, speed: 13, easing: 'linear' } },
  { id: 'push', label: '寄り引き', apply: { enabled: true, yawDeg: 6, pitchDeg: 0, dolly: 0.22, speed: 9, easing: 'easeInOut' } },
  { id: 'breath', label: '呼吸', apply: { enabled: true, yawDeg: 4, pitchDeg: 3, dolly: 0.06, speed: 7, easing: 'easeInOut' } },
]

/** オブジェクトの動きプリセット */
export const OBJECT_PRESETS: MotionPreset<ObjectMotion>[] = [
  { id: 'float', label: 'ゆらぎ漂い', apply: { enabled: true, moveX: 0.15, moveY: 0.4, moveZ: 0.1, spinY: 0, speed: 6, easing: 'easeInOut' } },
  { id: 'turntable', label: 'ターンテーブル', apply: { enabled: true, moveX: 0, moveY: 0, moveZ: 0, spinY: 45, speed: 8, easing: 'linear' } },
  { id: 'hop', label: 'ホップ', apply: { enabled: true, moveX: 0, moveY: 0.5, moveZ: 0, spinY: 0, speed: 2.4, easing: 'easeOut' } },
  { id: 'spinfloat', label: '回転＋浮遊', apply: { enabled: true, moveX: 0, moveY: 0.3, moveZ: 0, spinY: 30, speed: 7, easing: 'easeInOut' } },
]

/** ライト発光プリセット */
export const LIGHT_PRESETS: MotionPreset<LightPulse>[] = [
  { id: 'neon', label: 'ネオン点滅', apply: { enabled: true, mode: 'blink', min: 0, speed: 0.8 } },
  { id: 'breath', label: 'やわらか呼吸', apply: { enabled: true, mode: 'pulse', min: 0.3, speed: 0.8, easing: 'easeInOut' } },
  { id: 'flicker', label: 'ちらつき', apply: { enabled: true, mode: 'flicker', min: 0.1, speed: 2 } },
  { id: 'slow', label: 'ゆっくり明滅', apply: { enabled: true, mode: 'pulse', min: 0.5, speed: 0.45, easing: 'easeInOut' } },
]

export const EASING_LABELS: Record<string, string> = {
  linear: '一定',
  easeInOut: '溜め(両端)',
  easeIn: '溜め(入り)',
  easeOut: '抜け(出)',
}
