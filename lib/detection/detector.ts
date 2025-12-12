/**
 * 画像検出アルゴリズム
 * カメラ画像からオーロラバンドの色を検出し、パレットインデックスに変換
 */

import {
  findClosestPaletteIndex,
  colorConfidence,
  RGBColor,
  AURORA_PALETTE,
} from '../visual/colorPalette'
import { bandIndicesToBytes, NUM_BANDS } from '../visual/bandEncoder'
import { deserializeFrame, verifyFrameChecksum, AuroraFrame } from '../encoding/frameEncoder'

export interface DetectionResult {
  success: boolean
  frame?: AuroraFrame
  confidence: number
  bandIndices?: number[]
  debugInfo?: {
    auroraRegion: { top: number; bottom: number } | null
    bandColors: RGBColor[]
    bandConfidences: number[]
  }
}

export interface AuroraRegion {
  top: number
  bottom: number
  leftBound: number
  rightBound: number
}

/**
 * オーロラ領域を検出
 * 画像内でオーロラらしい色（緑-シアン-紫系）が集中している領域を特定
 */
export function findAuroraRegion(imageData: ImageData): AuroraRegion | null {
  const { width, height, data } = imageData

  // 各行の「オーロラらしさ」スコアを計算
  const rowScores: number[] = new Array(height).fill(0)
  const colScores: number[] = new Array(width).fill(0)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]

      // オーロラ色検出: 緑-シアン-紫系（閾値を緩和）
      // 緑系: G > R かつ G > 30
      // シアン系: G > R かつ B > R かつ (G + B) > 80
      // 紫系: B > R かつ (R + B) > 80
      const isGreenish = g > r * 1.1 && g > 30
      const isCyanish = g > r * 0.9 && b > r * 0.6 && (g + b) > 80
      const isPurplish = b > r * 0.6 && r > g * 0.4 && (r + b) > 80

      if (isGreenish || isCyanish || isPurplish) {
        const brightness = (r + g + b) / 3
        const score = brightness > 30 ? 1 : 0
        rowScores[y] += score
        colScores[x] += score
      }
    }
  }

  // 行スコアを正規化
  const maxRowScore = Math.max(...rowScores)
  if (maxRowScore < width * 0.1) {
    return null // オーロラ領域が見つからない
  }

  // オーロラ領域の上下を検出
  let top = 0
  let bottom = height - 1

  // 上から見てスコアが閾値を超える最初の行
  const threshold = maxRowScore * 0.3
  for (let y = 0; y < height; y++) {
    if (rowScores[y] > threshold) {
      top = y
      break
    }
  }

  // 下から見てスコアが閾値を超える最後の行
  for (let y = height - 1; y >= 0; y--) {
    if (rowScores[y] > threshold) {
      bottom = y
      break
    }
  }

  // 左右の境界を検出
  const maxColScore = Math.max(...colScores)
  const colThreshold = maxColScore * 0.2
  let leftBound = 0
  let rightBound = width - 1

  for (let x = 0; x < width; x++) {
    if (colScores[x] > colThreshold) {
      leftBound = x
      break
    }
  }

  for (let x = width - 1; x >= 0; x--) {
    if (colScores[x] > colThreshold) {
      rightBound = x
      break
    }
  }

  // 領域が小さすぎる場合は無効（閾値を緩和: 0.1→0.05, 0.5→0.3）
  if (bottom - top < height * 0.05 || rightBound - leftBound < width * 0.3) {
    return null
  }

  return { top, bottom, leftBound, rightBound }
}

/**
 * 各バンドの代表色を抽出
 */
