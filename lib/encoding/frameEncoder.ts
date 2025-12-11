/**
 * フレームエンコーダー
 * データをフレームに分割し、Reed-Solomonパリティを追加
 */

import { crc8 } from './crc8'
import { rsEncode } from './reedSolomon'

/**
 * フレーム構造
 * 32バンド = 128bit = 16バイト/フレーム
 *
 * [0]     フレームインデックス (8bit)
 * [1]     総フレーム数 (8bit)
 * [2-3]   シーケンスID (16bit)
 * [4-13]  データチャンク (10バイト = 80bit)
 * [14]    チェックサム (CRC-8)
 * [15]    予約/パディング
 */

export const FRAME_HEADER_SIZE = 4 // bytes
export const FRAME_DATA_SIZE = 10 // bytes per frame
export const FRAME_CHECKSUM_SIZE = 1 // byte
export const FRAME_PADDING_SIZE = 1 // byte
export const FRAME_TOTAL_SIZE = 16 // bytes total

// Reed-Solomon設定
export const RS_DATA_RATIO = 0.8 // 80%がデータ、20%がパリティ
export const RS_MIN_PARITY_FRAMES = 4 // 最小パリティフレーム数

export interface AuroraFrame {
  frameIndex: number // 0-255
  totalFrames: number // 1-255
  sequenceId: number // 0-65535
  dataChunk: Uint8Array // 10バイト
  checksum: number // CRC-8
}

export interface EncodedPacket {
  sequenceId: number
  totalFrames: number
  dataFrames: number
  parityFrames: number
  frames: AuroraFrame[]
  originalDataLength: number
}

/**
 * シーケンスIDを生成（ランダムな16bit値）
 */
function generateSequenceId(): number {
  return Math.floor(Math.random() * 0x10000)
}

/**
 * フレームをシリアライズ（16バイトの配列に変換）
 */
export function serializeFrame(frame: AuroraFrame): Uint8Array {
  const result = new Uint8Array(FRAME_TOTAL_SIZE)

  result[0] = frame.frameIndex & 0xff
  result[1] = frame.totalFrames & 0xff
  result[2] = (frame.sequenceId >> 8) & 0xff
  result[3] = frame.sequenceId & 0xff

  // データチャンクをコピー
  for (let i = 0; i < FRAME_DATA_SIZE; i++) {
    result[4 + i] = frame.dataChunk[i] || 0
  }

  result[14] = frame.checksum & 0xff
  result[15] = 0 // パディング

  return result
}

/**
 * シリアライズされたフレームをデシリアライズ
 */
export function deserializeFrame(data: Uint8Array): AuroraFrame {
  const dataChunk = new Uint8Array(FRAME_DATA_SIZE)
  for (let i = 0; i < FRAME_DATA_SIZE; i++) {
    dataChunk[i] = data[4 + i]
  }

  return {
    frameIndex: data[0],
    totalFrames: data[1],
    sequenceId: (data[2] << 8) | data[3],
    dataChunk,
    checksum: data[14],
  }
}

/**
 * フレームのチェックサムを検証
 */
export function verifyFrameChecksum(frame: AuroraFrame): boolean {
  const computed = crc8(frame.dataChunk)
  return computed === frame.checksum
}

/**
 * データをエンコードしてフレームに分割
 * @param input - 入力文字列
 * @returns エンコードされたパケット
 */
export function encodeData(input: string): EncodedPacket {
  // UTF-8エンコード
  const encoder = new TextEncoder()
  const rawBytes = encoder.encode(input)
  const originalDataLength = rawBytes.length

  // 必要なデータフレーム数を計算
  const dataFramesNeeded = Math.ceil(rawBytes.length / FRAME_DATA_SIZE)

  // パリティフレーム数を計算（最低4フレーム、または20%）
  const parityFrames = Math.max(
    RS_MIN_PARITY_FRAMES,
    Math.ceil(dataFramesNeeded * (1 - RS_DATA_RATIO) / RS_DATA_RATIO)
  )

  const totalFrames = dataFramesNeeded + parityFrames

  // データをフレームサイズでパディング
  const paddedLength = dataFramesNeeded * FRAME_DATA_SIZE
  const paddedData = new Uint8Array(paddedLength)
  paddedData.set(rawBytes)

  // Reed-Solomonエンコード（バイト単位で縦方向に）
  // 各バイト位置について、全フレームを横断してRSエンコード
  const encodedColumns: Uint8Array[] = []
  for (let bytePos = 0; bytePos < FRAME_DATA_SIZE; bytePos++) {
    const column = new Uint8Array(dataFramesNeeded)
    for (let frameIdx = 0; frameIdx < dataFramesNeeded; frameIdx++) {
      column[frameIdx] = paddedData[frameIdx * FRAME_DATA_SIZE + bytePos]
    }
    const encodedColumn = rsEncode(column, parityFrames)
    encodedColumns.push(encodedColumn)
  }

  // シーケンスIDを生成
  const sequenceId = generateSequenceId()

  // フレームを構築
  const frames: AuroraFrame[] = []
  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    const dataChunk = new Uint8Array(FRAME_DATA_SIZE)
    for (let bytePos = 0; bytePos < FRAME_DATA_SIZE; bytePos++) {
      dataChunk[bytePos] = encodedColumns[bytePos][frameIdx]
    }

    const frame: AuroraFrame = {
      frameIndex: frameIdx,
      totalFrames,
      sequenceId,
      dataChunk,
      checksum: crc8(dataChunk),
    }
    frames.push(frame)
  }

  return {
    sequenceId,
    totalFrames,
    dataFrames: dataFramesNeeded,
    parityFrames,
    frames,
    originalDataLength,
  }
}

/**
 * パケット情報を取得
 */
export function getPacketInfo(packet: EncodedPacket): {
  totalFrames: number
  dataFrames: number
  parityFrames: number
  bytesPerFrame: number
  totalDataBytes: number
  redundancyPercent: number
} {
  return {
    totalFrames: packet.totalFrames,
    dataFrames: packet.dataFrames,
    parityFrames: packet.parityFrames,
    bytesPerFrame: FRAME_DATA_SIZE,
    totalDataBytes: packet.originalDataLength,
    redundancyPercent: (packet.parityFrames / packet.totalFrames) * 100,
  }
}
