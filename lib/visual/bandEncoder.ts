/**
 * バンドエンコーダー
 * フレームデータを32バンドの視覚データに変換
 */

import { AuroraFrame, serializeFrame, FRAME_TOTAL_SIZE } from '../encoding/frameEncoder'
import { byteToPaletteIndices, getPaletteColorNormalized, NormalizedRGBColor } from './colorPalette'

// 32バンド = 16バイト × 2ニブル/バイト
export const NUM_BANDS = 32

export interface VisualFrame {
  bandIndices: number[] // 32個のパレットインデックス (0-15)
  frameIndex: number
  totalFrames: number
  isSyncFrame: boolean // フレーム0は同期フレーム
}

export interface BandColors {
  colors: NormalizedRGBColor[] // 32個のRGB色
  frameIndex: number
  totalFrames: number
}

/**
 * フレームをビジュアルフレームに変換
 * 16バイトを32個の4bitパレットインデックスにマッピング
 */
export function frameToVisual(frame: AuroraFrame): VisualFrame {
  const serialized = serializeFrame(frame)
  const bandIndices: number[] = []

  // 各バイトを2つのパレットインデックス (4bit × 2) に分割
  for (let i = 0; i < FRAME_TOTAL_SIZE; i++) {
    const [high, low] = byteToPaletteIndices(serialized[i])
    bandIndices.push(high)
    bandIndices.push(low)
  }

  return {
    bandIndices,
    frameIndex: frame.frameIndex,
    totalFrames: frame.totalFrames,
    isSyncFrame: frame.frameIndex === 0,
  }
}

/**
 * ビジュアルフレームをバンドカラーに変換
 */
export function visualToBandColors(visual: VisualFrame): BandColors {
  const colors: NormalizedRGBColor[] = visual.bandIndices.map((index) =>
    getPaletteColorNormalized(index)
  )

  return {
    colors,
    frameIndex: visual.frameIndex,
    totalFrames: visual.totalFrames,
  }
}

/**
 * シェーダー用のuniform配列を生成
 * フラットな配列: [r0, g0, b0, r1, g1, b1, ...]
 */
export function bandColorsToUniform(bandColors: BandColors): Float32Array {
  const result = new Float32Array(NUM_BANDS * 3)
  for (let i = 0; i < NUM_BANDS; i++) {
    const color = bandColors.colors[i]
    result[i * 3] = color.r
    result[i * 3 + 1] = color.g
    result[i * 3 + 2] = color.b
  }
  return result
}

/**
 * シェーダー用のパレットインデックス配列を生成
 * 0-15の値を0.0-1.0に正規化
 */
export function bandIndicesToUniform(visual: VisualFrame): Float32Array {
  const result = new Float32Array(NUM_BANDS)
  for (let i = 0; i < NUM_BANDS; i++) {
    // パレットインデックス (0-15) を 0.0-1.0 に正規化
    result[i] = visual.bandIndices[i] / 15.0
  }
  return result
}

/**
 * 複数フレームのビジュアルデータを生成
 */
export function framesToVisuals(frames: AuroraFrame[]): VisualFrame[] {
  return frames.map(frameToVisual)
}

/**
 * フレームアニメーション用のデータを生成
 * @param frames - 全フレーム
 * @param fps - フレームレート
 * @returns アニメーション制御データ
 */
export function createAnimationData(
  frames: AuroraFrame[],
  fps: number = 2
): {
  visuals: VisualFrame[]
  frameDuration: number // ms
  totalDuration: number // ms
} {
  const visuals = framesToVisuals(frames)
  const frameDuration = 1000 / fps
  const totalDuration = frameDuration * frames.length

  return {
    visuals,
    frameDuration,
    totalDuration,
  }
}

/**
 * バンドインデックスからバイト配列を復元
 * @param bandIndices - 32個のパレットインデックス
 * @returns 16バイトの配列
 */
export function bandIndicesToBytes(bandIndices: number[]): Uint8Array {
  const result = new Uint8Array(FRAME_TOTAL_SIZE)
  for (let i = 0; i < FRAME_TOTAL_SIZE; i++) {
    const high = bandIndices[i * 2] & 0x0f
    const low = bandIndices[i * 2 + 1] & 0x0f
    result[i] = (high << 4) | low
  }
  return result
}