export function extractBandColors(
  imageData: ImageData,
  region: AuroraRegion
): RGBColor[] {
  const { width, data } = imageData
  const { top, bottom, leftBound, rightBound } = region

  const regionWidth = rightBound - leftBound
  const bandWidth = regionWidth / NUM_BANDS
  const colors: RGBColor[] = []

  for (let band = 0; band < NUM_BANDS; band++) {
    const startX = Math.floor(leftBound + band * bandWidth)
    const endX = Math.floor(leftBound + (band + 1) * bandWidth)

    // バンド内の明るいピクセルを収集
    const pixels: { r: number; g: number; b: number; brightness: number }[] = []

    for (let y = top; y < bottom; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * width + x) * 4
        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        const brightness = r + g + b

        // 暗すぎるピクセルは除外（閾値を緩和: 60 → 30）
        if (brightness > 30) {
          pixels.push({ r, g, b, brightness })
        }
      }
    }

    if (pixels.length === 0) {
      // ピクセルがない場合はデフォルト色
      colors.push({ r: 0, g: 0, b: 0 })
      continue
    }

    // 明るさでソートして上位25%の平均を取る
    pixels.sort((a, b) => b.brightness - a.brightness)
    const topCount = Math.max(1, Math.floor(pixels.length * 0.25))
    const topPixels = pixels.slice(0, topCount)

    const avgR = Math.round(topPixels.reduce((s, p) => s + p.r, 0) / topCount)
    const avgG = Math.round(topPixels.reduce((s, p) => s + p.g, 0) / topCount)
    const avgB = Math.round(topPixels.reduce((s, p) => s + p.b, 0) / topCount)

    colors.push({ r: avgR, g: avgG, b: avgB })
  }

  return colors
}

/**
 * バンド色をパレットインデックスに変換
 */
export function matchBandsToPalette(bandColors: RGBColor[]): {
  indices: number[]
  confidences: number[]
} {
  const indices: number[] = []
  const confidences: number[] = []

  for (const color of bandColors) {
    const index = findClosestPaletteIndex(color)
    const conf = colorConfidence(color)
    indices.push(index)
    confidences.push(conf)
  }

  return { indices, confidences }
}

/**
 * 画像からフレームを検出
 */
export function detectFrame(imageData: ImageData): DetectionResult {
  // 1. オーロラ領域を検出
  const region = findAuroraRegion(imageData)
  if (!region) {
    return {
      success: false,
      confidence: 0,
      debugInfo: {
        auroraRegion: null,
        bandColors: [],
        bandConfidences: [],
      },
    }
  }

  // 2. バンド色を抽出
  const bandColors = extractBandColors(imageData, region)

  // 3. パレットマッチング
  const { indices, confidences } = matchBandsToPalette(bandColors)

  // 4. 平均信頼度を計算
  const avgConfidence =
    confidences.reduce((s, c) => s + c, 0) / confidences.length

  // 信頼度が低すぎる場合は失敗（閾値を緩和: 0.3 → 0.15）
  if (avgConfidence < 0.15) {
    return {
      success: false,
      confidence: avgConfidence,
      bandIndices: indices,
      debugInfo: {
        auroraRegion: region,
        bandColors,
        bandConfidences: confidences,
      },
    }
  }

  // 5. バンドインデックスからフレームデータを復元
  const frameBytes = bandIndicesToBytes(indices)
  const frame = deserializeFrame(frameBytes)

  // 6. チェックサム検証
  const checksumValid = verifyFrameChecksum(frame)

  return {
    success: checksumValid,
    frame: checksumValid ? frame : undefined,
    confidence: avgConfidence,
    bandIndices: indices,
    debugInfo: {
      auroraRegion: region,
      bandColors,
      bandConfidences: confidences,
    },
  }
}

/**
 * 検出結果のサマリーを取得
 */
export function getDetectionSummary(result: DetectionResult): string {
  if (!result.success) {
    if (!result.debugInfo?.auroraRegion) {
      return 'オーロラ領域が検出されませんでした'
    }
    if (result.confidence < 0.3) {
      return `色の信頼度が低いです (${(result.confidence * 100).toFixed(1)}%)`
    }
    return 'チェックサム検証に失敗しました'
  }

  const frame = result.frame!
  return `フレーム ${frame.frameIndex + 1}/${frame.totalFrames} を検出 (信頼度: ${(result.confidence * 100).toFixed(1)}%)`
}
