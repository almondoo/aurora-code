'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { encodeData, EncodedPacket, AuroraFrame } from '../lib/encoding/frameEncoder'
import { frameToVisual, bandIndicesToUniform, VisualFrame } from '../lib/visual/bandEncoder'
import { detectFrame } from '../lib/detection/detector'
import { FrameDecoder, DecoderProgress } from '../lib/detection/decoder'

// ============================================
// シェーダーソース
// ============================================

const vertexShaderSource = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const fragmentShaderSource = `
  precision highp float;

  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_bandData[32];
  uniform float u_frameIndex;
  uniform float u_isSyncFrame;

  // 16色オーロラパレット
  vec3 getPaletteColor(int idx) {
    if (idx == 0) return vec3(0.078, 0.235, 0.157);
    if (idx == 1) return vec3(0.118, 0.353, 0.196);
    if (idx == 2) return vec3(0.157, 0.471, 0.235);
    if (idx == 3) return vec3(0.196, 0.588, 0.275);
    if (idx == 4) return vec3(0.157, 0.627, 0.471);
    if (idx == 5) return vec3(0.196, 0.706, 0.588);
    if (idx == 6) return vec3(0.235, 0.784, 0.706);
    if (idx == 7) return vec3(0.314, 0.863, 0.784);
    if (idx == 8) return vec3(0.314, 0.549, 0.784);
    if (idx == 9) return vec3(0.392, 0.471, 0.784);
    if (idx == 10) return vec3(0.510, 0.392, 0.784);
    if (idx == 11) return vec3(0.627, 0.353, 0.784);
    if (idx == 12) return vec3(0.706, 0.392, 0.706);
    if (idx == 13) return vec3(0.784, 0.431, 0.627);
    if (idx == 14) return vec3(0.863, 0.510, 0.588);
    return vec3(0.941, 0.627, 0.627);
  }

  // パレット色を補間で取得（グラデーション用）
  vec3 getPaletteColorSmooth(float idx) {
    int i0 = int(floor(idx));
    int i1 = int(ceil(idx));
    float t = fract(idx);
    return mix(getPaletteColor(i0), getPaletteColor(i1), t);
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // フラクタルブラウン運動（より自然な揺らぎ）
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  float mountains(float x) {
    float mountain = 0.0;
    mountain = max(mountain, sin(x * 1.2 + 0.5) * 0.08 + sin(x * 2.5 + 1.0) * 0.04 + 0.12);
    mountain = max(mountain, sin(x * 1.8 + 2.0) * 0.1 + sin(x * 3.2 + 0.3) * 0.05 + 0.08);
    mountain = max(mountain, sin(x * 2.5 + 1.5) * 0.12 + sin(x * 4.0 + 2.5) * 0.04 + noise(vec2(x * 10.0, 0.0)) * 0.02 + 0.05);
    return mountain;
  }

  float stars(vec2 uv) {
    float star = 0.0;
    for (int i = 0; i < 3; i++) {
      vec2 grid = uv * (50.0 + float(i) * 30.0);
      vec2 id = floor(grid);
      vec2 gv = fract(grid) - 0.5;
      float n = hash(id + float(i) * 100.0);
      if (n > 0.97) {
        float size = (n - 0.97) * 30.0;
        float twinkle = sin(u_time * (2.0 + n * 3.0) + n * 100.0) * 0.5 + 0.5;
        float d = length(gv);
        star += smoothstep(0.1 * size, 0.0, d) * twinkle * 0.8;
      }
    }
    return star;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // 夜空の背景（より深い青）
    vec3 nightTop = vec3(0.01, 0.02, 0.06);
    vec3 nightBottom = vec3(0.005, 0.01, 0.02);
    vec3 color = mix(nightBottom, nightTop, uv.y);

    // 星
    float starBrightness = stars(uv);
    color += vec3(starBrightness) * vec3(0.9, 0.95, 1.0);

    // グローバルな水平方向の揺らぎ
    float globalWave = sin(u_time * 0.3) * 0.02 + fbm(vec2(u_time * 0.1, 0.0)) * 0.01;

    // オーロラの全体的な動き（ゆっくりとした流れ）
    float flowOffset = u_time * 0.05;

    // 32バンドのオーロラ描画
    float bandWidth = 1.0 / 32.0;

    for (int band = 0; band < 32; band++) {
      // 水平方向の揺らぎ（カーテンが横に揺れる効果）
      float bandPhase = float(band) * 0.15;
      float horizontalWave = sin(uv.y * 3.0 + u_time * 0.6 + bandPhase) * 0.015;
      horizontalWave += sin(uv.y * 7.0 - u_time * 0.4 + bandPhase * 2.0) * 0.008;
      horizontalWave += fbm(vec2(float(band) * 0.3, uv.y * 2.0 + u_time * 0.2)) * 0.01;

      float bandX = float(band) * bandWidth + horizontalWave + globalWave;
      float bandCenter = bandX + bandWidth * 0.5;

      // バンド内の位置（拡張範囲でブレンド）
      float localX = (uv.x - bandX) / bandWidth;

      // パレットインデックスを取得 (0-15)
      float paletteValue = u_bandData[band] * 15.0;
      int paletteIdx = int(paletteValue + 0.5);
      vec3 bandColor = getPaletteColor(paletteIdx);

      // 隣接バンドとの色ブレンド（自然なグラデーション）
      if (band < 31) {
        float nextPaletteValue = u_bandData[band + 1] * 15.0;
        vec3 nextColor = getPaletteColor(int(nextPaletteValue + 0.5));
        float blendT = smoothstep(0.6, 1.0, localX);
        bandColor = mix(bandColor, nextColor, blendT * 0.5);
      }
      if (band > 0) {
        float prevPaletteValue = u_bandData[band - 1] * 15.0;
        vec3 prevColor = getPaletteColor(int(prevPaletteValue + 0.5));
        float blendT = smoothstep(0.4, 0.0, localX);
        bandColor = mix(bandColor, prevColor, blendT * 0.5);
      }

      // より動的な波形効果
      float wave = sin(uv.y * 4.0 + u_time * 0.8 + bandPhase) * 0.06;
      wave += sin(uv.y * 9.0 - u_time * 0.5 + bandPhase * 1.5) * 0.03;
      wave += fbm(vec2(uv.x * 3.0 + float(band) * 0.2, uv.y * 2.0 + u_time * 0.15)) * 0.04;

      // ソフトなカーテン効果（バンド境界をぼかす）
      float curtain = exp(-pow((localX - 0.5) * 1.8, 2.0));
      // エッジをさらにソフトに
      curtain *= smoothstep(-0.3, 0.2, localX) * smoothstep(1.3, 0.8, localX);

      // 縦方向のグラデーション（上部が明るく、下にフェードアウト）
      float baseY = 0.55 + wave;
      float verticalFade = smoothstep(0.12, 0.35, uv.y) * smoothstep(0.88, 0.55, uv.y);
      // 上部により集中した明るさ
      verticalFade *= 1.0 + smoothstep(0.5, 0.75, uv.y) * 0.3;

      // オーロラの輝度計算（よりソフトなグロー）
      float dist = abs(uv.y - baseY);
      float glow = exp(-dist * dist * 5.0) * 0.9;

      // ノイズベースの明るさ変動
      float brightnessVar = 0.8 + fbm(vec2(float(band) * 0.5, u_time * 0.3)) * 0.4;

      // 色の合成
      float intensity = curtain * verticalFade * glow * brightnessVar;
      color += bandColor * intensity * 0.55;

      // ソフトグロー効果
      float softGlow = curtain * verticalFade * 0.12;
      color += bandColor * softGlow;

      // 上部の発光効果
      float topGlow = smoothstep(0.5, 0.8, uv.y) * curtain * 0.08;
      color += bandColor * topGlow * brightnessVar;
    }

    // 同期フレームのインジケーター
    if (u_isSyncFrame > 0.5) {
      float pulse = sin(u_time * 6.0) * 0.5 + 0.5;
      float edgeGlow = smoothstep(0.1, 0.0, abs(uv.x - 0.5) - 0.45);
      color += vec3(0.0, 1.0, 0.5) * pulse * edgeGlow * 0.2;
    }

    // 山のシルエット
    float mountainHeight = mountains(uv.x * 6.28);
    if (uv.y < mountainHeight) {
      vec3 mountainColor = vec3(0.01, 0.015, 0.025);
      color = mountainColor;
    }

    // ソフトなビネット効果
    float vignette = 1.0 - length((uv - 0.5) * vec2(0.9, 0.5)) * 0.4;
    color *= vignette;

    // ガンマ補正
    color = pow(color, vec3(0.85));

    gl_FragColor = vec4(color, 1.0);
  }
`

