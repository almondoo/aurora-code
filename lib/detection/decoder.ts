/**
 * フレームデコーダー
 * 複数フレームを収集し、Reed-Solomonで欠損を復元してデータを復号
 */

import { AuroraFrame, FRAME_DATA_SIZE } from '../encoding/frameEncoder'
import { rsDecode } from '../encoding/reedSolomon'

export interface DecoderState {
  sequenceId: number | null
  totalFrames: number | null
  dataFrames: number | null
  parityFrames: number | null
  collectedFrames: Map<number, AuroraFrame>
  originalDataLength: number | null
}

export interface DecoderProgress {
  collected: number
  required: number
  total: number
  percentage: number
  canDecode: boolean
}

export interface DecodeResult {
  success: boolean
  data?: string
  error?: string
  stats: {
    totalFrames: number
    collectedFrames: number
    missingFrames: number[]
    recoveredFrames: number
  }
}

/**
 * フレームデコーダークラス
 */
export class FrameDecoder {
  private state: DecoderState = {
    sequenceId: null,
    totalFrames: null,
    dataFrames: null,
    parityFrames: null,
    collectedFrames: new Map(),
    originalDataLength: null,
  }

  /**
   * フレームを追加
   * @returns 追加が成功したかどうか
   */
  addFrame(frame: AuroraFrame): boolean {
    // 最初のフレームの場合、シーケンス情報を設定
    if (this.state.sequenceId === null) {
      this.state.sequenceId = frame.sequenceId
      this.state.totalFrames = frame.totalFrames
      // データフレーム数とパリティフレーム数を推定（80%がデータ）
      this.state.dataFrames = Math.ceil(frame.totalFrames * 0.8)
      this.state.parityFrames = frame.totalFrames - this.state.dataFrames
    }

    // 異なるシーケンスIDの場合はリセット
    if (frame.sequenceId !== this.state.sequenceId) {
      this.reset()
      this.state.sequenceId = frame.sequenceId
      this.state.totalFrames = frame.totalFrames
      this.state.dataFrames = Math.ceil(frame.totalFrames * 0.8)
      this.state.parityFrames = frame.totalFrames - this.state.dataFrames
    }

    // フレームインデックスが有効かチェック
    if (frame.frameIndex < 0 || frame.frameIndex >= (this.state.totalFrames || 0)) {
      return false
    }

    // フレームを保存
    this.state.collectedFrames.set(frame.frameIndex, frame)
    return true
  }

  /**
   * 現在の進捗を取得
   */
  getProgress(): DecoderProgress {
    const total = this.state.totalFrames || 0
    const dataFrames = this.state.dataFrames || 0
    const collected = this.state.collectedFrames.size

    // デコードに必要な最小フレーム数（データフレーム数）
    const required = dataFrames

    return {
      collected,
      required,
      total,
      percentage: total > 0 ? (collected / total) * 100 : 0,
      canDecode: collected >= required,
    }
  }

  /**
   * 収集済みフレームインデックスを取得
   */
  getCollectedIndices(): number[] {
    return Array.from(this.state.collectedFrames.keys()).sort((a, b) => a - b)
  }

  /**
   * 欠損フレームインデックスを取得
   */
  getMissingIndices(): number[] {
    const total = this.state.totalFrames || 0
    const collected = new Set(this.state.collectedFrames.keys())
    const missing: number[] = []

    for (let i = 0; i < total; i++) {
      if (!collected.has(i)) {
        missing.push(i)
      }
    }

    return missing
  }

  /**
   * データをデコード
   */
  decode(): DecodeResult {
    const progress = this.getProgress()

    if (!progress.canDecode) {
      return {
        success: false,
        error: `フレームが不足しています (${progress.collected}/${progress.required})`,
        stats: {
          totalFrames: progress.total,
          collectedFrames: progress.collected,
          missingFrames: this.getMissingIndices(),
          recoveredFrames: 0,
        },
      }
    }

    const totalFrames = this.state.totalFrames!
    const dataFrames = this.state.dataFrames!
    const parityFrames = this.state.parityFrames!

    try {
      // 各バイト位置について、全フレームのデータを収集
      const decodedColumns: Uint8Array[] = []

      for (let bytePos = 0; bytePos < FRAME_DATA_SIZE; bytePos++) {
        // この位置のバイトを全フレームから収集
        const column: (number | null)[] = []

        for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
          const frame = this.state.collectedFrames.get(frameIdx)
          if (frame) {
            column.push(frame.dataChunk[bytePos])
          } else {
            column.push(null) // 欠損
          }
        }

        // Reed-Solomonデコード
        const decoded = rsDecode(column, dataFrames, parityFrames)
        if (!decoded) {
          return {
            success: false,
            error: `バイト位置 ${bytePos} のデコードに失敗しました`,
            stats: {
              totalFrames,
              collectedFrames: progress.collected,
              missingFrames: this.getMissingIndices(),
              recoveredFrames: 0,
            },
          }
        }

        decodedColumns.push(decoded)
      }

      // デコードされたデータを結合
      const totalDataBytes = dataFrames * FRAME_DATA_SIZE
      const decodedData = new Uint8Array(totalDataBytes)

      for (let frameIdx = 0; frameIdx < dataFrames; frameIdx++) {
        for (let bytePos = 0; bytePos < FRAME_DATA_SIZE; bytePos++) {
          decodedData[frameIdx * FRAME_DATA_SIZE + bytePos] =
            decodedColumns[bytePos][frameIdx]
        }
      }

      // UTF-8デコード（パディングを除去）
      const decoder = new TextDecoder()
      let text = decoder.decode(decodedData)

      // NULLパディングを除去
      const nullIndex = text.indexOf('\0')
      if (nullIndex !== -1) {
        text = text.substring(0, nullIndex)
      }

      // 復元されたフレーム数を計算
      const recoveredFrames = this.getMissingIndices().length

      return {
        success: true,
        data: text,
        stats: {
          totalFrames,
          collectedFrames: progress.collected,
          missingFrames: this.getMissingIndices(),
          recoveredFrames,
        },
      }
    } catch (err) {
      return {
        success: false,
        error: `デコードエラー: ${err instanceof Error ? err.message : String(err)}`,
        stats: {
          totalFrames: progress.total,
          collectedFrames: progress.collected,
          missingFrames: this.getMissingIndices(),
          recoveredFrames: 0,
        },
      }
    }
  }

  /**
   * 状態をリセット
   */
  reset(): void {
    this.state = {
      sequenceId: null,
      totalFrames: null,
      dataFrames: null,
      parityFrames: null,
      collectedFrames: new Map(),
      originalDataLength: null,
    }
  }

  /**
   * 現在のシーケンスIDを取得
   */
  getSequenceId(): number | null {
    return this.state.sequenceId
  }

  /**
   * 特定のフレームが収集済みかどうか
   */
  hasFrame(frameIndex: number): boolean {
    return this.state.collectedFrames.has(frameIndex)
  }
}

/**
 * シンプルなデコード関数（インスタンス不要）
 */
export function decodeFromFrames(frames: AuroraFrame[]): DecodeResult {
  const decoder = new FrameDecoder()

  for (const frame of frames) {
    decoder.addFrame(frame)
  }

  return decoder.decode()
}
