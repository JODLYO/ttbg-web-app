import { useEffect, useMemo, useRef, useState } from 'react'
import { CANVAS_SIZE, DRAW_IMG_BASE, DRAW_STYLE_BASE, FPS, FRAME_MS } from '../constants'

interface Props {
  originalFrames: HTMLCanvasElement[]
  styledVideoFrames: Map<string, HTMLCanvasElement[]>
  frameCount: number
  selectedStyleNames: string[]
}

const TOOLS = ['rectangle', 'circle', 'triangle', 'brush'] as const

export default function VideoDrawCanvas({
  originalFrames, styledVideoFrames, frameCount, selectedStyleNames,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Playback data
  const compositeFrames = useRef<HTMLCanvasElement[]>([])
  const styleMasks      = useRef<Uint8Array[]>([])
  const visitedFrames   = useRef(new Set<number>())
  const playInterval    = useRef<ReturnType<typeof setInterval> | null>(null)

  // All mutable drawing/playback state — read by event handlers and interval
  const d = useRef({
    frameIdx:      0,
    isPlaying:     true,
    activeStyle:   null as string | null,
    isDrawing:     false,
    prevMouseX:    0,
    prevMouseY:    0,
    snapshot:      null as ImageData | null,
    tool:          'brush',
    brushWidth:    5,
    playbackSpeed: 0.5,
    offCanvas:     null as HTMLCanvasElement | null,
    pathPoints:    [] as {x: number; y: number}[],
  })

  const previewSrc = useMemo(() => originalFrames[0]?.toDataURL() ?? '', [originalFrames])

  const [tool, setTool]                   = useState('brush')
  const [brushWidth, setBrushWidth]       = useState(5)
  const [speed, setSpeed]                 = useState(0.5)
  const [playing, setPlaying]             = useState(true)
  const [frameLabel, setFrameLabel]       = useState('Frame 1 / 1')
  const [activeStyle, setActiveStyle]     = useState<string | null>(selectedStyleNames[0] ?? null)
  const [saving, setSaving]               = useState(false)

  // Sync React state → refs
  useEffect(() => { d.current.tool         = tool        }, [tool])
  useEffect(() => { d.current.brushWidth   = brushWidth  }, [brushWidth])
  useEffect(() => { d.current.activeStyle  = activeStyle }, [activeStyle])
  useEffect(() => { d.current.playbackSpeed = speed      }, [speed])

  // ── helpers (close over refs only, safe to call any time) ──────────────────

  const getStyleIndex = () => {
    const name = d.current.activeStyle
    if (!name) return 0
    const idx = selectedStyleNames.indexOf(name)
    return idx === -1 ? 0 : idx + 1
  }

  const renderFromMask = (fi: number) => {
    const mask   = styleMasks.current[fi]
    const origPx = originalFrames[fi].getContext('2d')!.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data
    const styled = selectedStyleNames.map(n =>
      styledVideoFrames.get(n)![fi].getContext('2d')!.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data)
    const out = new ImageData(CANVAS_SIZE, CANVAS_SIZE)
    for (let px = 0; px < CANVAS_SIZE * CANVAS_SIZE; px++) {
      const si  = mask[px]
      const src = si === 0 ? origPx : styled[si - 1]
      const i   = px * 4
      out.data[i] = src[i]; out.data[i+1] = src[i+1]
      out.data[i+2] = src[i+2]; out.data[i+3] = 255
    }
    compositeFrames.current[fi].getContext('2d', { willReadFrequently: true })!.putImageData(out, 0, 0)
  }

  const copyStyleToFrame = (src: number, dst: number) => {
    styleMasks.current[dst].set(styleMasks.current[src])
    renderFromMask(dst)
  }

  const loadFrame = (fi: number) => {
    const ctx = canvasRef.current!.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(compositeFrames.current[fi], 0, 0)
    setFrameLabel(`Frame ${fi + 1} / ${compositeFrames.current.length}`)
  }

  const saveCurrentFrame = () => {
    compositeFrames.current[d.current.frameIdx]
      .getContext('2d')!.drawImage(canvasRef.current!, 0, 0)
  }

  const getActiveSource = (): HTMLCanvasElement => {
    const name = d.current.activeStyle
    if (!name) return originalFrames[d.current.frameIdx]
    return styledVideoFrames.get(name)?.[d.current.frameIdx]
      ?? compositeFrames.current[d.current.frameIdx]
  }

  const stopPlayback = () => {
    if (playInterval.current) { clearInterval(playInterval.current); playInterval.current = null }
    d.current.isPlaying = false
    setPlaying(false)
    saveCurrentFrame()
  }

  const startPlayback = () => {
    if (playInterval.current) clearInterval(playInterval.current)
    d.current.isPlaying = true
    setPlaying(true)

    playInterval.current = setInterval(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!

      saveCurrentFrame()
      const prev = d.current.frameIdx
      d.current.frameIdx = (d.current.frameIdx + 1) % compositeFrames.current.length

      if (!visitedFrames.current.has(d.current.frameIdx)) {
        visitedFrames.current.add(d.current.frameIdx)
        copyStyleToFrame(prev, d.current.frameIdx)
      }
      loadFrame(d.current.frameIdx)
      if (d.current.isDrawing) {
        d.current.snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
      }
    }, 1000 / (FPS * d.current.playbackSpeed))
  }

  // ── Init on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx    = canvas.getContext('2d', { willReadFrequently: true })!
    canvas.width = canvas.height = CANVAS_SIZE

    const off = document.createElement('canvas')
    off.width = off.height = CANVAS_SIZE
    d.current.offCanvas = off

    compositeFrames.current = originalFrames.map(src => {
      const c = document.createElement('canvas')
      c.width = c.height = CANVAS_SIZE
      c.getContext('2d')!.drawImage(src, 0, 0)
      return c
    })
    styleMasks.current = Array.from({ length: frameCount }, () => new Uint8Array(CANVAS_SIZE * CANVAS_SIZE))
    visitedFrames.current.add(0)
    loadFrame(0)
    startPlayback()

    const startDrawAt = (x: number, y: number) => {
      d.current.isDrawing  = true
      d.current.prevMouseX = x
      d.current.prevMouseY = y
      d.current.pathPoints = [{x, y}]
      ctx.beginPath()
      ctx.lineWidth = d.current.brushWidth
      d.current.snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
    }

    const drawAt = (x: number, y: number) => {
      if (!d.current.isDrawing) return
      ctx.putImageData(d.current.snapshot!, 0, 0)
      const { tool: t, prevMouseX: px, prevMouseY: py } = d.current
      const src = getActiveSource()

      if (t === 'brush') {
        d.current.pathPoints.push({x, y})
        const pts    = d.current.pathPoints
        const off    = d.current.offCanvas!
        const offCtx = off.getContext('2d')!
        offCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
        offCtx.globalCompositeOperation = 'source-over'
        offCtx.lineWidth = d.current.brushWidth
        offCtx.strokeStyle = 'black'
        offCtx.beginPath()
        offCtx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) offCtx.lineTo(pts[i].x, pts[i].y)
        offCtx.stroke()
        offCtx.globalCompositeOperation = 'source-in'
        offCtx.drawImage(src, 0, 0)
        ctx.drawImage(off, 0, 0)
      } else if (t === 'rectangle') {
        ctx.drawImage(src, x, y, px - x, py - y, x, y, px - x, py - y)
      } else if (t === 'circle') {
        ctx.beginPath()
        const r = Math.sqrt((px - x) ** 2 + (py - y) ** 2)
        ctx.arc(px, py, r, 0, 2 * Math.PI)
        ctx.fillStyle = ctx.createPattern(src, 'repeat')!
        ctx.fill()
      } else if (t === 'triangle') {
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(x, y)
        ctx.lineTo(px * 2 - x, y)
        ctx.closePath()
        ctx.fillStyle = ctx.createPattern(src, 'repeat')!
        ctx.fill()
      }
    }

    const mouseUp = () => {
      if (!d.current.isDrawing) return
      d.current.isDrawing = false
      const after  = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data
      const before = d.current.snapshot!.data
      const si     = getStyleIndex()
      const mask   = styleMasks.current[d.current.frameIdx]
      for (let px = 0; px < CANVAS_SIZE * CANVAS_SIZE; px++) {
        const i = px * 4
        if (after[i] !== before[i] || after[i+1] !== before[i+1] || after[i+2] !== before[i+2])
          mask[px] = si
      }
    }

    // Mouse handlers
    const startDraw = (e: MouseEvent) => startDrawAt(e.offsetX, e.offsetY)
    const drawing   = (e: MouseEvent) => drawAt(e.offsetX, e.offsetY)

    // Touch handlers — scale from CSS pixels to canvas coordinates
    const touchCoords = (e: TouchEvent) => {
      const rect  = canvas.getBoundingClientRect()
      const touch = e.touches[0] ?? e.changedTouches[0]
      return {
        x: (touch.clientX - rect.left) * (canvas.width  / rect.width),
        y: (touch.clientY - rect.top)  * (canvas.height / rect.height),
      }
    }
    const startDrawTouch = (e: TouchEvent) => { e.preventDefault(); const {x,y} = touchCoords(e); startDrawAt(x,y) }
    const drawingTouch   = (e: TouchEvent) => { e.preventDefault(); const {x,y} = touchCoords(e); drawAt(x,y) }
    const touchEnd       = (e: TouchEvent) => { e.preventDefault(); mouseUp() }

    canvas.addEventListener('mousedown', startDraw)
    canvas.addEventListener('mousemove', drawing)
    canvas.addEventListener('mouseup', mouseUp)
    canvas.addEventListener('touchstart', startDrawTouch, { passive: false })
    canvas.addEventListener('touchmove',  drawingTouch,   { passive: false })
    canvas.addEventListener('touchend',   touchEnd)

    return () => {
      if (playInterval.current) clearInterval(playInterval.current)
      canvas.removeEventListener('mousedown', startDraw)
      canvas.removeEventListener('mousemove', drawing)
      canvas.removeEventListener('mouseup', mouseUp)
      canvas.removeEventListener('touchstart', startDrawTouch)
      canvas.removeEventListener('touchmove',  drawingTouch)
      canvas.removeEventListener('touchend',   touchEnd)
    }
  // Canvas setup, frame init, playback, and event listeners must run once on mount.
  // All props accessed inside handlers are kept in the d ref to avoid stale closures.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI handlers ────────────────────────────────────────────────────────────

  const handlePlayPause = () => {
    if (d.current.isPlaying) stopPlayback(); else startPlayback()
  }

  const stepFrame = (delta: number) => {
    if (d.current.isPlaying) stopPlayback()
    saveCurrentFrame()
    const prev = d.current.frameIdx
    d.current.frameIdx = (d.current.frameIdx + delta + compositeFrames.current.length)
      % compositeFrames.current.length
    if (delta > 0 && !visitedFrames.current.has(d.current.frameIdx)) {
      visitedFrames.current.add(d.current.frameIdx)
      copyStyleToFrame(prev, d.current.frameIdx)
    }
    loadFrame(d.current.frameIdx)
  }

  const copyToNext = () => {
    if (d.current.isPlaying) stopPlayback()
    saveCurrentFrame()
    const next = (d.current.frameIdx + 1) % compositeFrames.current.length
    copyStyleToFrame(d.current.frameIdx, next)
    visitedFrames.current.add(next)
    d.current.frameIdx = next
    loadFrame(next)
  }

  const handleClear = () => {
    styleMasks.current[d.current.frameIdx].fill(getStyleIndex())
    renderFromMask(d.current.frameIdx)
    const ctx = canvasRef.current!.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(compositeFrames.current[d.current.frameIdx], 0, 0)
  }

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setSpeed(v)
    d.current.playbackSpeed = v
    if (d.current.isPlaying) startPlayback() // restarts with new speed
  }

  const handleSave = async () => {
    const wasPlaying = d.current.isPlaying
    if (wasPlaying) stopPlayback()
    setSaving(true)

    const canvas   = canvasRef.current!
    const ctx      = canvas.getContext('2d', { willReadFrequently: true })!
    const stream   = canvas.captureStream(FPS)
    const mimeType = ['video/webm;codecs=vp9', 'video/webm']
      .find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    const chunks: BlobPart[] = []

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `styled_video_${Date.now()}.webm`; a.click()
      URL.revokeObjectURL(url)
      setSaving(false)
      if (wasPlaying) startPlayback()
    }

    recorder.start()
    for (let i = 0; i < compositeFrames.current.length; i++) {
      ctx.drawImage(compositeFrames.current[i], 0, 0)
      await new Promise(r => setTimeout(r, FRAME_MS))
    }
    setTimeout(() => recorder.stop(), 200)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="container_canvas">
      <section className="tools-board">
        <div className="row">
          <label className="title">Shapes</label>
          <ul className="options">
            {TOOLS.map(t => (
              <li key={t} id={t} className={`option tool${tool === t ? ' active' : ''}`} onClick={() => setTool(t)}>
                <img src={`${DRAW_IMG_BASE}/${t}.svg`} alt="" />
                <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
              </li>
            ))}
            <li className="option">
              <input type="range" id="size-slider" min="1" max="30" value={brushWidth}
                onChange={e => setBrushWidth(Number(e.target.value))} />
            </li>
          </ul>
        </div>

        <div className="row">
          <label className="title">Playback</label>
          <div className="video-controls">
            <button onClick={() => stepFrame(-1)}>«</button>
            <button onClick={handlePlayPause}>{playing ? 'Pause' : 'Play'}</button>
            <button onClick={() => stepFrame(+1)}>»</button>
            <span id="frame-counter">{frameLabel}</span>
          </div>
          <div className="video-controls" style={{ marginTop: 8 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
              Speed: {speed}x
            </span>
          </div>
          <input type="range" id="speed-slider" min="0.05" max="1" step="0.05" value={speed}
            style={{ width: '100%', marginTop: 4 }} onChange={handleSpeedChange} />
        </div>

        <div className="row styles">
          <label className="title">Select a Style</label>
          <ul className="options">
            <div className="grid-container" id="draw-style-grid">
              <div
                className={`grid-item${activeStyle === null ? ' selected' : ''}`}
                onClick={() => setActiveStyle(null)}
              >
                <a><span className="check"><img src={previewSrc} alt="original" /></span></a>
              </div>
              {selectedStyleNames.map(name => (
                <div
                  key={name}
                  className={`grid-item${activeStyle === name ? ' selected' : ''}`}
                  onClick={() => setActiveStyle(name)}
                >
                  <a><span className="check"><img src={`${DRAW_STYLE_BASE}/${name}`} alt={name} /></span></a>
                </div>
              ))}
            </div>
          </ul>
        </div>

        <div className="row buttons">
          <button className="clear-canvas" onClick={handleClear}>Set frame to selected style</button>
          <button id="btn-copy-next" onClick={copyToNext}>Copy style to next frame</button>
          <button className="save-img" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save video'}
          </button>
        </div>
      </section>

      <section className="drawing-board">
        <canvas ref={canvasRef} />
      </section>
    </div>
  )
}
