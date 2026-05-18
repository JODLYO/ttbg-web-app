import { useEffect, useMemo, useRef, useState } from 'react'
import { CANVAS_SIZE, DRAW_IMG_BASE, DRAW_STYLE_BASE } from '../constants'
import { type ContainBounds, drawContained } from '../utils'

interface Props {
  styledCanvases: Map<string, HTMLCanvasElement>
  contentFile: File
  selectedStyleNames: string[]
}

const TOOLS = ['rectangle', 'circle', 'triangle', 'brush'] as const

function drawBrush(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  off: HTMLCanvasElement,
  lineWidth: number,
  pts: { x: number; y: number }[],
  x: number,
  y: number,
) {
  pts.push({ x, y })
  const offCtx = off.getContext('2d')!
  offCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
  offCtx.globalCompositeOperation = 'source-over'
  offCtx.lineWidth = lineWidth
  offCtx.strokeStyle = 'black'
  offCtx.beginPath()
  offCtx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) offCtx.lineTo(pts[i].x, pts[i].y)
  offCtx.stroke()
  offCtx.globalCompositeOperation = 'source-in'
  offCtx.drawImage(src, 0, 0)
  ctx.drawImage(off, 0, 0)
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  x: number,
  y: number,
  anchorX: number,
  anchorY: number,
) {
  ctx.drawImage(src, x, y, anchorX - x, anchorY - y, x, y, anchorX - x, anchorY - y)
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  anchorX: number,
  anchorY: number,
  x: number,
  y: number,
) {
  ctx.beginPath()
  const r = Math.sqrt((anchorX - x) ** 2 + (anchorY - y) ** 2)
  ctx.arc(anchorX, anchorY, r, 0, 2 * Math.PI)
  ctx.fillStyle = ctx.createPattern(src, 'repeat')!
  ctx.fill()
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  src: HTMLCanvasElement,
  anchorX: number,
  anchorY: number,
  x: number,
  y: number,
) {
  ctx.beginPath()
  ctx.moveTo(anchorX, anchorY)
  ctx.lineTo(x, y)
  ctx.lineTo(anchorX * 2 - x, y)
  ctx.closePath()
  ctx.fillStyle = ctx.createPattern(src, 'repeat')!
  ctx.fill()
}