// ============================================
// 型定義
// ============================================

type ScanStatus = 'idle' | 'scanning' | 'processing' | 'success' | 'error'

// ============================================
// ユーティリティ関数
// ============================================

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram()
  if (!program) return null

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program))
    return null
  }
  return program
}

// 古いユーティリティ関数は新しいlib/に移行済み

// ============================================
// メインコンポーネント
// ============================================

export default function AuroraCodeApp() {
  const [mode, setMode] = useState<'display' | 'scan'>('display')
  const [dataInput, setDataInput] = useState('Hello Aurora!')
  const [decodedData, setDecodedData] = useState('')
  const [isPlaying, setIsPlaying] = useState(true)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle')
  const [collectedFrames, setCollectedFrames] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)

  const [detectionRate, setDetectionRate] = useState(0)
  const [totalAttempts, setTotalAttempts] = useState(0)
  const [successfulDetections, setSuccessfulDetections] = useState(0)
  const [decoderProgress, setDecoderProgress] = useState<DecoderProgress | null>(null)

  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const startTimeRef = useRef(Date.now())
  const encodedPacketRef = useRef<EncodedPacket | null>(null)
  const visualFramesRef = useRef<VisualFrame[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const scanCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const decoderRef = useRef<FrameDecoder>(new FrameDecoder())
  const scanAnimationRef = useRef<number | null>(null)

  const FRAME_RATE = 2 // フレーム/秒

  // ============================================
  // 表示側の実装（新しいフレームベース）
  // ============================================

  useEffect(() => {
    if (mode !== 'display') return

    const canvas = displayCanvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl')
    if (!gl) return

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
    if (!vertexShader || !fragmentShader) return

    const program = createProgram(gl, vertexShader, fragmentShader)
    if (!program) return

    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1,
    ]), gl.STATIC_DRAW)

    const positionLocation = gl.getAttribLocation(program, 'a_position')
    const timeLocation = gl.getUniformLocation(program, 'u_time')
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution')
    const bandDataLocation = gl.getUniformLocation(program, 'u_bandData')
    const frameIndexLocation = gl.getUniformLocation(program, 'u_frameIndex')
    const isSyncFrameLocation = gl.getUniformLocation(program, 'u_isSyncFrame')

    // データをエンコード
    const packet = encodeData(dataInput)
    encodedPacketRef.current = packet

    // ビジュアルフレームを生成
    const visuals = packet.frames.map(frame => frameToVisual(frame))
    visualFramesRef.current = visuals

    let lastFrameTime = Date.now()
    let currentFrame = 0

    const render = () => {
      const now = Date.now()
      const time = (now - startTimeRef.current) / 1000

      // フレーム切り替え
      if (isPlaying && now - lastFrameTime >= 1000 / FRAME_RATE) {
        currentFrame = (currentFrame + 1) % visuals.length
        lastFrameTime = now
        setCurrentFrameIndex(currentFrame)
      }

      const displayWidth = canvas.clientWidth
      const displayHeight = canvas.clientHeight

      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth
        canvas.height = displayHeight
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
      }

      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.useProgram(program)

      gl.enableVertexAttribArray(positionLocation)
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

      gl.uniform1f(timeLocation, time)
      gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height)

      // 現在のフレームのバンドデータを設定
      const visual = visuals[currentFrame]
      if (visual) {
        const bandData = bandIndicesToUniform(visual)
        gl.uniform1fv(bandDataLocation, bandData)
        gl.uniform1f(frameIndexLocation, visual.frameIndex)
        gl.uniform1f(isSyncFrameLocation, visual.isSyncFrame ? 1.0 : 0.0)
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      animationRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [mode, isPlaying, dataInput])

  // ============================================
  // 読取側の実装
  // ============================================

  const startCamera = useCallback(async () => {
    setErrorMessage('')
    setCameraReady(false)
    setScanStatus('scanning')
    decoderRef.current = new FrameDecoder()
    setCollectedFrames(0)
    setScanProgress(0)
    setTotalAttempts(0)
    setSuccessfulDetections(0)
    setDetectionRate(0)
    setDecoderProgress(null)

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const video = videoRef.current
      if (video) {
        video.srcObject = stream

        video.onloadedmetadata = () => {
          video.play().then(() => {
            setCameraReady(true)
            startScanning()
          }).catch(err => {
            console.error('Video play error:', err)
            setErrorMessage('ビデオの再生に失敗しました: ' + err.message)
            setScanStatus('error')
          })
        }
      }
    } catch (err) {
      console.error('Camera error:', err)
      const error = err as Error
      setErrorMessage(`カメラエラー: ${error.name} - ${error.message}`)
      setScanStatus('error')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (scanAnimationRef.current) {
      cancelAnimationFrame(scanAnimationRef.current)
      scanAnimationRef.current = null
    }
    setCameraReady(false)
  }, [])

  const startScanning = useCallback(() => {
    const video = videoRef.current
    const canvas = scanCanvasRef.current
    if (!video || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let localTotalAttempts = 0
    let localSuccessfulDetections = 0

    const processFrame = () => {
      if (!video || video.readyState < 2) {
        scanAnimationRef.current = requestAnimationFrame(processFrame)
        return
      }

      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480

      ctx.drawImage(video, 0, 0)

      // 中央50%の領域のみを読み取り対象にする
      const centerWidth = Math.floor(canvas.width * 0.5)
      const centerHeight = Math.floor(canvas.height * 0.5)
      const offsetX = Math.floor((canvas.width - centerWidth) / 2)
      const offsetY = Math.floor((canvas.height - centerHeight) / 2)
      const imageData = ctx.getImageData(offsetX, offsetY, centerWidth, centerHeight)

      // 新しい検出アルゴリズムを使用
      const result = detectFrame(imageData)

      localTotalAttempts++
      setTotalAttempts(localTotalAttempts)

      if (result.success && result.frame) {
        localSuccessfulDetections++
        setSuccessfulDetections(localSuccessfulDetections)

        // フレームをデコーダーに追加
        const added = decoderRef.current.addFrame(result.frame)
        if (added) {
          const progress = decoderRef.current.getProgress()
          setDecoderProgress(progress)
          setCollectedFrames(progress.collected)
          setScanProgress(progress.percentage)

          // デコード可能かチェック
          if (progress.canDecode) {
            decodeCollectedData()
            return
          }
        }
      }

      if (localTotalAttempts > 0) {
        setDetectionRate((localSuccessfulDetections / localTotalAttempts) * 100)
      }

      scanAnimationRef.current = requestAnimationFrame(processFrame)
    }

    processFrame()
  }, [])

  // 古い検出関数は lib/detection/detector.ts に移行済み

  const decodeCollectedData = () => {
    setScanStatus('processing')
    stopCamera()

    setTimeout(() => {
      try {
        const result = decoderRef.current.decode()

        if (result.success && result.data) {
          setDecodedData(result.data)
          setScanStatus('success')
        } else {
          setDecodedData('')
          setScanStatus('error')
          setErrorMessage(result.error || 'データの復号に失敗しました。')
        }
      } catch (err) {
        console.error('Decode error:', err)
        setScanStatus('error')
        setErrorMessage('復号中にエラーが発生しました。')
      }
    }, 500)
  }

  const resetScan = useCallback(() => {
    stopCamera()
    setScanStatus('idle')
    setDecodedData('')
    setCollectedFrames(0)
    setScanProgress(0)
    setErrorMessage('')
    setTotalAttempts(0)
    setSuccessfulDetections(0)
    setDetectionRate(0)
    setDecoderProgress(null)
    decoderRef.current = new FrameDecoder()
  }, [stopCamera])

  useEffect(() => {
    if (mode === 'display') {
      stopCamera()
    }
    return () => {
      stopCamera()
    }
  }, [mode, stopCamera])

  // ============================================
  // レンダリング
  // ============================================

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
      overflow: 'hidden',
    }}>
      {/* ヘッダー */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '16px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10,
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)',
      }}>
        <div>
          <h1 style={{
            margin: 0,
            fontSize: '20px',
            fontWeight: 600,
            color: '#fff',
            letterSpacing: '-0.5px',
          }}>
            Aurora Code
          </h1>
        </div>

        <div style={{
          display: 'flex',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '10px',
          padding: '3px',
        }}>
          <button
            onClick={() => setMode('display')}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: mode === 'display' ? 'rgba(16, 185, 129, 0.9)' : 'transparent',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Display
          </button>
          <button
            onClick={() => { setMode('scan'); resetScan() }}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: mode === 'scan' ? 'rgba(16, 185, 129, 0.9)' : 'transparent',
              color: '#fff',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Scan
          </button>
        </div>
      </div>

      {/* 表示モード */}
      {mode === 'display' && (
        <>
          <canvas
            ref={displayCanvasRef}
            style={{
              width: '100%',
              height: '100%',
              display: 'block',
            }}
          />

          <div style={{
            position: 'absolute',
            top: '70px',
            right: '20px',
            background: 'rgba(0,0,0,0.7)',
            padding: '8px 12px',
            borderRadius: '8px',
            zIndex: 10,
          }}>
            <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', marginBottom: '2px' }}>
              FRAME
            </div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>
              {currentFrameIndex + 1}/{encodedPacketRef.current?.totalFrames || 0}
            </div>
          </div>

          <div style={{
            position: 'absolute',
            top: '70px',
            left: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            zIndex: 10,
          }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: isPlaying ? '#10b981' : '#f59e0b',
              boxShadow: isPlaying ? '0 0 10px #10b981' : 'none',
            }} />
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
              {isPlaying ? 'Broadcasting' : 'Paused'}
            </span>
          </div>

          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '20px',
            background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)',
            zIndex: 10,
          }}>
            <div style={{ maxWidth: '450px', margin: '0 auto' }}>
              <label style={{
                display: 'block',
                fontSize: '10px',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>
                Secret Message
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={dataInput}
                  onChange={(e) => setDataInput(e.target.value)}
                  placeholder="Enter secret message..."
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.15)',
                    background: 'rgba(255,255,255,0.08)',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: isPlaying ? 'rgba(239, 68, 68, 0.8)' : 'rgba(16, 185, 129, 0.8)',
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isPlaying ? '||' : '>'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* スキャンモード */}
      {mode === 'scan' && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '70px 20px 20px',
        }}>
          {scanStatus === 'idle' && (
            <div style={{ textAlign: 'center', maxWidth: '320px' }}>
              <div style={{
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                border: '2px solid rgba(16, 185, 129, 0.3)',
              }}>
                <span style={{ fontSize: '40px' }}>SCAN</span>
              </div>
              <h2 style={{ color: '#fff', fontSize: '18px', marginBottom: '10px' }}>
                Ready to Scan
              </h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginBottom: '20px' }}>
                Point camera at Aurora Code display
              </p>

              {errorMessage && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px',
                }}>
                  <p style={{ color: '#ef4444', fontSize: '12px', margin: 0 }}>
                    {errorMessage}
                  </p>
                </div>
              )}

              <button
                onClick={startCamera}
                style={{
                  padding: '14px 32px',
                  borderRadius: '12px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
                  color: '#fff',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)',
                }}
              >
                Start Camera
              </button>
            </div>
          )}

          {(scanStatus === 'scanning' || scanStatus === 'processing') && (
            <div style={{ width: '100%', maxWidth: '400px' }}>
              <div style={{
                position: 'relative',
                borderRadius: '12px',
                overflow: 'hidden',
                background: '#111',
                marginBottom: '16px',
              }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    minHeight: '240px',
                  }}
                />
                <canvas ref={scanCanvasRef} style={{ display: 'none' }} />

                {!cameraReady && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0,0,0,0.8)',
                  }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>...</div>
                      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                        Starting camera...
                      </p>
                    </div>
                  </div>
                )}

                <div style={{
                  position: 'absolute',
                  inset: 0,
                  border: '2px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '12px',
                  pointerEvents: 'none',
                }} />

                {/* 中央50%の読み取り領域を示すガイド枠 */}
                <div style={{
                  position: 'absolute',
                  top: '25%',
                  left: '25%',
                  width: '50%',
                  height: '50%',
                  border: '2px solid rgba(16, 185, 129, 0.9)',
                  borderRadius: '8px',
                  pointerEvents: 'none',
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
                }}>
                  <div style={{
                    position: 'absolute',
                    top: '-20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: '10px',
                    color: 'rgba(16, 185, 129, 0.9)',
                    whiteSpace: 'nowrap',
                  }}>
                    Scan Area
                  </div>
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '10px',
                padding: '14px',
                marginBottom: '12px',
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                }}>
                  <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                    {scanStatus === 'processing' ? 'Decoding...' : 'Collecting frames...'}
                  </span>
                  <span style={{ color: '#10b981', fontSize: '12px', fontWeight: 600 }}>
                    {collectedFrames}/{decoderProgress?.required || '?'}
                  </span>
                </div>
                <div style={{
                  height: '6px',
                  background: 'rgba(255,255,255,0.1)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.min(scanProgress, 100)}%`,
                    background: 'linear-gradient(90deg, #10b981 0%, #06b6d4 100%)',
                    borderRadius: '3px',
                    transition: 'width 0.2s ease',
                  }} />
                </div>

                <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>検出率</span>
                    <div style={{
                      color: detectionRate > 50 ? '#10b981' : '#f59e0b',
                      fontSize: '16px',
                      fontWeight: 600
                    }}>
                      {detectionRate.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>品質</span>
                    <div style={{
                      color: detectionRate > 70 ? '#10b981' : detectionRate > 30 ? '#f59e0b' : '#ef4444',
                      fontSize: '16px',
                      fontWeight: 600
                    }}>
                      {detectionRate > 70 ? '良好' : detectionRate > 30 ? '普通' : '低い'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px' }}>試行</span>
                    <div style={{
                      color: 'rgba(255,255,255,0.8)',
                      fontSize: '16px',
                      fontWeight: 600
                    }}>
                      {totalAttempts}
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={resetScan}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {scanStatus === 'success' && (
            <div style={{ textAlign: 'center', maxWidth: '350px' }}>
              <div style={{
                width: '70px',
                height: '70px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <span style={{ fontSize: '32px', color: '#10b981' }}>OK</span>
              </div>
              <h2 style={{ color: '#10b981', fontSize: '18px', marginBottom: '14px' }}>
                Decoded Successfully!
              </h2>

              <div style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '20px',
                marginBottom: '14px',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>検出率</div>
                  <div style={{ color: '#10b981', fontSize: '14px', fontWeight: 600 }}>
                    {detectionRate.toFixed(1)}%
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px' }}>総試行</div>
                  <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '14px', fontWeight: 600 }}>
                    {totalAttempts}
                  </div>
                </div>
              </div>

              <div style={{
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '16px',
              }}>
                <div style={{
                  fontSize: '10px',
                  color: 'rgba(255,255,255,0.5)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}>
                  Message
                </div>
                <div style={{
                  color: '#fff',
                  fontSize: '16px',
                  fontWeight: 500,
                  wordBreak: 'break-all',
                }}>
                  {decodedData}
                </div>
              </div>
              <button
                onClick={resetScan}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Scan Another
              </button>
            </div>
          )}

          {scanStatus === 'error' && (
            <div style={{ textAlign: 'center', maxWidth: '320px' }}>
              <div style={{
                width: '70px',
                height: '70px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <span style={{ fontSize: '32px', color: '#ef4444' }}>X</span>
              </div>
              <h2 style={{ color: '#ef4444', fontSize: '18px', marginBottom: '10px' }}>
                Error
              </h2>
              {errorMessage && (
                <p style={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: '13px',
                  marginBottom: '16px',
                  wordBreak: 'break-all',
                }}>
                  {errorMessage}
                </p>
              )}
              <button
                onClick={resetScan}
                style={{
                  padding: '10px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'rgba(239, 68, 68, 0.8)',
                  color: '#fff',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        input::placeholder {
          color: rgba(255,255,255,0.3);
        }
        button:active {
          transform: scale(0.98);
        }
      `}</style>
    </div>
  )
}