export default function DrawCanvas({ styledCanvases, contentFile, selectedStyleNames }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // All imperative drawing state in a single ref so event handlers never go stale
  const drawState = useRef({
    isDrawing: false,
    prevMouseX: 0,
    prevMouseY: 0,
    snapshot: null as ImageData | null,
    tool: 'brush',
    brushWidth: 5,
    activeSource: null as HTMLCanvasElement | null,
    origCanvas: null as HTMLCanvasElement | null,
    offCanvas: null as HTMLCanvasElement | null,
    pathPoints: [] as { x: number; y: number }[],
    cropBounds: null as ContainBounds | null,
  })

  const previewSrc = useMemo(() => URL.createObjectURL(contentFile), [contentFile])
  useEffect(() => () => URL.revokeObjectURL(previewSrc), [previewSrc])

  const [tool, setTool] = useState('brush')
  const [brushWidth, setBrushWidth] = useState(5)
  const [activeStyle, setActiveStyle] = useState<string | null>(selectedStyleNames[0] ?? null)

  // Keep refs in sync with React state
  useEffect(() => { drawState.current.tool = tool }, [tool])
  useEffect(() => { drawState.current.brushWidth = brushWidth }, [brushWidth])
  useEffect(() => {
    drawState.current.activeSource = activeStyle === null
      ? drawState.current.origCanvas
      : styledCanvases.get(activeStyle) ?? null
  }, [activeStyle, styledCanvases])

  // Mount once: init canvas + wire mouse events
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    drawState.current.activeSource = styledCanvases.get(selectedStyleNames[0]) ?? null

    const off = document.createElement('canvas')
    off.width = off.height = CANVAS_SIZE
    drawState.current.offCanvas = off

    const url = URL.createObjectURL(contentFile)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      canvas.width = canvas.height = CANVAS_SIZE
      const orig = document.createElement('canvas')
      orig.width = orig.height = CANVAS_SIZE
      drawState.current.cropBounds = drawContained(orig.getContext('2d')!, img)
      drawState.current.origCanvas = orig
      ctx.drawImage(orig, 0, 0, canvas.width, canvas.height)
    }
    img.src = url

    const startDrawAt = (x: number, y: number) => {
      drawState.current.isDrawing = true
      drawState.current.prevMouseX = x
      drawState.current.prevMouseY = y
      drawState.current.pathPoints = [{ x, y }]
      ctx.beginPath()
      ctx.lineWidth = drawState.current.brushWidth
      drawState.current.snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
    }

    const drawAt = (x: number, y: number) => {
      if (!drawState.current.isDrawing) return
      ctx.putImageData(drawState.current.snapshot!, 0, 0)
      const { tool: t, prevMouseX: ax, prevMouseY: ay, activeSource, origCanvas } = drawState.current
      const src = t === 'eraser' ? origCanvas! : activeSource!

      switch (t) {
        case 'brush':
        case 'eraser':
          drawBrush(ctx, src, drawState.current.offCanvas!, drawState.current.brushWidth,
            drawState.current.pathPoints, x, y)
          break
        case 'rectangle':
          drawRect(ctx, src, x, y, ax, ay)
          break
        case 'circle':
          drawCircle(ctx, src, ax, ay, x, y)
          break
        case 'triangle':
          drawTriangle(ctx, src, ax, ay, x, y)
          break
      }
    }

    const stopDraw = () => { drawState.current.isDrawing = false }

    // Mouse handlers
    const startDraw  = (e: MouseEvent) => startDrawAt(e.offsetX, e.offsetY)
    const drawing    = (e: MouseEvent) => drawAt(e.offsetX, e.offsetY)

    canvas.addEventListener('mousedown', startDraw)
    canvas.addEventListener('mousemove', drawing)
    canvas.addEventListener('mouseup', stopDraw)

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

    canvas.addEventListener('touchstart', startDrawTouch, { passive: false })
    canvas.addEventListener('touchmove',  drawingTouch,   { passive: false })
    canvas.addEventListener('touchend',   stopDraw)

    return () => {
      canvas.removeEventListener('mousedown', startDraw)
      canvas.removeEventListener('mousemove', drawing)
      canvas.removeEventListener('mouseup', stopDraw)
      canvas.removeEventListener('touchstart', startDrawTouch)
      canvas.removeEventListener('touchmove',  drawingTouch)
      canvas.removeEventListener('touchend',   stopDraw)
    }
  // Canvas setup, image load, and event listeners must run once on mount.
  // Props accessed inside handlers are kept in drawState ref to avoid stale closures.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    if (drawState.current.activeSource) ctx.drawImage(drawState.current.activeSource, 0, 0, canvas.width, canvas.height)
  }

  const handleSave = () => {
    const source = canvasRef.current!
    const bounds = drawState.current.cropBounds
    const a = document.createElement('a')
    a.download = `styled_${Date.now()}.png`
    if (bounds) {
      const out = document.createElement('canvas')
      out.width = bounds.dw
      out.height = bounds.dh
      out.getContext('2d')!.drawImage(source, bounds.dx, bounds.dy, bounds.dw, bounds.dh, 0, 0, bounds.dw, bounds.dh)
      a.href = out.toDataURL()
    } else {
      a.href = source.toDataURL()
    }
    a.click()
  }

  return (
    <div className="container_canvas">
      <section className="tools-board">
        <div className="row">
          <label className="title">Shapes</label>
          <ul className="options">
            {TOOLS.map(t => (
              <li
                key={t}
                id={t}
                className={`option tool${tool === t ? ' active' : ''}`}
                onClick={() => setTool(t)}
              >
                <img src={`${DRAW_IMG_BASE}/${t}.svg`} alt="" />
                <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
              </li>
            ))}
            <li className="option">
              <input
                type="range" id="size-slider" min="1" max="30" value={brushWidth}
                onChange={e => setBrushWidth(Number(e.target.value))}
              />
            </li>
          </ul>
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
          <button className="clear-canvas" onClick={handleClear}>Set picture to selected style</button>
          <button className="save-img" onClick={handleSave}>Save image</button>
        </div>
      </section>

      <section className="drawing-board">
        <canvas ref={canvasRef} />
      </section>
    </div>
  )
}
